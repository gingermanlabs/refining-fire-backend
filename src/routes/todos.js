const express = require('express');
const { randomUUID } = require('crypto');
const TodoItem = require('../models/TodoItem');
const Group = require('../models/Group');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

// GET /api/todos/streak  (must be before /:id routes)
router.get('/streak', async (req, res) => {
  try {
    const userId = req.user._id;

    // Gather all distinct dates where the user had todos
    const allDates = await TodoItem.distinct('date', { userId });
    const sortedDates = allDates.sort().reverse(); // most recent first

    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;

    // Walk backwards from today
    const today = req.query.date || todayString();
    let cursor = today;

    for (const date of sortedDates) {
      if (date > cursor) continue; // future date, skip
      if (date !== cursor) break;  // gap — streak ends

      // Check if ALL todos for this date are completed
      const todos = await TodoItem.find({ userId, date });
      const allDone = todos.length > 0 && todos.every(t => t.isCompleted);

      if (allDone) {
        tempStreak++;
        longestStreak = Math.max(longestStreak, tempStreak);
        // move cursor back one day
        const d = new Date(cursor);
        d.setDate(d.getDate() - 1);
        cursor = d.toISOString().slice(0, 10);
      } else {
        if (date === today) {
          // today not done yet — streak hasn't broken (ongoing day)
          const d = new Date(cursor);
          d.setDate(d.getDate() - 1);
          cursor = d.toISOString().slice(0, 10);
        } else {
          break;
        }
      }
    }
    currentStreak = tempStreak;

    res.json({ userId, currentStreak, longestStreak });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/todos/today
router.get('/today', async (req, res) => {
  try {
    const userId = req.user._id;
    const today  = req.query.date || todayString();

    // Find TodoItems already materialized for today
    const existing = await TodoItem.find({ userId, date: today });

    const existingGroupTodoIds = new Set(
      existing
        .filter(t => t.groupTodoItemId)
        .map(t => t.groupTodoItemId.toString())
    );

    // Find all groups this user belongs to and create missing group task TodoItems
    const groups = await Group.find({ memberIds: userId });
    const toInsert = [];
    for (const group of groups) {
      for (const item of group.todoItems) {
        if (!existingGroupTodoIds.has(item._id.toString())) {
          toInsert.push({
            userId,
            title: item.title,
            date: today,
            isCompleted: false,
            source: 'group',
            groupId: group._id,
            groupTodoItemId: item._id,
          });
        }
      }
    }

    // Materialize recurring personal tasks for today
    const existingRecurringIds = new Set(
      existing
        .filter(t => t.recurringId)
        .map(t => t.recurringId)
    );
    // Find all distinct recurringIds this user has ever created
    const allRecurring = await TodoItem.find(
      { userId, source: 'personal', recurring: true, recurringId: { $ne: null } },
      { title: 1, recurringId: 1 }
    ).sort({ createdAt: -1 }); // most recent title wins per recurringId

    const seenRecurringIds = new Set();
    for (const t of allRecurring) {
      if (seenRecurringIds.has(t.recurringId)) continue;
      seenRecurringIds.add(t.recurringId);
      if (!existingRecurringIds.has(t.recurringId)) {
        toInsert.push({
          userId,
          title: t.title,
          date: today,
          isCompleted: false,
          source: 'personal',
          recurring: true,
          recurringId: t.recurringId,
        });
      }
    }

    if (toInsert.length > 0) {
      await TodoItem.insertMany(toInsert);
    }

    const todos = await TodoItem.find({ userId, date: today });
    res.json(todos);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/todos
router.post('/', async (req, res) => {
  try {
    const { title, date, recurring } = req.body;
    if (!title || !date) return res.status(400).json({ message: 'title and date are required.' });
    const item = await TodoItem.create({
      userId: req.user._id,
      title,
      date,
      source: 'personal',
      recurring: !!recurring,
      recurringId: recurring ? randomUUID() : null,
    });
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/todos/:id/toggle
router.patch('/:id/toggle', async (req, res) => {
  try {
    const item = await TodoItem.findOne({ _id: req.params.id, userId: req.user._id });
    if (!item) return res.status(404).json({ message: 'Todo not found.' });
    item.isCompleted = req.body.isCompleted ?? !item.isCompleted;
    await item.save();

    // If this is a group-linked todo, also update the group's completedByUserIds
    if (item.source === 'group' && item.groupId && item.groupTodoItemId) {
      const group = await Group.findById(item.groupId);
      if (group) {
        const groupTodo = group.todoItems.id(item.groupTodoItemId);
        if (groupTodo) {
          const uid = req.user._id.toString();
          const today = req.body.date || item.date;

          // Reset stale completion state on a new day before applying toggle
          if (groupTodo.completionDate !== today) {
            groupTodo.completedByUserIds = [];
            groupTodo.completionDate = today;
          }

          if (item.isCompleted) {
            if (!groupTodo.completedByUserIds.map(String).includes(uid)) {
              groupTodo.completedByUserIds.push(req.user._id);
            }
          } else {
            groupTodo.completedByUserIds = groupTodo.completedByUserIds.filter(
              id => id.toString() !== uid
            );
          }
          await group.save();
        }
      }
    }

    res.json(item);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/todos/:id
router.delete('/:id', async (req, res) => {
  try {
    const item = await TodoItem.findOne({ _id: req.params.id, userId: req.user._id, source: 'personal' });
    if (!item) return res.status(404).json({ message: 'Todo not found or cannot be deleted.' });

    if (item.recurringId) {
      // Remove every instance of this recurring task across all dates so it won't be re-materialized
      await TodoItem.deleteMany({ userId: req.user._id, recurringId: item.recurringId });
    } else {
      await item.deleteOne();
    }

    res.status(204).send();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;

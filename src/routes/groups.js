const express = require('express');
const Group = require('../models/Group');
const User = require('../models/User');
const TodoItem = require('../models/TodoItem');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

// GET /api/groups — get groups the current user belongs to
router.get('/', async (req, res) => {
  try {
    const groups = await Group.find({ memberIds: req.user._id });
    res.json(groups);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/groups/:id
router.get('/:id', async (req, res) => {
  try {
    const group = await Group.findOne({ _id: req.params.id, memberIds: req.user._id });
    if (!group) return res.status(404).json({ message: 'Group not found.' });

    const today = req.query.date || todayString();
    const groupObj = group.toObject();
    // Return empty completedByUserIds for any item whose completionDate is not today
    groupObj.todoItems = groupObj.todoItems.map(item => {
      if (item.completionDate !== today) {
        return { ...item, completedByUserIds: [] };
      }
      return item;
    });

    res.json(groupObj);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/groups/:id/members
router.get('/:id/members', async (req, res) => {
  try {
    const group = await Group.findOne({ _id: req.params.id, memberIds: req.user._id });
    if (!group) return res.status(404).json({ message: 'Group not found.' });
    const members = await User.find({ _id: { $in: group.memberIds } });
    res.json(members.map(u => u.toSafeObject()));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/groups — create group
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'name is required.' });
    const group = await Group.create({
      name,
      adminId: req.user._id,
      memberIds: [req.user._id],
    });
    await User.findByIdAndUpdate(req.user._id, { $addToSet: { groupIds: group._id } });
    res.status(201).json(group);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/groups/join
router.post('/join', async (req, res) => {
  try {
    const { inviteCode } = req.body;
    if (!inviteCode) return res.status(400).json({ message: 'inviteCode is required.' });
    const group = await Group.findOne({ inviteCode: inviteCode.toUpperCase() });
    if (!group) return res.status(404).json({ message: 'Invalid invite code.' });

    const alreadyMember = group.memberIds.map(String).includes(req.user._id.toString());
    if (!alreadyMember) {
      group.memberIds.push(req.user._id);
      await group.save();
      await User.findByIdAndUpdate(req.user._id, { $addToSet: { groupIds: group._id } });

      // Add today's group todos as personal todo entries for this new member
      const today = todayString();
      for (const item of group.todoItems) {
        await TodoItem.create({
          userId: req.user._id,
          title: item.title,
          date: today,
          source: 'group',
          groupId: group._id,
          groupTodoItemId: item._id,
        });
      }
    }

    res.json(group);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/groups/:groupId/todos — admin adds a group todo
router.post('/:groupId/todos', async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ message: 'title is required.' });

    const group = await Group.findOne({ _id: req.params.groupId, adminId: req.user._id });
    if (!group) return res.status(403).json({ message: 'Only the group admin can add tasks.' });

    group.todoItems.push({ title, completedByUserIds: [] });
    await group.save();
    const newItem = group.todoItems[group.todoItems.length - 1];

    // Fan out: create a personal TodoItem for each member for today
    const today = todayString();
    await TodoItem.insertMany(
      group.memberIds.map(memberId => ({
        userId: memberId,
        title,
        date: today,
        source: 'group',
        groupId: group._id,
        groupTodoItemId: newItem._id,
      }))
    );

    res.status(201).json(newItem);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/groups/:groupId/todos/:todoId — admin removes a group todo
router.delete('/:groupId/todos/:todoId', async (req, res) => {
  try {
    const group = await Group.findOne({ _id: req.params.groupId, adminId: req.user._id });
    if (!group) return res.status(403).json({ message: 'Only the group admin can remove tasks.' });

    const item = group.todoItems.id(req.params.todoId);
    if (!item) return res.status(404).json({ message: 'Task not found.' });

    item.deleteOne();
    await group.save();

    // Remove associated personal TodoItems for all members
    await TodoItem.deleteMany({ groupTodoItemId: req.params.todoId });

    res.status(204).send();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/groups/:groupId/todos/:todoId/toggle
router.patch('/:groupId/todos/:todoId/toggle', async (req, res) => {
  try {
    const group = await Group.findOne({ _id: req.params.groupId, memberIds: req.user._id });
    if (!group) return res.status(404).json({ message: 'Group not found.' });

    const item = group.todoItems.id(req.params.todoId);
    if (!item) return res.status(404).json({ message: 'Task not found.' });

    const uid = req.user._id.toString();
    const isCompleted = req.body.isCompleted;
    const today = req.body.date || todayString();

    // Reset stale completion state on a new day before applying toggle
    if (item.completionDate !== today) {
      item.completedByUserIds = [];
      item.completionDate = today;
    }

    if (isCompleted) {
      if (!item.completedByUserIds.map(String).includes(uid)) {
        item.completedByUserIds.push(req.user._id);
      }
    } else {
      item.completedByUserIds = item.completedByUserIds.filter(id => id.toString() !== uid);
    }
    await group.save();

    // Sync the personal TodoItem
    await TodoItem.findOneAndUpdate(
      { userId: req.user._id, groupTodoItemId: req.params.todoId, date: today },
      { isCompleted },
      { new: true }
    );

    res.json(item);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/groups/:groupId/prayer-requests
router.get('/:groupId/prayer-requests', async (req, res) => {
  try {
    const group = await Group.findOne({ _id: req.params.groupId, memberIds: req.user._id })
      .populate('prayerRequests.userId', '_id displayName username avatarURL');
    if (!group) return res.status(404).json({ message: 'Group not found.' });

    if (!group.prayerRequests) group.prayerRequests = [];
    const requests = group.prayerRequests.map(r => ({
      _id: r._id,
      userId: r.userId._id,
      message: r.message,
      createdAt: r.createdAt,
      user: {
        _id: r.userId._id,
        displayName: r.userId.displayName,
        username: r.userId.username,
        avatarURL: r.userId.avatarURL,
      },
    }));
    res.json(requests);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/groups/:groupId/prayer-requests
router.post('/:groupId/prayer-requests', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ message: 'message is required.' });

    const group = await Group.findOne({ _id: req.params.groupId, memberIds: req.user._id });
    if (!group) return res.status(404).json({ message: 'Group not found.' });

    const updatedGroup = await Group.findByIdAndUpdate(
      req.params.groupId,
      { $push: { prayerRequests: { userId: req.user._id, message: message.trim() } } },
      { new: true }
    ).populate('prayerRequests.userId', '_id displayName username avatarURL');
    const requests = updatedGroup.prayerRequests.map(r => ({
      _id: r._id,
      userId: r.userId._id,
      message: r.message,
      createdAt: r.createdAt,
      user: {
        _id: r.userId._id,
        displayName: r.userId.displayName,
        username: r.userId.username,
        avatarURL: r.userId.avatarURL,
      },
    }));
    res.status(201).json(requests);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/groups/:groupId/prayer-requests/:requestId
router.delete('/:groupId/prayer-requests/:requestId', async (req, res) => {
  try {
    const group = await Group.findOne({ _id: req.params.groupId, memberIds: req.user._id });
    if (!group) return res.status(404).json({ message: 'Group not found.' });

    if (!group.prayerRequests) group.prayerRequests = [];
    const request = group.prayerRequests.id(req.params.requestId);
    if (!request) return res.status(404).json({ message: 'Prayer request not found.' });
    if (request.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You can only delete your own prayer requests.' });
    }

    request.deleteOne();
    await group.save();

    await group.populate('prayerRequests.userId', '_id displayName username avatarURL');
    const requests = group.prayerRequests.map(r => ({
      _id: r._id,
      userId: r.userId._id,
      message: r.message,
      createdAt: r.createdAt,
      user: {
        _id: r.userId._id,
        displayName: r.userId.displayName,
        username: r.userId.username,
        avatarURL: r.userId.avatarURL,
      },
    }));
    res.json(requests);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/groups/:groupId/poke
router.post('/:groupId/poke', async (req, res) => {
  try {
    const { targetUserId, todoId } = req.body;
    if (!targetUserId) return res.status(400).json({ message: 'targetUserId is required.' });

    const group = await Group.findOne({ _id: req.params.groupId, memberIds: req.user._id });
    if (!group) return res.status(404).json({ message: 'Group not found.' });
    if (!group.memberIds.map(String).includes(targetUserId)) {
      return res.status(400).json({ message: 'Target user is not a member of this group.' });
    }

    // In a production app this would send a push notification via APNs/FCM.
    // For local dev, we just return success. The mobile apps use local notifications.
    console.log(`[POKE] ${req.user.username} poked user ${targetUserId} for task ${todoId || '(general)'}`);

    res.json({ success: true, message: 'Poke sent.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;

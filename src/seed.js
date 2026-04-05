/**
 * Seed script — populates MongoDB with test users, groups, and todos.
 * Run with: node src/seed.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Group = require('./models/Group');
const TodoItem = require('./models/TodoItem');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/refining_fire';

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

async function seed() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  // Wipe existing data
  await Promise.all([
    User.deleteMany({}),
    Group.deleteMany({}),
    TodoItem.deleteMany({}),
  ]);
  console.log('Cleared existing data');

  // ── Users ────────────────────────────────────────────────────────────────
  const [alex, brooke, carlos, dana] = await User.create([
    { username: 'alex',   password: 'password123', displayName: 'Alex Rivera' },
    { username: 'brooke', password: 'password123', displayName: 'Brooke Chen' },
    { username: 'carlos', password: 'password123', displayName: 'Carlos Mendez' },
    { username: 'dana',   password: 'password123', displayName: 'Dana Park' },
  ]);
  console.log('Created 4 users');

  // ── Group 1: Morning Grind (alex is admin) ───────────────────────────────
  const morningGrind = await Group.create({
    name: 'Morning Grind',
    inviteCode: 'MGRIND01',
    adminId: alex._id,
    memberIds: [alex._id, brooke._id, carlos._id],
    todoItems: [
      { title: 'Wake up by 6 AM',             completedByUserIds: [alex._id, brooke._id] },
      { title: '20 minutes of exercise',       completedByUserIds: [alex._id] },
      { title: 'No phone for first 30 minutes', completedByUserIds: [alex._id, brooke._id, carlos._id] },
      { title: 'Read for 15 minutes',          completedByUserIds: [] },
    ],
  });

  // Update groupIds on members
  await User.updateMany(
    { _id: { $in: [alex._id, brooke._id, carlos._id] } },
    { $addToSet: { groupIds: morningGrind._id } }
  );

  // ── Group 2: Study Squad (brooke is admin) ───────────────────────────────
  const studySquad = await Group.create({
    name: 'Study Squad',
    inviteCode: 'STUDY001',
    adminId: brooke._id,
    memberIds: [brooke._id, carlos._id, dana._id],
    todoItems: [
      { title: 'Study for 2 hours',       completedByUserIds: [brooke._id, dana._id] },
      { title: 'Review yesterday\'s notes', completedByUserIds: [brooke._id] },
      { title: 'No social media until 6 PM', completedByUserIds: [] },
    ],
  });

  await User.updateMany(
    { _id: { $in: [brooke._id, carlos._id, dana._id] } },
    { $addToSet: { groupIds: studySquad._id } }
  );
  console.log('Created 2 groups');

  // ── TodoItems (today) ────────────────────────────────────────────────────
  // Helper: create personal + group todos for a user
  async function createTodosForUser(user, personalTitles, groupTodos) {
    const items = [];

    for (const title of personalTitles) {
      items.push({ userId: user._id, title, date: today, source: 'personal' });
    }

    for (const { group, item, isCompleted } of groupTodos) {
      items.push({
        userId: user._id,
        title: item.title,
        date: today,
        source: 'group',
        groupId: group._id,
        groupTodoItemId: item._id,
        isCompleted,
      });
    }

    await TodoItem.insertMany(items);
  }

  const mg = morningGrind.todoItems;
  const ss = studySquad.todoItems;

  // Alex — Morning Grind member, personal todos
  await createTodosForUser(alex,
    ['Journal entry', 'Drink 2L of water'],
    [
      { group: morningGrind, item: mg[0], isCompleted: true },
      { group: morningGrind, item: mg[1], isCompleted: true },
      { group: morningGrind, item: mg[2], isCompleted: true },
      { group: morningGrind, item: mg[3], isCompleted: false },
    ]
  );

  // Brooke — both groups
  await createTodosForUser(brooke,
    ['Meditate for 10 minutes'],
    [
      { group: morningGrind, item: mg[0], isCompleted: true },
      { group: morningGrind, item: mg[1], isCompleted: false },
      { group: morningGrind, item: mg[2], isCompleted: true },
      { group: morningGrind, item: mg[3], isCompleted: false },
      { group: studySquad,   item: ss[0], isCompleted: true },
      { group: studySquad,   item: ss[1], isCompleted: true },
      { group: studySquad,   item: ss[2], isCompleted: false },
    ]
  );

  // Carlos — both groups
  await createTodosForUser(carlos,
    ['Prep meals for the day', 'Call mom'],
    [
      { group: morningGrind, item: mg[0], isCompleted: false },
      { group: morningGrind, item: mg[1], isCompleted: false },
      { group: morningGrind, item: mg[2], isCompleted: true },
      { group: morningGrind, item: mg[3], isCompleted: false },
      { group: studySquad,   item: ss[0], isCompleted: false },
      { group: studySquad,   item: ss[1], isCompleted: false },
      { group: studySquad,   item: ss[2], isCompleted: false },
    ]
  );

  // Dana — Study Squad only
  await createTodosForUser(dana,
    ['10,000 steps'],
    [
      { group: studySquad, item: ss[0], isCompleted: true },
      { group: studySquad, item: ss[1], isCompleted: false },
      { group: studySquad, item: ss[2], isCompleted: false },
    ]
  );

  // ── Yesterday todos (so streak shows > 1) ───────────────────────────────
  // Alex and Brooke both completed everything yesterday → streak = 2 for them
  const yesterdayTodos = [
    { userId: alex._id,   title: 'Journal entry',          date: yesterday, source: 'personal', isCompleted: true },
    { userId: alex._id,   title: 'Drink 2L of water',      date: yesterday, source: 'personal', isCompleted: true },
    { userId: alex._id,   title: 'Wake up by 6 AM',        date: yesterday, source: 'group',    isCompleted: true, groupId: morningGrind._id, groupTodoItemId: mg[0]._id },
    { userId: alex._id,   title: '20 minutes of exercise', date: yesterday, source: 'group',    isCompleted: true, groupId: morningGrind._id, groupTodoItemId: mg[1]._id },
    { userId: brooke._id, title: 'Meditate for 10 minutes',date: yesterday, source: 'personal', isCompleted: true },
    { userId: brooke._id, title: 'Wake up by 6 AM',        date: yesterday, source: 'group',    isCompleted: true, groupId: morningGrind._id, groupTodoItemId: mg[0]._id },
    { userId: brooke._id, title: 'Study for 2 hours',      date: yesterday, source: 'group',    isCompleted: true, groupId: studySquad._id,   groupTodoItemId: ss[0]._id },
  ];
  await TodoItem.insertMany(yesterdayTodos);

  console.log('Created todos for today and yesterday');

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n── Seed complete ─────────────────────────────────────────');
  console.log('\nTest accounts (all passwords: password123):\n');
  console.log('  username: alex    — Morning Grind (admin)');
  console.log('  username: brooke  — Morning Grind + Study Squad (admin of Study Squad)');
  console.log('  username: carlos  — Morning Grind + Study Squad');
  console.log('  username: dana    — Study Squad');
  console.log('\nGroups:');
  console.log(`  Morning Grind  — invite code: MGRIND01`);
  console.log(`  Study Squad    — invite code: STUDY001`);
  console.log('\nLog in with any account to explore the full UI.');
  console.log('──────────────────────────────────────────────────────────\n');

  await mongoose.disconnect();
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});

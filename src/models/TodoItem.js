const mongoose = require('mongoose');

const todoItemSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true },
  isCompleted: { type: Boolean, default: false },
  date: { type: String, required: true },   // "YYYY-MM-DD"
  source: { type: String, enum: ['personal', 'group'], default: 'personal' },
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null },
  groupTodoItemId: { type: mongoose.Schema.Types.ObjectId, default: null },
  recurring: { type: Boolean, default: false },
  recurringId: { type: String, default: null }, // links all daily instances of the same recurring task
}, { timestamps: true });

todoItemSchema.index({ userId: 1, date: 1 });

module.exports = mongoose.model('TodoItem', todoItemSchema);

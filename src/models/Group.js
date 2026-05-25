const mongoose = require('mongoose');
const { nanoid } = require('nanoid');

const prayerRequestSchema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  message: { type: String, required: true, trim: true, maxlength: 500 },
}, { timestamps: true });

const groupTodoItemSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  completedByUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  completionDate: { type: String, default: '' },
}, { timestamps: true });

const groupSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  inviteCode: {
    type: String,
    unique: true,
    default: () => nanoid(8).toUpperCase(),
  },
  adminId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  memberIds:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  todoItems:      { type: [groupTodoItemSchema], default: [] },
  prayerRequests: { type: [prayerRequestSchema], default: [] },
}, { timestamps: true });

module.exports = mongoose.model('Group', groupSchema);

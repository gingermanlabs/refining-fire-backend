const mongoose = require('mongoose');
const { nanoid } = require('nanoid');

const memberNoteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  note:   { type: String, default: '', trim: true, maxlength: 500 },
}, { _id: false, timestamps: true });

const groupTodoItemSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  completedByUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  completionDate: { type: String, default: '' },
  memberNotes: [memberNoteSchema],
}, { timestamps: true });

const groupSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  inviteCode: {
    type: String,
    unique: true,
    default: () => nanoid(8).toUpperCase(),
  },
  adminId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  memberIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  todoItems: [groupTodoItemSchema],
  sharedNote: {
    content:       { type: String, default: '', maxlength: 2000 },
    lastEditedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedAt:     { type: Date, default: null },
  },
}, { timestamps: true });

module.exports = mongoose.model('Group', groupSchema);

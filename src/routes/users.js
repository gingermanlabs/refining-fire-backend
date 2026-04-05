const express = require('express');
const multer = require('multer');
const { S3Client } = require('@aws-sdk/client-s3');
const multerS3 = require('multer-s3');
const User = require('../models/User');
const TodoItem = require('../models/TodoItem');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// ── Avatar storage (R2 cloud bucket) ──────────────────────────────────────────

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const storage = multerS3({
  s3,
  bucket: process.env.R2_BUCKET_NAME,
  contentType: multerS3.AUTO_CONTENT_TYPE,
  key: (req, _file, cb) => cb(null, `avatars/${req.user._id}.jpg`),
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed.'));
  },
});

// PUT /api/users/me/avatar
router.put('/me/avatar', authMiddleware, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
    req.user.avatarURL = `${process.env.R2_PUBLIC_URL}/avatars/${req.user._id}.jpg`;
    await req.user.save();
    res.json(req.user.toSafeObject());
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Member streak (for any user — accessible to group members) ────────────────

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

// GET /api/users/:userId/streak
router.get('/:userId/streak', authMiddleware, async (req, res) => {
  try {
    const userId = req.params.userId;

    const allDates = await TodoItem.distinct('date', { userId });
    const sortedDates = allDates.sort().reverse();

    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;

    const today = todayString();
    let cursor = today;

    for (const date of sortedDates) {
      if (date > cursor) continue;
      if (date !== cursor) break;

      const todos = await TodoItem.find({ userId, date });
      const allDone = todos.length > 0 && todos.every(t => t.isCompleted);

      if (allDone) {
        tempStreak++;
        longestStreak = Math.max(longestStreak, tempStreak);
        const d = new Date(cursor);
        d.setDate(d.getDate() - 1);
        cursor = d.toISOString().slice(0, 10);
      } else {
        if (date === today) {
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

module.exports = router;

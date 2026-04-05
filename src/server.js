require('dotenv').config();
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const authRoutes  = require('./routes/auth');
const todoRoutes  = require('./routes/todos');
const groupRoutes = require('./routes/groups');
const userRoutes  = require('./routes/users');

const app = express();

// Middleware
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://10.0.2.2:3000',
  process.env.CORS_ORIGIN,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  credentials: true,
}));
app.use(express.json());

// Routes
app.use('/api/auth',   authRoutes);
app.use('/api/todos',  todoRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/users',  userRoutes);

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// 404
app.use((req, res) => res.status(404).json({ message: `Route ${req.method} ${req.path} not found.` }));

// Error handler
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: 'Internal server error.' });
});

// DB + start
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/refining_fire';

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    // app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
    app.listen(PORT, '0.0.0.0', () => console.log(`Server running on http://0.0.0.0:${PORT}`));
  })
  .catch(err => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });

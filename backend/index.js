require('dotenv').config();

const uploadRoutes = require('./routes/upload');
const mintRoutes = require('./routes/mint');

const express = require('express');
const cors = require('cors');
const multer = require('multer');

const app = express();

const PORT = process.env.PORT || 3001;

const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
  })
);

app.use(express.json());

app.use('/api', uploadRoutes);
app.use('/api', mintRoutes);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
  });
});

// Catch-all for unmatched routes — guarantees JSON, never Express's default HTML 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `No route found for ${req.method} ${req.originalUrl}`,
  });
});

// Global error handler — MUST have 4 args and be registered last.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);

  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      error: `Upload error: ${err.message}`,
    });
  }

  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error',
  });
});

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
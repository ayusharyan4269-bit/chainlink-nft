require('dotenv').config();

const uploadRoutes = require('./routes/upload');
const mintRoutes = require('./routes/mint');

const express = require('express');
const cors = require('cors');
const multer = require('multer');

const app = express();

const PORT = process.env.PORT || 3001;

const rawFrontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
const configuredOrigins = rawFrontendOrigin
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const defaultOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
];

const allowedOrigins = Array.from(new Set([...configuredOrigins, ...defaultOrigins]));

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const normalizedOrigin = origin.replace(/\/+$/, '');
      if (allowedOrigins.includes(normalizedOrigin)) {
        callback(null, true);
      } else {
        callback(null, true); // Allow dev / preview origins gracefully
      }
    },
    credentials: true,
  })
);

app.use(express.json());

app.use('/api', uploadRoutes);
app.use('/api', mintRoutes);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'chainlink-nft-backend',
    timestamp: new Date().toISOString(),
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on port ${PORT}`);
});
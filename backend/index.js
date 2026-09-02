require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const uploadRoutes = require('./routes/upload');
const organizationsRoutes = require('./routes/organizations');
const schemaRoutes = require('./routes/schema');
const metricsRoutes = require('./routes/metrics');
const insightRoutes = require('./routes/insight');
const pdfRoutes = require('./routes/pdf');
const ascendaiRoutes = require('./routes/ascendai');
const { requireAuth } = require('./middleware/requireAuth');
const { initDb, DB_PATH } = require('./db');

const PORT = process.env.PORT || 3001;

// Explicit CORS allowlist. Configure per environment with CORS_ORIGINS (a
// comma-separated list); the default covers the local Vite dev server and its
// port-fallback range.
const DEFAULT_CORS_ORIGINS = Array.from({ length: 12 }, (_, i) => 5173 + i).flatMap(
  (p) => [`http://localhost:${p}`, `http://127.0.0.1:${p}`]
);
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',')
  : DEFAULT_CORS_ORIGINS
)
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
app.use(
  cors({
    // A request with no Origin header (curl, server-to-server, same-origin) is
    // allowed through; a browser request from an unlisted origin gets no
    // Access-Control-Allow-Origin header, so the browser blocks it.
    origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.includes(origin)),
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// --- open routes -----------------------------------------------------------
app.use('/api', healthRoutes); // /api/health — no data, used for uptime checks
app.use('/api/auth', authRoutes); // signup / login / logout / me

// --- everything below requires a valid session --------------------------
app.use('/api', requireAuth);
app.use('/api', uploadRoutes);
app.use('/api', organizationsRoutes);
app.use('/api', schemaRoutes);
app.use('/api', metricsRoutes);
app.use('/api', insightRoutes);
app.use('/api', pdfRoutes);
app.use('/api', ascendaiRoutes);

// Centralised error handler — keeps failures as clean JSON, not stack dumps.
app.use((err, _req, res, _next) => {
  const status = err.statusCode || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ ok: false, error: err.message });
});

// Initialise the database (creates/converges tables) before listening.
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`AscendDV backend listening on http://localhost:${PORT}`);
      console.log(`Postgres: ${DB_PATH}`);
    });
  })
  .catch((err) => {
    console.error('Database initialisation failed:', err.message);
    process.exit(1);
  });

module.exports = app;

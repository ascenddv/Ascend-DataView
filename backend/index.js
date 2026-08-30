require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const uploadRoutes = require('./routes/upload');
const schemaRoutes = require('./routes/schema');
const metricsRoutes = require('./routes/metrics');
const insightRoutes = require('./routes/insight');
const { requireAuth } = require('./middleware/requireAuth');
const { initDb, DB_PATH } = require('./db');

const PORT = process.env.PORT || 3001;

const app = express();
// Dev frontend runs on a different port; allow its credentialed requests.
app.use(
  cors({
    origin: (origin, cb) => cb(null, true),
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
app.use('/api', schemaRoutes);
app.use('/api', metricsRoutes);
app.use('/api', insightRoutes);

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

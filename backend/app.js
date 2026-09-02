/**
 * The Express app, with no network binding — shared by the local dev server
 * (index.js, which calls app.listen) and the Vercel serverless entry
 * (../api/index.js, which exports this app directly).
 *
 * Schema bootstrap (initDb) is lazy: the first /api request per process waits
 * for it, so a cold serverless invocation converges the schema before serving.
 * initDb is idempotent, so re-running it on every cold start is safe.
 */

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
const { initDb } = require('./db');

// Explicit CORS allowlist. On a same-origin deployment (frontend + /api served
// from one domain, e.g. Vercel) CORS is not exercised at all; this only matters
// if the API is called cross-origin. Configure with CORS_ORIGINS (comma list).
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
app.set('trust proxy', 1); // behind Vercel's proxy — needed for rate-limit + secure cookies

app.use(
  cors({
    origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.includes(origin)),
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// --- lazy schema bootstrap ------------------------------------------------
let dbReadyPromise = null;
function ready() {
  if (!dbReadyPromise) {
    dbReadyPromise = initDb().catch((err) => {
      dbReadyPromise = null; // allow the next request to retry
      throw err;
    });
  }
  return dbReadyPromise;
}
app.ready = ready;

// --- open routes (no DB needed) ----------------------------------------
app.use('/api', healthRoutes); // /api/health — liveness check, works with no DB

// Everything past here needs the schema converged.
app.use('/api', (_req, res, next) => {
  ready().then(() => next()).catch(next);
});

app.use('/api/auth', authRoutes); // signup / login / logout / me

// --- everything below requires a valid session -----------------------
app.use('/api', requireAuth);
app.use('/api', uploadRoutes);
app.use('/api', organizationsRoutes);
app.use('/api', schemaRoutes);
app.use('/api', metricsRoutes);
app.use('/api', insightRoutes);
app.use('/api', pdfRoutes);
app.use('/api', ascendaiRoutes);

// Centralised error handler — clean JSON, not stack dumps.
app.use((err, _req, res, _next) => {
  const status = err.statusCode || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ ok: false, error: err.message });
});

module.exports = app;

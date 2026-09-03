/**
 * The Express app, with no network binding — shared by the local dev server
 * (index.js, which calls app.listen) and the Vercel serverless entry
 * (../api/index.js, which exports this app directly).
 *
 * NO schema DDL at request time. The schema is applied by `npm run migrate`
 * (backend/db/migrate.js) as a deploy step; the first /api request per process
 * only checks the DB is reachable (SELECT 1).
 */

const express = require('express');
const helmet = require('helmet');
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
const accountRoutes = require('./routes/account');
const { requireAuth } = require('./middleware/requireAuth');
const { getDb } = require('./db');
const { requestLog, captureError } = require('./services/observability');
const { checkProductionConfig } = require('./config/productionGuard');

// Runs once per process on require. In a prod-like env a missing/weak secret
// prints a loud banner + a CONFIG_GUARD signal; it never throws.
checkProductionConfig();

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

// Security headers. This is a JSON API (no inline scripts/styles served from
// here — the SPA is static, served by Vercel), so the CSP is deliberately tight.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'none'"],
        'form-action': ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    // HSTS is set by Vercel's edge; leave it to the platform.
    hsts: false,
  })
);
app.use((_req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  next();
});

app.use(
  cors({
    origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.includes(origin)),
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// One structured line per request (method, path, status, ms, orgId). The
// observability layer redacts secrets; nothing here logs a body or a header.
app.use((req, res, next) => {
  const start = Date.now();
  // Capture the path now — by the time 'finish' fires, sub-router dispatch has
  // rewritten req.url. req.originalUrl is stable; drop the query string.
  const path = (req.originalUrl || req.url || '').split('?')[0];
  res.on('finish', () => {
    requestLog({
      method: req.method,
      path,
      status: res.statusCode,
      ms: Date.now() - start,
      orgId: req.auth && req.auth.orgId,
    });
  });
  next();
});

// --- DB reachability check (no DDL) --------------------------------------
let dbReadyPromise = null;
function ready() {
  if (!dbReadyPromise) {
    dbReadyPromise = getDb()
      .query('SELECT 1')
      .catch((err) => {
        dbReadyPromise = null; // let the next request retry
        throw err;
      });
  }
  return dbReadyPromise;
}
app.ready = ready;

// --- open routes (no DB needed) ----------------------------------------
app.use('/api', healthRoutes); // /api/health — liveness check, works with no DB

// Everything past here needs a reachable database.
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
app.use('/api', accountRoutes);

// Centralised error handler — clean JSON, not stack dumps. For 5xx the real
// error is logged server-side; the client gets a generic message so DB errors,
// stack fragments and connection details never leak.
app.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res
      .status(413)
      .json({ ok: false, error: 'That file is too large — the maximum upload size is 4 MB.' });
  }
  const status = err.statusCode || 500;
  if (status >= 500) {
    captureError(err, {
      code: 'ROUTE_5XX',
      cause: err.code || null,
      method: _req.method,
      path: (_req.originalUrl || _req.url || '').split('?')[0],
      orgId: _req.auth && _req.auth.orgId,
    });
    return res.status(status).json({ ok: false, error: 'Something went wrong. Please try again.' });
  }
  res.status(status).json({ ok: false, error: err.message });
});

module.exports = app;

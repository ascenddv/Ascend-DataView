/**
 * Rate limiting for the auth endpoints only.
 *
 * 10 requests / 15 minutes / IP on POST /api/auth/login and POST /api/auth/signup
 * — enough for a real user fumbling a password, tight enough to blunt brute-force
 * and signup-spam. On exceeding it, a clean 429 in the same shape every other
 * error in this app uses ({ ok: false, error }).
 *
 * No other route is limited.
 *
 * The count lives in Postgres (PgRateStore), not process memory, so the limit
 * holds across serverless instances. `app.set('trust proxy', 1)` in app.js makes
 * req.ip the real client IP behind Vercel's proxy.
 */

const rateLimit = require('express-rate-limit');
const { PgRateStore } = require('../services/pgRateStore');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: new PgRateStore({ prefix: 'auth:' }),
  handler: (_req, res) => {
    res.status(429).json({
      ok: false,
      error: 'Too many attempts. Please wait about 15 minutes and try again.',
    });
  },
});

module.exports = { authLimiter };

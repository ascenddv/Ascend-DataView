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
 * Note for deployment: behind a proxy (Railway/Render) set `app.set('trust proxy', 1)`
 * so req.ip is the real client, not the proxy. Not enabled here (local dev), and
 * enabling it blindly lets clients spoof X-Forwarded-For.
 */

const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      ok: false,
      error: 'Too many attempts. Please wait about 15 minutes and try again.',
    });
  },
});

module.exports = { authLimiter };

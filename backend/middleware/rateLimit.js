/**
 * Rate limiting.
 *
 * `authLimiter` — 10 requests / 15 minutes / IP on POST /api/auth/login and
 * POST /api/auth/signup. Enough for a real user fumbling a password, tight
 * enough to blunt brute-force and signup-spam.
 *
 * The four limiters below (Phase 23) protect the expensive endpoints — the LLM
 * calls, the PDF render, the file parse — that used to have no limit at all.
 * Each has its own window/ceiling and its own PgRateStore prefix, and is keyed
 * per **org + user** rather than per IP: a shared office NAT must not let one
 * tenant's abuse rate-limit another, and the thing actually being contained is
 * one looping client or one runaway script. They sit after `requireAuth`, so
 * `req.auth` is always populated by the time the key is generated.
 *
 * On exceeding a hard limit: a clean 429 in the same shape every other error in
 * this app uses ({ ok: false, error }). The chat burst limiter is the one
 * exception — see `chatBurstLimiter`.
 *
 * Every count lives in Postgres (PgRateStore), not process memory, so a limit
 * holds across serverless instances. `app.set('trust proxy', 1)` in app.js
 * makes req.ip the real client IP behind Vercel's proxy.
 */

const rateLimit = require('express-rate-limit');
const { PgRateStore } = require('../services/pgRateStore');
const {
  INSIGHT_RATE_LIMIT,
  INSIGHT_RATE_WINDOW_MS,
  ASCENDAI_CHAT_BURST_LIMIT,
  ASCENDAI_CHAT_BURST_WINDOW_MS,
  PDF_RATE_LIMIT,
  PDF_RATE_WINDOW_MS,
  UPLOAD_RATE_LIMIT,
  UPLOAD_RATE_WINDOW_MS,
  INVITE_RATE_LIMIT,
  INVITE_RATE_WINDOW_MS,
  EXPORT_RATE_LIMIT,
  EXPORT_RATE_WINDOW_MS,
} = require('../config/thresholds');

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

// Key an authenticated limiter by the acting org + user, not the IP.
const perUserKey = (req) => `${req.auth.orgId}:${req.auth.userId}`;

function hardLimiter({ prefix, limit, windowMs, error }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: perUserKey,
    // The key is org+user, never req.ip — the IPv6 fallback check doesn't apply.
    validate: { keyGeneratorIpFallback: false },
    store: new PgRateStore({ prefix }),
    handler: (_req, res) => res.status(429).json({ ok: false, error }),
  });
}

const insightLimiter = hardLimiter({
  prefix: 'insight:',
  limit: INSIGHT_RATE_LIMIT,
  windowMs: INSIGHT_RATE_WINDOW_MS,
  error: 'Too many insight requests in a short time. Please wait a few minutes and try again.',
});

const pdfLimiter = hardLimiter({
  prefix: 'pdf:',
  limit: PDF_RATE_LIMIT,
  windowMs: PDF_RATE_WINDOW_MS,
  error: 'Too many report downloads in a short time. Please wait a few minutes and try again.',
});

const uploadLimiter = hardLimiter({
  prefix: 'upload:',
  limit: UPLOAD_RATE_LIMIT,
  windowMs: UPLOAD_RATE_WINDOW_MS,
  error: 'Too many uploads in a short time. Please wait a few minutes and try again.',
});

const inviteLimiter = hardLimiter({
  prefix: 'invite:',
  limit: INVITE_RATE_LIMIT,
  windowMs: INVITE_RATE_WINDOW_MS,
  error: 'Too many invitations sent in a short time. Please wait a few minutes and try again.',
});

const exportLimiter = hardLimiter({
  prefix: 'export:',
  limit: EXPORT_RATE_LIMIT,
  windowMs: EXPORT_RATE_WINDOW_MS,
  error: 'Too many data exports in a short time. Please wait a few minutes and try again.',
});

// AscendAI chat burst — a per-minute ceiling distinct from the per-org DAILY
// cap enforced in routes/ascendai.js. A hit here does NOT surface as a 429:
// the chat UI already renders { ok: true, status: 'rate_limited', reply }, so a
// too-fast sender gets the same friendly in-conversation message the daily cap
// gives, just with a burst-specific reason. Because it's middleware, a
// burst-limited turn never reaches the provider or the daily-usage counter.
const chatBurstLimiter = rateLimit({
  windowMs: ASCENDAI_CHAT_BURST_WINDOW_MS,
  limit: ASCENDAI_CHAT_BURST_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: perUserKey,
  validate: { keyGeneratorIpFallback: false },
  store: new PgRateStore({ prefix: 'chat-burst:' }),
  handler: (_req, res) => {
    res.json({
      ok: true,
      status: 'rate_limited',
      reply:
        "You're sending messages faster than AscendAI can answer them. Please wait a few seconds and try again.",
      reason: `Burst limit of ${ASCENDAI_CHAT_BURST_LIMIT} messages per minute reached for your account.`,
    });
  },
});

module.exports = {
  authLimiter,
  insightLimiter,
  chatBurstLimiter,
  pdfLimiter,
  uploadLimiter,
  inviteLimiter,
  exportLimiter,
};

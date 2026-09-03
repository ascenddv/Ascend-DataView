/**
 * Card eligibility and mapping thresholds.
 *
 * These numbers must never be hardcoded inline anywhere else — the eligibility
 * engine and ingestion layer reference these constants by name.
 */

// --- Card eligibility (from CLAUDE.md) ---
const MIN_PERIODS_FOR_GROWTH_RATE = 2;
const MIN_PERIODS_FOR_TREND_CARD = 3;
const MIN_CATEGORIES_FOR_COMPARISON_CARD = 2;
const MIN_SUBMETRICS_FOR_HEALTH_SCORE = 1;
const LLM_MAPPING_AUTO_ACCEPT_CONFIDENCE = 0.8;

// --- AI insight: historical context (Phase 15) ---
// Fewest periods of a dimension's primary metric needed before we hand the model
// any trend / self-baseline framing. Below this the insight degrades to the
// Stage 2 single-period narrative rather than inventing a trend.
const MIN_PERIODS_FOR_TREND_SIGNAL = 4;
// How many trailing periods (before the latest) form the "own recent normal"
// baseline and the consistency window.
const TREND_TRAILING_WINDOW = 6;
// A latest-vs-trailing-average move within this fraction reads as "flat", not a
// direction — keeps ordinary noise from being narrated as a trend.
const TREND_FLAT_BAND_PCT = 0.02;

// --- AscendAI chat (Stage 4) ---
// Hard ceiling on how many model<->tool round trips a single chat turn may make
// before we stop and return whatever the model has. Bounds cost and latency and
// stops a pathological tool loop; a normal answer needs 1-2.
const ASCENDAI_MAX_TOOL_ITERATIONS = 5;

// How many of the most recent conversation messages (user + assistant) are
// loaded as context for a turn. Caps tokens per call — history is a sliding
// window, never the whole unbounded transcript.
const ASCENDAI_HISTORY_WINDOW_MESSAGES = 12;

// Per-organization ceiling on AscendAI chat turns per calendar day (UTC).
// Defense in depth alongside the prepaid balance: stops one org, one user, or a
// looping client from draining the balance quickly. A turn that reaches the
// provider counts whether it succeeds or fails.
const ASCENDAI_DAILY_MESSAGE_LIMIT_PER_ORG = 50;

// --- Storage guards & retention (Stage 5, Phase 22) ---
// A stored chat message is truncated to this many characters before it goes in
// chat_messages. The user always saw the full reply in the UI; the stored copy
// only feeds future-turn context, and DeepSeek replies are ~1-2 KB.
const CHAT_MESSAGE_STORED_MAX_CHARS = 8000;
// A paused-upload payload (parsed rows + mapping) larger than this is refused —
// too many rows to hold in the pending_uploads row for a confirmation step.
const PENDING_UPLOAD_MAX_BYTES = 3 * 1024 * 1024;
// Retention windows for the prune job (backend/db pruneOldRows, wired to cron in
// Phase 31). ascendai_usage is kept longer for year-over-year cost visibility.
const CHAT_MESSAGE_RETENTION_DAYS = 90;
const ASCENDAI_USAGE_RETENTION_DAYS = 400;

// --- Rate limiting on the expensive endpoints (Stage 5, Phase 23) ---
// Every LLM / CPU / parse endpoint gets its own DB-backed limiter (shared
// across serverless instances via PgRateStore), keyed per org + user rather
// than per IP so a shared office NAT can't let one tenant exhaust another's
// budget. These are burst/abuse ceilings set well above any real interactive
// use; the AscendAI per-org DAILY cap above is a separate, coarser control.
const INSIGHT_RATE_LIMIT = 20;
const INSIGHT_RATE_WINDOW_MS = 10 * 60 * 1000;
// AscendAI chat burst: a short-window ceiling on top of the daily cap. A hit
// here is NOT a 429 — the chat route returns the same friendly
// { status: 'rate_limited' } shape the daily cap uses.
const ASCENDAI_CHAT_BURST_LIMIT = 8;
const ASCENDAI_CHAT_BURST_WINDOW_MS = 60 * 1000;
const PDF_RATE_LIMIT = 10;
const PDF_RATE_WINDOW_MS = 10 * 60 * 1000;
// Covers POST /api/upload and POST /api/upload/confirm together.
const UPLOAD_RATE_LIMIT = 30;
const UPLOAD_RATE_WINDOW_MS = 10 * 60 * 1000;
// Team invitations send an email each — cap the rate an owner can fire them.
const INVITE_RATE_LIMIT = 20;
const INVITE_RATE_WINDOW_MS = 10 * 60 * 1000;

// --- Team invitations (Stage 5, Phase 26) ---
const INVITATION_TTL_HOURS = 72;

// --- Auth: email verification & password reset (Stage 5, Phase 25) ---
// Minimum password length, checked in validateCredentials. Bumped from 8: a
// commercial launch wants a real floor, and a separate HIBP breach check
// (services/passwordCheck.js) rejects known-compromised passwords on top of it.
const PASSWORD_MIN_LENGTH = 10;
// Single-use token lifetimes. Verification is generous (people check email
// late); a reset link is short-lived because it can set a new password.
const EMAIL_VERIFICATION_TTL_HOURS = 24;
const PASSWORD_RESET_TTL_HOURS = 1;
// Consumed / expired verification + reset rows are deleted by the prune job
// this many days after creation (they carry no lasting value).
const AUTH_TOKEN_RETENTION_DAYS = 7;

// --- Ingestion: revenue subcategory reconciliation ---
// The revenue_* fields are an *optional, possibly partial* breakdown. The
// sum-to-revenue check only runs when ALL four subcategory fields are present
// for a row (see ingest.js) — a partial breakdown was never meant to account
// for the whole, so it is not an error. This constant is the allowed drift
// between the subcategory sum and revenue before it counts as a mismatch
// (min $1, for rounding).
const REVENUE_RECONCILE_TOLERANCE_PCT = 0.01;

module.exports = {
  MIN_PERIODS_FOR_GROWTH_RATE,
  MIN_PERIODS_FOR_TREND_CARD,
  MIN_CATEGORIES_FOR_COMPARISON_CARD,
  MIN_SUBMETRICS_FOR_HEALTH_SCORE,
  LLM_MAPPING_AUTO_ACCEPT_CONFIDENCE,
  MIN_PERIODS_FOR_TREND_SIGNAL,
  TREND_TRAILING_WINDOW,
  TREND_FLAT_BAND_PCT,
  ASCENDAI_MAX_TOOL_ITERATIONS,
  ASCENDAI_HISTORY_WINDOW_MESSAGES,
  ASCENDAI_DAILY_MESSAGE_LIMIT_PER_ORG,
  CHAT_MESSAGE_STORED_MAX_CHARS,
  PENDING_UPLOAD_MAX_BYTES,
  CHAT_MESSAGE_RETENTION_DAYS,
  ASCENDAI_USAGE_RETENTION_DAYS,
  PASSWORD_MIN_LENGTH,
  EMAIL_VERIFICATION_TTL_HOURS,
  PASSWORD_RESET_TTL_HOURS,
  AUTH_TOKEN_RETENTION_DAYS,
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
  INVITATION_TTL_HOURS,
  REVENUE_RECONCILE_TOLERANCE_PCT,
};

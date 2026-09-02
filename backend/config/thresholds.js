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
  REVENUE_RECONCILE_TOLERANCE_PCT,
};

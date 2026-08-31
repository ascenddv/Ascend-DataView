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
  REVENUE_RECONCILE_TOLERANCE_PCT,
};

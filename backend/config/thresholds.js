/**
 * Card eligibility and mapping thresholds.
 *
 * These numbers must never be hardcoded inline anywhere else — the eligibility
 * engine and ingestion layer reference these constants by name.
 */

const MIN_PERIODS_FOR_GROWTH_RATE = 2;
const MIN_PERIODS_FOR_TREND_CARD = 3;
const MIN_CATEGORIES_FOR_COMPARISON_CARD = 2;
const MIN_SUBMETRICS_FOR_HEALTH_SCORE = 1;
const LLM_MAPPING_AUTO_ACCEPT_CONFIDENCE = 0.8;

module.exports = {
  MIN_PERIODS_FOR_GROWTH_RATE,
  MIN_PERIODS_FOR_TREND_CARD,
  MIN_CATEGORIES_FOR_COMPARISON_CARD,
  MIN_SUBMETRICS_FOR_HEALTH_SCORE,
  LLM_MAPPING_AUTO_ACCEPT_CONFIDENCE,
};

/**
 * Card Eligibility Engine.
 *
 * For each of the 5 card types, decide 'Available' | 'Limited' | 'Unavailable'
 * from what the stored data can actually support. Every numeric threshold comes
 * from config/thresholds.js by name — there are no bare numbers in this file.
 *
 * Not every card uses all three states: KPI, Trend and the Health Score card
 * have a meaningful middle ground; Bar Comparison and Risk/Opportunity are
 * naturally binary (the data is either comparable / a rule fired, or not).
 *
 * Pure: no I/O, no mutation.
 */

const {
  MIN_PERIODS_FOR_GROWTH_RATE,
  MIN_PERIODS_FOR_TREND_CARD,
  MIN_CATEGORIES_FOR_COMPARISON_CARD,
  MIN_SUBMETRICS_FOR_HEALTH_SCORE,
} = require('../config/thresholds');
const { HEALTH_DIMENSIONS } = require('./subMetrics');

const AVAILABLE = 'Available';
const LIMITED = 'Limited';
const UNAVAILABLE = 'Unavailable';

/**
 * KPI card — a headline number with a period-over-period change indicator.
 * Needs two periods to show the change; one period shows the number only.
 */
function kpiEligibility(periodCount) {
  if (periodCount >= MIN_PERIODS_FOR_GROWTH_RATE) return AVAILABLE;
  if (periodCount > 0) return LIMITED;
  return UNAVAILABLE;
}

/**
 * Trend card — a sparkline over time. MIN_PERIODS_FOR_TREND_CARD is the floor to
 * draw a line at all; exactly at the floor is renderable but too thin to
 * feature, so it is 'Limited'. Strictly more than the floor is 'Available'.
 */
function trendEligibility(periodCount) {
  if (periodCount > MIN_PERIODS_FOR_TREND_CARD) return AVAILABLE;
  if (periodCount === MIN_PERIODS_FOR_TREND_CARD) return LIMITED;
  return UNAVAILABLE;
}

/**
 * Bar Comparison card — compares categories (e.g. revenue by source). Needs at
 * least MIN_CATEGORIES_FOR_COMPARISON_CARD populated categories in the latest
 * period. Binary.
 */
function barComparisonEligibility(categoryCount) {
  return categoryCount >= MIN_CATEGORIES_FOR_COMPARISON_CARD ? AVAILABLE : UNAVAILABLE;
}

/**
 * Health Score card — surfaces the dimension scores. 'Available' when every
 * dimension scores, 'Limited' when at least MIN_SUBMETRICS_FOR_HEALTH_SCORE of
 * them do (but not all), 'Unavailable' when none do.
 */
function healthScoreEligibility(scoredDimensionCount) {
  if (scoredDimensionCount >= HEALTH_DIMENSIONS.length) return AVAILABLE;
  if (scoredDimensionCount >= MIN_SUBMETRICS_FOR_HEALTH_SCORE) return LIMITED;
  return UNAVAILABLE;
}

/**
 * Risk/Opportunity card — shows the fired deterministic rules. Binary: it is
 * 'Available' iff at least one rule fired.
 */
function riskOpportunityEligibility(firedCount) {
  return firedCount > 0 ? AVAILABLE : UNAVAILABLE;
}

/**
 * @param {{
 *   periodCount: number,
 *   comparisonCategoryCount: number,
 *   scoredDimensionCount: number,
 *   firedRuleCount: number
 * }} input
 * @returns {{ KPI, Trend, BarComparison, HealthScore, RiskOpportunity }}
 */
function evaluateCardEligibility(input) {
  const {
    periodCount = 0,
    comparisonCategoryCount = 0,
    scoredDimensionCount = 0,
    firedRuleCount = 0,
  } = input || {};

  return {
    KPI: kpiEligibility(periodCount),
    Trend: trendEligibility(periodCount),
    BarComparison: barComparisonEligibility(comparisonCategoryCount),
    HealthScore: healthScoreEligibility(scoredDimensionCount),
    RiskOpportunity: riskOpportunityEligibility(firedRuleCount),
  };
}

module.exports = {
  evaluateCardEligibility,
  kpiEligibility,
  trendEligibility,
  barComparisonEligibility,
  healthScoreEligibility,
  riskOpportunityEligibility,
  STATES: { AVAILABLE, LIMITED, UNAVAILABLE },
};

/**
 * Card Eligibility Engine — state boundaries for each of the 5 card types.
 * Values below reference the constants indirectly via the boundary they sit on:
 *   MIN_PERIODS_FOR_GROWTH_RATE = 2, MIN_PERIODS_FOR_TREND_CARD = 3,
 *   MIN_CATEGORIES_FOR_COMPARISON_CARD = 2, MIN_SUBMETRICS_FOR_HEALTH_SCORE = 1.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateCardEligibility,
  kpiEligibility,
  trendEligibility,
  barComparisonEligibility,
  healthScoreEligibility,
  riskOpportunityEligibility,
} = require('../services/eligibility');
const { HEALTH_DIMENSIONS } = require('../services/subMetrics');

const ALL_DIMS = HEALTH_DIMENSIONS.length; // 8 as of Phase 9

test('KPI: 0 -> Unavailable, 1 -> Limited, 2+ -> Available', () => {
  assert.equal(kpiEligibility(0), 'Unavailable');
  assert.equal(kpiEligibility(1), 'Limited');
  assert.equal(kpiEligibility(2), 'Available');
  assert.equal(kpiEligibility(12), 'Available');
});

test('Trend: <3 -> Unavailable, exactly 3 -> Limited, >3 -> Available', () => {
  assert.equal(trendEligibility(2), 'Unavailable');
  assert.equal(trendEligibility(3), 'Limited');
  assert.equal(trendEligibility(4), 'Available');
  assert.equal(trendEligibility(12), 'Available');
});

test('BarComparison: <2 categories -> Unavailable, >=2 -> Available', () => {
  assert.equal(barComparisonEligibility(0), 'Unavailable');
  assert.equal(barComparisonEligibility(1), 'Unavailable');
  assert.equal(barComparisonEligibility(2), 'Available');
  assert.equal(barComparisonEligibility(4), 'Available');
});

test('HealthScore card: 0 dims -> Unavailable, some -> Limited, all -> Available', () => {
  assert.equal(healthScoreEligibility(0), 'Unavailable');
  assert.equal(healthScoreEligibility(1), 'Limited');
  assert.equal(healthScoreEligibility(ALL_DIMS - 1), 'Limited');
  assert.equal(healthScoreEligibility(ALL_DIMS), 'Available');
  // no hardcoded dimension count — the boundary tracks HEALTH_DIMENSIONS.length
});

test('RiskOpportunity: no rules fired -> Unavailable, >=1 -> Available', () => {
  assert.equal(riskOpportunityEligibility(0), 'Unavailable');
  assert.equal(riskOpportunityEligibility(1), 'Available');
});

test('evaluateCardEligibility: sparse-shaped input (3 periods, no subcats, 1 dim, 1 rule)', () => {
  const cards = evaluateCardEligibility({
    periodCount: 3,
    comparisonCategoryCount: 0,
    scoredDimensionCount: 1,
    firedRuleCount: 1,
  });
  assert.deepEqual(cards, {
    KPI: 'Available',
    Trend: 'Limited',
    BarComparison: 'Unavailable',
    HealthScore: 'Limited',
    RiskOpportunity: 'Available',
  });
});

test('evaluateCardEligibility: rich-shaped input (12 periods, 4 subcats, all dims, rules)', () => {
  const cards = evaluateCardEligibility({
    periodCount: 12,
    comparisonCategoryCount: 4,
    scoredDimensionCount: ALL_DIMS,
    firedRuleCount: 2,
  });
  assert.deepEqual(cards, {
    KPI: 'Available',
    Trend: 'Available',
    BarComparison: 'Available',
    HealthScore: 'Available',
    RiskOpportunity: 'Available',
  });
});

test('evaluateCardEligibility: empty dataset -> everything Unavailable', () => {
  const cards = evaluateCardEligibility({});
  assert.deepEqual(cards, {
    KPI: 'Unavailable',
    Trend: 'Unavailable',
    BarComparison: 'Unavailable',
    HealthScore: 'Unavailable',
    RiskOpportunity: 'Unavailable',
  });
});

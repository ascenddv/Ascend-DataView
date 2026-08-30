/**
 * Deterministic risk / opportunity rules — the 4 from CLAUDE.md, exactly.
 *
 * These run entirely in code. The AI layer (Phase 5) only narrates whatever
 * these functions return; it never decides whether a rule fired.
 *
 * Each rule takes the standardized rows (sorted ascending by period) and returns
 * either `undefined` (did not fire / not enough data to evaluate) or:
 *   { type: 'risk' | 'opportunity', key, title, detail, metricValue }
 *
 * Pure: no I/O, no mutation.
 */

const { REVENUE_SUBCATEGORY_FIELDS } = require('../config/schema');
const { MIN_PERIODS_FOR_GROWTH_RATE } = require('../config/thresholds');
const {
  calculateGrowthRate,
  calculateChange,
  calculateAverage,
  calculateRatio,
  isFiniteNumber,
} = require('./metrics');

// Rule thresholds, verbatim from CLAUDE.md's "Risk / Opportunity rules" section.
const FUNDING_CONCENTRATION_MAX_SHARE = 0.5; // any single revenue_* > 50% of revenue
const CASH_RUNWAY_MIN_MONTHS = 3; // cash / avg trailing-3 expenses < 3 months
const REVENUE_DECLINE_MAX_GROWTH = -0.1; // revenue growth < -10%
const RETENTION_IMPROVEMENT_MIN_PP = 0.1; // retention rate up > 10 percentage points
const RETENTION_MIN_PERIODS = 3; // need the rate at t and t-1 => donors_total at t-1 and t-2

const REVENUE_SUBCATEGORY_LABELS = {
  revenue_donations: 'Donations',
  revenue_grants: 'Grants',
  revenue_events: 'Events',
  revenue_other: 'Other revenue',
};

const pct = (r) => `${(r * 100).toFixed(1)}%`;

/** Funding concentration risk: any single revenue_* subcategory > 50% of latest revenue. */
function fundingConcentrationRisk(rows) {
  const latest = rows[rows.length - 1];
  if (!latest || !isFiniteNumber(latest.revenue) || latest.revenue <= 0) return undefined;

  let top = null;
  for (const field of REVENUE_SUBCATEGORY_FIELDS) {
    const value = latest[field];
    if (!isFiniteNumber(value)) continue;
    const share = calculateRatio(value, latest.revenue);
    if (share !== null && share > FUNDING_CONCENTRATION_MAX_SHARE) {
      if (!top || share > top.share) top = { field, value, share };
    }
  }
  if (!top) return undefined;

  return {
    type: 'risk',
    key: 'funding_concentration',
    title: 'Funding concentration',
    detail: `${REVENUE_SUBCATEGORY_LABELS[top.field] || top.field} made up ${pct(
      top.share
    )} of revenue in ${latest.period_date}, above the ${pct(
      FUNDING_CONCENTRATION_MAX_SHARE
    )} concentration threshold.`,
    metricValue: top.share,
  };
}

/** Cash runway risk: cash_balance / avg(trailing-3 expenses) < 3 months. */
function cashRunwayRisk(rows) {
  const latest = rows[rows.length - 1];
  if (!latest || !isFiniteNumber(latest.cash_balance)) return undefined;

  const trailingExpenses = rows.slice(-3).map((r) => r.expenses).filter(isFiniteNumber);
  if (trailingExpenses.length === 0) return undefined;

  const avgExpenses = calculateAverage(trailingExpenses);
  const months = calculateRatio(latest.cash_balance, avgExpenses);
  if (months === null || months >= CASH_RUNWAY_MIN_MONTHS) return undefined;

  return {
    type: 'risk',
    key: 'cash_runway',
    title: 'Cash runway',
    detail: `Cash on hand ($${Math.round(
      latest.cash_balance
    ).toLocaleString()}) covers about ${months.toFixed(
      1
    )} months at the trailing 3-month average expense of $${Math.round(
      avgExpenses
    ).toLocaleString()}, below the ${CASH_RUNWAY_MIN_MONTHS}-month threshold.`,
    metricValue: months,
  };
}

/** Revenue decline risk: period-over-period revenue growth rate < -10%. */
function revenueDeclineRisk(rows) {
  if (rows.length < MIN_PERIODS_FOR_GROWTH_RATE) return undefined;
  const current = rows[rows.length - 1].revenue;
  const previous = rows[rows.length - 2].revenue;
  const growth = calculateGrowthRate(current, previous);
  if (growth === null || growth >= REVENUE_DECLINE_MAX_GROWTH) return undefined;

  return {
    type: 'risk',
    key: 'revenue_decline',
    title: 'Revenue decline',
    detail: `Revenue fell ${pct(Math.abs(growth))} from ${
      rows[rows.length - 2].period_date
    } to ${rows[rows.length - 1].period_date}, past the ${pct(
      Math.abs(REVENUE_DECLINE_MAX_GROWTH)
    )} decline threshold.`,
    metricValue: growth,
  };
}

/**
 * Donor retention opportunity: donor retention rate improved by more than 10
 * percentage points vs. the previous period.
 * retention rate for period t = donors_returning[t] / donors_total[t-1].
 */
function donorRetentionOpportunity(rows) {
  const n = rows.length;
  if (n < RETENTION_MIN_PERIODS) return undefined;

  const rateNow = calculateRatio(rows[n - 1].donors_returning, rows[n - 2].donors_total);
  const ratePrev = calculateRatio(rows[n - 2].donors_returning, rows[n - 3].donors_total);
  const changePP = calculateChange(rateNow, ratePrev);
  if (changePP === null || changePP <= RETENTION_IMPROVEMENT_MIN_PP) return undefined;

  return {
    type: 'opportunity',
    key: 'donor_retention',
    title: 'Donor retention improving',
    detail: `Donor retention rose from ${pct(ratePrev)} to ${pct(
      rateNow
    )} (${(changePP * 100).toFixed(1)} points) between ${
      rows[n - 2].period_date
    } and ${rows[n - 1].period_date}.`,
    metricValue: changePP,
  };
}

const RULES = [
  fundingConcentrationRisk,
  cashRunwayRisk,
  revenueDeclineRisk,
  donorRetentionOpportunity,
];

/** Run every rule; return the ones that fired, in rule order. */
function evaluateRiskRules(rows) {
  const sorted = Array.isArray(rows) ? rows : [];
  return RULES.map((rule) => rule(sorted)).filter(Boolean);
}

module.exports = {
  evaluateRiskRules,
  fundingConcentrationRisk,
  cashRunwayRisk,
  revenueDeclineRisk,
  donorRetentionOpportunity,
  // exported for tests / transparency
  FUNDING_CONCENTRATION_MAX_SHARE,
  CASH_RUNWAY_MIN_MONTHS,
  REVENUE_DECLINE_MAX_GROWTH,
  RETENTION_IMPROVEMENT_MIN_PP,
};

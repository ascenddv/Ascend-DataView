/**
 * buildMetrics(rows) — turn the stored standardized dataset into the full
 * payload the dashboard consumes: KPIs, time series, revenue-by-category, the
 * dimension health scores, fired risks/opportunities, and the eligibility
 * verdict for each of the 5 card types.
 *
 * Pure transform of the rows array — no I/O. The route layer fetches the rows
 * and serializes the result.
 */

const { FIELD_NAMES, REVENUE_SUBCATEGORY_FIELDS } = require('../config/schema');
const {
  calculateChange,
  calculateGrowthRate,
  calculateHealthScore,
} = require('./metrics');
const {
  buildSubMetrics,
  HEALTH_DIMENSIONS,
  DIMENSION_SUBMETRICS,
} = require('./subMetrics');
const { evaluateRiskRules } = require('./riskRules');
const { evaluateCardEligibility } = require('./eligibility');
const { detectGranularity } = require('./normalize');
const { cardConfidence } = require('./confidence');
const { buildTrends, trailingComparison } = require('./trends');

const LABELS = {
  revenue: 'Revenue',
  expenses: 'Expenses',
  cash_balance: 'Cash balance',
  donors_total: 'Total donors',
  volunteers_active: 'Active volunteers',
  program_participants: 'Program participants',
  website_visitors: 'Website visitors',
  social_followers: 'Social followers',
  revenue_donations: 'Donations',
  revenue_grants: 'Grants',
  revenue_events: 'Events',
  revenue_other: 'Other revenue',
};

const round = (v, dp = 4) =>
  v === null || v === undefined ? null : Number(v.toFixed(dp));

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * KPI: latest value + change vs the immediately preceding period, plus (Phase
 * 15) the latest against the organization's own trailing average when there is
 * enough history for that to mean something.
 */
function buildKpi(rows, field) {
  const n = rows.length;
  const latest = n >= 1 ? rows[n - 1][field] : null;
  const previous = n >= 2 ? rows[n - 2][field] : null;
  if (!isNum(latest)) return null;

  const trailing = trailingComparison(rows.map((r) => r[field]).filter(isNum));

  return {
    key: field,
    label: LABELS[field] || field,
    latest,
    previous: isNum(previous) ? previous : null,
    change: isNum(previous) ? calculateChange(latest, previous) : null,
    growthRate: isNum(previous) ? round(calculateGrowthRate(latest, previous)) : null,
    trailingAverage: trailing ? trailing.trailingAverage : null,
    vsTrailingAveragePct: trailing ? trailing.deltaFromTrailingPct : null,
  };
}

function buildSeries(rows) {
  const series = {};
  for (const field of FIELD_NAMES) {
    if (field === 'period_date') continue;
    const points = rows
      .filter((r) => isNum(r[field]))
      .map((r) => ({ period: r.period_date, value: r[field] }));
    if (points.length > 0) series[field] = points;
  }
  return series;
}

/** Revenue subcategories present in the latest period — input to the Bar Comparison card. */
function buildRevenueByCategory(rows) {
  const latest = rows[rows.length - 1];
  if (!latest) return [];
  return REVENUE_SUBCATEGORY_FIELDS.filter((f) => isNum(latest[f])).map((f) => ({
    key: f,
    label: LABELS[f] || f,
    value: latest[f],
  }));
}

function buildHealthScores(rows) {
  const { dimensions } = buildSubMetrics(rows);
  const out = {};

  for (const dimension of HEALTH_DIMENSIONS) {
    const info = dimensions[dimension];

    if (!info.eligible) {
      out[dimension] = {
        dimension,
        status: 'Unavailable',
        score: null,
        scoreExact: null,
        reason: info.reason,
        subScores: [],
        availableSubMetrics: info.available.map((s) => s.key),
        missingSubMetrics: info.unavailable.map((s) => s.key),
      };
      continue;
    }

    const scored = calculateHealthScore(dimension, info.available);
    out[dimension] = {
      ...scored,
      scoreExact: round(scored.scoreExact, 2),
      reason: null,
      subScores: scored.subScores.map((s) => ({
        key: s.key,
        native: info.available.find((a) => a.key === s.key)?.native ?? null,
        growthRate: round(s.growthRate),
        inverted: s.inverted,
        effectiveGrowthRate: round(s.effectiveGrowthRate),
        subScore: round(s.subScore, 2),
      })),
      availableSubMetrics: info.available.map((s) => s.key),
      missingSubMetrics: info.unavailable.map((s) => s.key),
    };
  }

  return out;
}

/** Schema fields that feed each dimension's health score (native + borrowed). */
function healthCardFields(dimension) {
  const fields = new Set();
  for (const def of DIMENSION_SUBMETRICS[dimension] || []) {
    if (def.field) fields.add(def.field);
    if (def.numerator) fields.add(def.numerator);
    if (def.denominator) fields.add(def.denominator);
  }
  return [...fields];
}

/** Schema fields each deterministic risk/opportunity rule reads. */
const RISK_CARD_FIELDS = {
  funding_concentration: ['revenue', ...REVENUE_SUBCATEGORY_FIELDS],
  cash_runway: ['cash_balance', 'expenses'],
  revenue_decline: ['revenue'],
  donor_retention: ['donors_returning', 'donors_total'],
};

/**
 * Confidence tier per rendered card, keyed exactly like the frontend registry's
 * card keys so it can attach each block without re-deriving anything.
 */
function buildConfidence(sorted, { healthScores, kpis, revenueByCategory, risksOpportunities }) {
  const periods = sorted.map((r) => r.period_date);
  const lastN = (n) => periods.slice(-n);
  const out = {};

  for (const dimension of HEALTH_DIMENSIONS) {
    if (healthScores[dimension]?.status !== 'Available') continue;
    out[`health-${dimension}`] = cardConfidence({
      fields: healthCardFields(dimension),
      rows: sorted,
      periods: lastN(3),
    });
  }

  for (const kpi of kpis) {
    out[`kpi-${kpi.key}`] = cardConfidence({
      fields: [kpi.key],
      rows: sorted,
      periods: lastN(2),
    });
  }

  for (const key of ['revenue', 'expenses', 'cash_balance']) {
    out[`trend-${key}`] = cardConfidence({ fields: [key], rows: sorted });
  }

  if (revenueByCategory.length >= 2) {
    out['bar-revenue-by-source'] = cardConfidence({
      fields: ['revenue', ...revenueByCategory.map((c) => c.key)],
      rows: sorted,
      periods: lastN(1),
    });
  }

  for (const r of risksOpportunities) {
    out[`risk-${r.key}`] = cardConfidence({
      fields: RISK_CARD_FIELDS[r.key] || [],
      rows: sorted,
      periods: lastN(3),
    });
  }

  return out;
}

function buildMetrics(rows) {
  const sorted = [...(Array.isArray(rows) ? rows : [])].sort((a, b) =>
    String(a.period_date).localeCompare(String(b.period_date))
  );

  const periodCount = sorted.length;
  const periods = sorted.map((r) => r.period_date);
  const { granularity } = detectGranularity(periods);

  const kpis = ['revenue', 'expenses', 'cash_balance', 'donors_total']
    .map((f) => buildKpi(sorted, f))
    .filter(Boolean);

  const revenueByCategory = buildRevenueByCategory(sorted);
  const healthScores = buildHealthScores(sorted);
  const risksOpportunities = evaluateRiskRules(sorted).map((r) => ({
    ...r,
    metricValue: round(r.metricValue),
  }));

  const scoredDimensionCount = HEALTH_DIMENSIONS.filter(
    (d) => healthScores[d].status === 'Available'
  ).length;

  const cards = evaluateCardEligibility({
    periodCount,
    comparisonCategoryCount: revenueByCategory.length,
    scoredDimensionCount,
    firedRuleCount: risksOpportunities.length,
  });

  const confidence = buildConfidence(sorted, {
    healthScores,
    kpis,
    revenueByCategory,
    risksOpportunities,
  });

  const trends = buildTrends(sorted, healthScores);

  return {
    dataset: {
      periodCount,
      periods,
      latestPeriod: periods[periodCount - 1] || null,
      granularity,
    },
    kpis,
    series: buildSeries(sorted),
    revenueByCategory,
    healthScores,
    risksOpportunities,
    cards,
    confidence,
    trends,
  };
}

module.exports = { buildMetrics };

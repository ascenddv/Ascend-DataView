/**
 * Deterministic historical context for the AI insight layer (Phase 15).
 *
 * For each scored dimension this derives — entirely in code, never by the model:
 *   - a trend DIRECTION over the trailing window: increasing / flat / declining
 *   - a CONSISTENCY read of that direction (how many recent steps agree, and the
 *     current consecutive run)
 *   - the latest period of the dimension's primary metric against the
 *     organization's OWN trailing average of that metric
 *
 * The model only narrates these; `generateInsight` passes them through its
 * allow-list and the prompt tells the model it may reference them when present.
 * With too little history a dimension simply gets no entry here, and the insight
 * falls back to the Stage 2 single-period style — same graceful degradation as
 * the rest of the app.
 *
 * Pure: a transform of the sorted rows array. No I/O.
 */

const {
  MIN_PERIODS_FOR_TREND_SIGNAL,
  TREND_TRAILING_WINDOW,
  TREND_FLAT_BAND_PCT,
} = require('../config/thresholds');
const { DIMENSION_SUBMETRICS, isNative } = require('./subMetrics');
const { calculateAverage, calculateRatio, isFiniteNumber } = require('./metrics');

const round = (v, dp = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(dp));

const METRIC_LABELS = {
  revenue: 'Revenue',
  expenses: 'Expenses',
  cash_balance: 'Cash balance',
  donors_total: 'Total donors',
  volunteers_active: 'Active volunteers',
  program_participants: 'Program participants',
  website_visitors: 'Website visitors',
  social_followers: 'Social followers',
  employees_total: 'Total employees',
  email_subscribers: 'Email subscribers',
  email_open_rate: 'Email open rate',
  donor_retention_rate_growth: 'Donor retention rate',
  turnover_rate_growth: 'Staff turnover rate',
  grant_award_rate_growth: 'Grant award rate',
  outcome_achievement_rate_growth: 'Outcome achievement rate',
  goal_completion_rate_growth: 'Goal completion rate',
  marketing_spend_efficiency_growth: 'Revenue per marketing dollar',
};

const labelFor = (key) => METRIC_LABELS[key] || key.replace(/_/g, ' ');

/**
 * The per-period series of a dimension's primary NATIVE metric — the first
 * native sub-metric in the dimension's definition. Plain fields yield their own
 * value; ratio sub-metrics yield numerator[t] / denominator[t - lag].
 * @returns {{ label: string, values: number[] } | null}
 */
function primarySeries(dimension, rows) {
  const defs = DIMENSION_SUBMETRICS[dimension] || [];
  const def = defs.find((d) => isNative(d, dimension));
  if (!def) return null;

  const values = [];
  if (def.kind === 'ratio') {
    const lag = def.denominatorLag || 0;
    for (let i = lag; i < rows.length; i += 1) {
      const r = calculateRatio(rows[i][def.numerator], rows[i - lag][def.denominator]);
      if (r !== null) values.push(r);
    }
  } else {
    for (const row of rows) {
      if (isFiniteNumber(row[def.field])) values.push(row[def.field]);
    }
  }
  return { label: labelFor(def.field || def.key), values };
}

/** Latest value vs the mean of the trailing window before it. */
function trailingComparison(values) {
  if (values.length < MIN_PERIODS_FOR_TREND_SIGNAL) return null;
  const window = values.slice(-(TREND_TRAILING_WINDOW + 1)); // latest + up to N priors
  const latest = window[window.length - 1];
  const priors = window.slice(0, -1);
  const trailingAverage = calculateAverage(priors);
  if (trailingAverage === null || trailingAverage === 0) return null;
  const deltaPct = (latest - trailingAverage) / trailingAverage;
  return {
    // delta% is computed from the unrounded values above; these are display-only
    latest: round(latest, 2),
    trailingAverage: round(trailingAverage, 2),
    periodsInBaseline: priors.length,
    deltaFromTrailingPct: round(deltaPct * 100, 1),
  };
}

/** Direction + consistency of the trailing window. */
function directionAndConsistency(values) {
  const window = values.slice(-(TREND_TRAILING_WINDOW + 1));
  const steps = [];
  for (let i = 1; i < window.length; i += 1) {
    const prev = window[i - 1];
    if (prev === 0) {
      steps.push(0);
      continue;
    }
    const stepPct = (window[i] - prev) / Math.abs(prev);
    steps.push(Math.abs(stepPct) <= TREND_FLAT_BAND_PCT ? 0 : Math.sign(stepPct));
  }

  const first = window[0];
  const last = window[window.length - 1];
  const overallPct = first === 0 ? 0 : (last - first) / Math.abs(first);
  let direction = 'flat';
  if (Math.abs(overallPct) > TREND_FLAT_BAND_PCT) direction = overallPct > 0 ? 'increasing' : 'declining';

  const dirSign = direction === 'increasing' ? 1 : direction === 'declining' ? -1 : 0;
  const agreeing = dirSign === 0 ? steps.filter((s) => s === 0).length : steps.filter((s) => s === dirSign).length;
  const ratio = steps.length ? agreeing / steps.length : 0;
  const consistency = ratio >= 0.8 ? 'consistent' : ratio >= 0.5 ? 'mixed' : 'choppy';

  // trailing consecutive steps in the trend's direction
  let consecutivePeriods = 0;
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    if (dirSign !== 0 ? steps[i] === dirSign : steps[i] === 0) consecutivePeriods += 1;
    else break;
  }

  return { direction, consistency, consecutivePeriods, periodsAnalyzed: window.length };
}

/**
 * @param {Array<Object>} rows - standardized rows, sorted ascending by period
 * @param {Record<string, {status: string}>} healthScores - from buildHealthScores
 * @returns {Record<string, object>} trend context per scored dimension with
 *   enough history; dimensions without it are simply absent.
 */
function buildTrends(rows, healthScores) {
  const sorted = Array.isArray(rows) ? rows : [];
  const out = {};

  for (const [dimension, h] of Object.entries(healthScores || {})) {
    if (!h || h.status !== 'Available') continue;
    const series = primarySeries(dimension, sorted);
    if (!series) continue;
    const comparison = trailingComparison(series.values);
    if (!comparison) continue;

    out[dimension] = {
      metric: series.label,
      ...directionAndConsistency(series.values),
      ...comparison,
    };
  }

  return out;
}

module.exports = { buildTrends, primarySeries, trailingComparison, directionAndConsistency };

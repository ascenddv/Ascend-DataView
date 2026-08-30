/**
 * Resolve which health-score sub-metrics are actually available from the stored
 * data, and compute each one's period-over-period growth rate.
 *
 * This is where the CLAUDE.md "Dimension -> sub-metric mapping" lives, plus two
 * rules layered on top of the raw formula:
 *
 *   1. ">= 2 periods of history" — a sub-metric needs its underlying field(s)
 *      populated in the latest two consecutive periods (MIN_PERIODS_FOR_GROWTH_RATE),
 *      and calculateGrowthRate must return a finite value for that pair.
 *
 *   2. Native-signal eligibility (established Stage 1, carries forward): a
 *      dimension only scores if >= 1 of its *available* sub-metrics is native to
 *      that dimension — the underlying field's schema category equals the
 *      dimension. A "borrowed" sub-metric (e.g. revenue growth feeding Growth,
 *      donor growth feeding Fundraising) contributes to the score once the
 *      dimension is otherwise eligible, but can't confer eligibility alone.
 *
 * Phase 9 adds 5 dimensions (People, Marketing, Fundraising, Impact, Strategic)
 * with no new shape: every sub-metric is either a plain field's growth or the
 * growth of a ratio series (`kind: 'ratio'`), the generalisation of Stage 1's
 * bespoke donor-retention-rate helper.
 *
 * Pure: a transform of the rows array, no I/O, no mutation.
 */

const { FIELDS_BY_NAME } = require('../config/schema');
const { MIN_PERIODS_FOR_GROWTH_RATE } = require('../config/thresholds');
const { calculateGrowthRate, calculateRatio, isFiniteNumber } = require('./metrics');

const HEALTH_DIMENSIONS = [
  'Financial',
  'Growth',
  'Community',
  'People',
  'Marketing',
  'Fundraising',
  'Impact',
  'Strategic',
];

/**
 * Dimension -> sub-metric definitions, verbatim from CLAUDE.md.
 *
 *   { key, field }                        -> growth of a plain field
 *   { key, kind:'ratio', numerator,
 *     denominator, denominatorLag? }       -> growth of a numerator/denominator
 *                                             ratio series; denominatorLag shifts
 *                                             the denominator to a prior period
 *                                             (donor retention uses last period's
 *                                             donor base)
 *   inverted: true                         -> negate the growth rate before
 *                                             scoring (rising value is bad:
 *                                             expense growth, turnover rate)
 */
const DIMENSION_SUBMETRICS = {
  Financial: [
    { key: 'revenue_growth', field: 'revenue', inverted: false },
    { key: 'expense_growth', field: 'expenses', inverted: true },
    { key: 'cash_balance_growth', field: 'cash_balance', inverted: false },
  ],
  Growth: [
    { key: 'revenue_growth', field: 'revenue', inverted: false },
    { key: 'donor_growth', field: 'donors_total', inverted: false },
    { key: 'website_visitor_growth', field: 'website_visitors', inverted: false },
    { key: 'social_follower_growth', field: 'social_followers', inverted: false },
  ],
  Community: [
    {
      key: 'donor_retention_rate_growth',
      kind: 'ratio',
      numerator: 'donors_returning',
      denominator: 'donors_total',
      denominatorLag: 1,
      inverted: false,
    },
    { key: 'volunteer_growth', field: 'volunteers_active', inverted: false },
    { key: 'program_participant_growth', field: 'program_participants', inverted: false },
  ],
  People: [
    { key: 'employee_growth', field: 'employees_total', inverted: false },
    {
      // turnover rate rising is bad -> inverted, parallel to expense growth
      // (resolved in Phase 9; CLAUDE.md records this).
      key: 'turnover_rate_growth',
      kind: 'ratio',
      numerator: 'employees_departed',
      denominator: 'employees_total',
      inverted: true,
    },
  ],
  Marketing: [
    { key: 'email_subscriber_growth', field: 'email_subscribers', inverted: false },
    { key: 'email_open_rate_trend', field: 'email_open_rate', inverted: false },
    {
      // revenue per marketing dollar, and its trend — borrowed revenue signal
      key: 'marketing_spend_efficiency_growth',
      kind: 'ratio',
      numerator: 'revenue',
      denominator: 'marketing_spend',
      inverted: false,
    },
  ],
  Fundraising: [
    {
      key: 'grant_award_rate_growth',
      kind: 'ratio',
      numerator: 'grant_applications_awarded',
      denominator: 'grant_applications_submitted',
      inverted: false,
    },
    { key: 'donor_growth', field: 'donors_total', inverted: false }, // borrowed from Community
  ],
  Impact: [
    {
      key: 'outcome_achievement_rate_growth',
      kind: 'ratio',
      numerator: 'program_outcomes_achieved',
      denominator: 'program_outcomes_targeted',
      inverted: false,
    },
    { key: 'program_participant_growth', field: 'program_participants', inverted: false }, // borrowed from Community
  ],
  Strategic: [
    {
      key: 'goal_completion_rate_growth',
      kind: 'ratio',
      numerator: 'goals_completed',
      denominator: 'goals_total',
      inverted: false,
    },
  ],
};

function isNative(def, dimension) {
  if (def.kind === 'ratio') {
    const num = FIELDS_BY_NAME[def.numerator];
    const den = FIELDS_BY_NAME[def.denominator];
    return Boolean(num && den) && num.category === dimension && den.category === dimension;
  }
  const f = FIELDS_BY_NAME[def.field];
  return Boolean(f) && f.category === dimension;
}

/**
 * Growth rate of a plain field over the latest two consecutive periods.
 * null if the field isn't populated in both of the last two rows (or the pair
 * has a zero base).
 */
function fieldGrowthRate(rows, field) {
  if (rows.length < MIN_PERIODS_FOR_GROWTH_RATE) return null;
  const current = rows[rows.length - 1][field];
  const previous = rows[rows.length - 2][field];
  if (!isFiniteNumber(current) || !isFiniteNumber(previous)) return null;
  return calculateGrowthRate(current, previous);
}

/**
 * Growth of a ratio series over the latest two periods.
 * ratio[t] = numerator[t] / denominator[t - denominatorLag].
 * null if any needed cell is missing or a base is zero. Needs
 * MIN_PERIODS_FOR_GROWTH_RATE + denominatorLag rows.
 */
function ratioGrowth(rows, { numerator, denominator, denominatorLag = 0 }) {
  const n = rows.length;
  if (n < MIN_PERIODS_FOR_GROWTH_RATE + denominatorLag) return null;
  const rateNow = calculateRatio(
    rows[n - 1][numerator],
    rows[n - 1 - denominatorLag][denominator]
  );
  const ratePrev = calculateRatio(
    rows[n - 2][numerator],
    rows[n - 2 - denominatorLag][denominator]
  );
  if (rateNow === null || ratePrev === null) return null;
  return calculateGrowthRate(rateNow, ratePrev);
}

function subMetricGrowthRate(rows, def) {
  return def.kind === 'ratio' ? ratioGrowth(rows, def) : fieldGrowthRate(rows, def.field);
}

/**
 * @param {Array<Object>} rows - standardized rows, sorted ascending by period
 * @returns {{ dimensions: Record<string, {
 *   eligible: boolean, reason: string|null,
 *   available: Array<{key,field,growthRate,inverted,native}>,
 *   unavailable: Array<{key,field,native}>
 * }> }}
 */
function buildSubMetrics(rows) {
  const sorted = Array.isArray(rows) ? rows : [];
  const dimensions = {};

  for (const dimension of HEALTH_DIMENSIONS) {
    const available = [];
    const unavailable = [];

    for (const def of DIMENSION_SUBMETRICS[dimension]) {
      const native = isNative(def, dimension);
      const growthRate = subMetricGrowthRate(sorted, def);

      if (growthRate === null) {
        unavailable.push({ key: def.key, field: def.field ?? null, native });
      } else {
        available.push({
          key: def.key,
          field: def.field ?? null,
          growthRate,
          inverted: Boolean(def.inverted),
          native,
        });
      }
    }

    const hasNative = available.some((sm) => sm.native);
    let reason = null;
    if (available.length === 0) {
      reason = `No sub-metrics available for ${dimension} (need a sub-metric field populated in the latest two periods).`;
    } else if (!hasNative) {
      const nativeKeys = DIMENSION_SUBMETRICS[dimension]
        .filter((d) => isNative(d, dimension))
        .map((d) => d.field || d.key);
      reason = `Only borrowed sub-metrics available for ${dimension}; needs a native signal (${nativeKeys.join(' or ')}).`;
    }

    dimensions[dimension] = {
      eligible: available.length > 0 && hasNative,
      reason,
      available,
      unavailable,
    };
  }

  return { dimensions };
}

module.exports = { buildSubMetrics, HEALTH_DIMENSIONS, DIMENSION_SUBMETRICS, isNative };

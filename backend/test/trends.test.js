/**
 * Phase 15 — deterministic historical context for the insight layer.
 *   - primary native series per dimension (plain field + ratio)
 *   - latest vs the org's own trailing average
 *   - direction / consistency / consecutive-run read
 *   - buildTrends only covers scored dimensions with enough history
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTrends,
  primarySeries,
  trailingComparison,
  directionAndConsistency,
} = require('../services/trends');
const { MIN_PERIODS_FOR_TREND_SIGNAL } = require('../config/thresholds');

const money = (vals) =>
  vals.map((v, i) => ({ period_date: `2025-${String(i + 1).padStart(2, '0')}-28`, revenue: v, expenses: v * 0.9, cash_balance: 1000 + i * 10 }));

test('trailingComparison needs a minimum run of history', () => {
  assert.equal(trailingComparison([100, 110, 120]), null); // < MIN (4)
  const c = trailingComparison([100, 100, 100, 100, 130]);
  assert.ok(c);
  assert.equal(c.trailingAverage, 100);
  assert.equal(c.latest, 130);
  assert.equal(c.deltaFromTrailingPct, 30);
  assert.equal(c.periodsInBaseline, 4);
});

test('trailingComparison caps the baseline at the trailing window', () => {
  const values = [1, 1, 1, 1, 1, 1, 1, 1, 1, 2]; // 10 points
  const c = trailingComparison(values);
  assert.equal(c.periodsInBaseline, 6); // TREND_TRAILING_WINDOW, not all 9 priors
});

test('direction: a steady climb reads increasing + consistent', () => {
  const d = directionAndConsistency([100, 108, 117, 126, 136, 147]);
  assert.equal(d.direction, 'increasing');
  assert.equal(d.consistency, 'consistent');
  assert.equal(d.consecutivePeriods, 5);
});

test('direction: noise inside the flat band reads flat', () => {
  const d = directionAndConsistency([100, 101, 99, 100.5, 100, 101]);
  assert.equal(d.direction, 'flat');
});

test('direction: a sustained fall reads declining with the run counted', () => {
  const d = directionAndConsistency([200, 180, 165, 150, 138, 120]);
  assert.equal(d.direction, 'declining');
  assert.equal(d.consecutivePeriods, 5);
});

test('primarySeries picks the first NATIVE metric — a plain field for Financial', () => {
  const s = primarySeries('Financial', money([10, 20, 30]));
  assert.equal(s.label, 'Revenue');
  assert.deepEqual(s.values, [10, 20, 30]);
});

test('primarySeries builds a ratio series for a ratio-native dimension (Strategic)', () => {
  const rows = [
    { period_date: '2025-01-31', goals_total: 10, goals_completed: 2 },
    { period_date: '2025-02-28', goals_total: 10, goals_completed: 4 },
    { period_date: '2025-03-31', goals_total: 10, goals_completed: 5 },
  ];
  const s = primarySeries('Strategic', rows);
  assert.equal(s.label, 'Goal completion rate');
  assert.deepEqual(s.values, [0.2, 0.4, 0.5]);
});

test('buildTrends: only scored dimensions with enough history get an entry', () => {
  const rows = money([100, 105, 110, 116, 122, 128, 135]);
  const withHistory = buildTrends(rows, {
    Financial: { status: 'Available' },
    Growth: { status: 'Unavailable' },
  });
  assert.ok(withHistory.Financial, 'scored dimension with history is present');
  assert.equal(withHistory.Growth, undefined, 'unscored dimension is absent');
  assert.equal(withHistory.Financial.direction, 'increasing');
  assert.equal(withHistory.Financial.metric, 'Revenue');
  assert.ok(withHistory.Financial.trailingAverage < withHistory.Financial.latest);

  const tooShort = buildTrends(money([100, 110, 120]), { Financial: { status: 'Available' } });
  assert.deepEqual(tooShort, {}, `fewer than ${MIN_PERIODS_FOR_TREND_SIGNAL} periods -> no trend context`);
});

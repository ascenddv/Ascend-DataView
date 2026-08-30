/**
 * Pure metric primitives + the v1 health-score formula.
 * Every function gets representative values and at least one edge case.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateGrowthRate,
  calculateChange,
  calculateAverage,
  calculateRatio,
  clamp,
  calculateHealthScore,
} = require('../services/metrics');

/* ------------------------------- calculateGrowthRate ------------------------ */

test('calculateGrowthRate: representative values', () => {
  assert.equal(calculateGrowthRate(110, 100), 0.1);
  assert.equal(calculateGrowthRate(90, 100), -0.1);
  assert.equal(calculateGrowthRate(100, 100), 0);
});

test('calculateGrowthRate: previous = 0 returns null (not Infinity/NaN/throw)', () => {
  assert.equal(calculateGrowthRate(50, 0), null);
  assert.equal(calculateGrowthRate(0, 0), null);
});

test('calculateGrowthRate: non-finite inputs return null', () => {
  assert.equal(calculateGrowthRate(null, 100), null);
  assert.equal(calculateGrowthRate(100, undefined), null);
  assert.equal(calculateGrowthRate(NaN, 100), null);
  assert.equal(calculateGrowthRate(Infinity, 100), null);
});

/* --------------------------------- calculateChange ------------------------- */

test('calculateChange: representative values', () => {
  assert.equal(calculateChange(120, 100), 20);
  assert.equal(calculateChange(80, 100), -20);
});

test('calculateChange: previous = 0 is valid, non-finite is null', () => {
  assert.equal(calculateChange(42, 0), 42);
  assert.equal(calculateChange(42, null), null);
});

/* -------------------------------- calculateAverage ------------------------- */

test('calculateAverage: representative values', () => {
  assert.equal(calculateAverage([2, 4, 6]), 4);
  assert.equal(calculateAverage([10]), 10);
});

test('calculateAverage: empty / all-non-finite returns null; finite entries filtered', () => {
  assert.equal(calculateAverage([]), null);
  assert.equal(calculateAverage([NaN, null, undefined]), null);
  assert.equal(calculateAverage([1, null, 3]), 2);
  assert.equal(calculateAverage('nope'), null);
});

/* --------------------------------- calculateRatio ------------------------- */

test('calculateRatio: representative values', () => {
  assert.equal(calculateRatio(1, 4), 0.25);
  assert.equal(calculateRatio(0, 5), 0);
});

test('calculateRatio: divide-by-zero and non-finite return null', () => {
  assert.equal(calculateRatio(5, 0), null);
  assert.equal(calculateRatio(null, 5), null);
});

/* ------------------------------------- clamp ----------------------------- */

test('clamp: within, over, under', () => {
  assert.equal(clamp(42, 0, 100), 42);
  assert.equal(clamp(150, 0, 100), 100);
  assert.equal(clamp(-5, 0, 100), 0);
});

/* -------------------------------- calculateHealthScore -------------------- */

test('calculateHealthScore: zero sub-metrics => Unavailable, never a number', () => {
  const r = calculateHealthScore('Growth', []);
  assert.equal(r.status, 'Unavailable');
  assert.equal(r.score, null);
  assert.equal(r.scoreExact, null);
});

test('calculateHealthScore: single sub-metric applies clamp(50 + g*100)', () => {
  const r = calculateHealthScore('Financial', [{ key: 'revenue_growth', growthRate: 0.1 }]);
  assert.equal(r.status, 'Available');
  assert.equal(r.subScores[0].subScore, 60);
  assert.equal(r.score, 60);
});

test('calculateHealthScore: inverted sub-metric negates growth (falling expenses help)', () => {
  const up = calculateHealthScore('Financial', [
    { key: 'expense_growth', growthRate: 0.2, inverted: true },
  ]);
  assert.equal(up.subScores[0].subScore, 30); // clamp(50 + (-0.2)*100)

  const down = calculateHealthScore('Financial', [
    { key: 'expense_growth', growthRate: -0.2, inverted: true },
  ]);
  assert.equal(down.subScores[0].subScore, 70); // clamp(50 + (0.2)*100)
});

test('calculateHealthScore: sub-scores are clamped to [0,100] before averaging', () => {
  const r = calculateHealthScore('Financial', [
    { key: 'a', growthRate: 0.8 }, // 130 -> 100
    { key: 'b', growthRate: -0.7 }, // -20 -> 0
  ]);
  assert.equal(r.subScores[0].subScore, 100);
  assert.equal(r.subScores[1].subScore, 0);
  assert.equal(r.scoreExact, 50);
  assert.equal(r.score, 50);
});

test('calculateHealthScore: dimension score is the average of available sub-scores', () => {
  const r = calculateHealthScore('Financial', [
    { key: 'a', growthRate: 0.1 }, // 60
    { key: 'b', growthRate: -0.1 }, // 40
    { key: 'c', growthRate: 0.0 }, // 50
  ]);
  assert.equal(r.scoreExact, 50);
});

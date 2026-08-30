/**
 * Pure metric primitives + the v1 health-score formula.
 *
 * Every function here is pure: no I/O, no mutation of inputs, deterministic.
 * Importing named constants from config is still pure (compile-time values).
 *
 * Missing-data contract: a calculation that has no defined answer returns
 * `null` — never `NaN`, never `Infinity`, never a thrown error, never a guessed
 * number. Callers treat `null` as "this input isn't available" and drop it.
 */

const { MIN_SUBMETRICS_FOR_HEALTH_SCORE } = require('../config/thresholds');

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Period-over-period growth rate: (current - previous) / previous.
 *
 * Edge case — `previous === 0`: growth rate is mathematically undefined without
 * a non-zero base (the formula would yield ±Infinity or NaN), so we return
 * `null`. The health-score engine then simply omits this sub-metric rather than
 * letting an infinite value dominate the average.
 */
function calculateGrowthRate(current, previous) {
  if (!isFiniteNumber(current) || !isFiniteNumber(previous)) return null;
  if (previous === 0) return null;
  return (current - previous) / previous;
}

/**
 * Absolute period-over-period change: current - previous.
 * `previous === 0` is fine here (the change is just `current`).
 */
function calculateChange(current, previous) {
  if (!isFiniteNumber(current) || !isFiniteNumber(previous)) return null;
  return current - previous;
}

/**
 * Arithmetic mean. Non-finite entries are ignored; the average of an empty list
 * (or a list with no finite values) is `null`, not 0 and not NaN.
 */
function calculateAverage(values) {
  if (!Array.isArray(values)) return null;
  const finite = values.filter(isFiniteNumber);
  if (finite.length === 0) return null;
  return finite.reduce((sum, v) => sum + v, 0) / finite.length;
}

/**
 * Ratio a / b. Returns `null` when `b === 0` (undefined ratio) or either
 * argument is non-finite. `a === 0` is a valid ratio of 0.
 */
function calculateRatio(a, b) {
  if (!isFiniteNumber(a) || !isFiniteNumber(b)) return null;
  if (b === 0) return null;
  return a / b;
}

/** Constrain `value` to the inclusive [min, max] range. */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Health score for one dimension — the v1 formula from CLAUDE.md, exactly:
 *
 *   subScore     = clamp(50 + (growthRate * 100), 0, 100)   // 0% growth => 50
 *   dimension    = average of all available sub-scores
 *   0 sub-metrics => Unavailable (never a default / zero / guess)
 *
 * `availableSubMetrics` is an array of already-resolved descriptors:
 *   { key: string, growthRate: number, inverted?: boolean }
 * `inverted: true` (expense growth) negates the growth rate before scoring, so
 * that falling expenses raise the score. Deciding *which* sub-metrics are
 * "available" — and the native-signal eligibility rule — happens upstream in
 * services/subMetrics.js; this function only applies the formula it is given.
 */
function calculateHealthScore(dimension, availableSubMetrics) {
  const subs = Array.isArray(availableSubMetrics) ? availableSubMetrics : [];

  if (subs.length < MIN_SUBMETRICS_FOR_HEALTH_SCORE) {
    return { dimension, status: 'Unavailable', score: null, scoreExact: null, subScores: [] };
  }

  const subScores = subs.map((sm) => {
    const effectiveGrowthRate = sm.inverted ? -sm.growthRate : sm.growthRate;
    const subScore = clamp(50 + effectiveGrowthRate * 100, 0, 100);
    return {
      key: sm.key,
      growthRate: sm.growthRate,
      inverted: Boolean(sm.inverted),
      effectiveGrowthRate,
      subScore,
    };
  });

  const scoreExact = calculateAverage(subScores.map((s) => s.subScore));

  return {
    dimension,
    status: 'Available',
    score: scoreExact === null ? null : Math.round(scoreExact),
    scoreExact,
    subScores,
  };
}

module.exports = {
  calculateGrowthRate,
  calculateChange,
  calculateAverage,
  calculateRatio,
  clamp,
  calculateHealthScore,
  isFiniteNumber,
};

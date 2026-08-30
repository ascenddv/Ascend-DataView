/**
 * Sanity tests for the deterministic normalizers. Run with `npm test`.
 * (The full pure-function test suite lands in Phase 3; this covers the
 * ingestion-critical parsing edge cases now, while they are fresh.)
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeNumber, normalizeDate, detectGranularity } = require('../services/normalize');

test('normalizeNumber: currency, commas, parentheses, percent', () => {
  assert.deepEqual(normalizeNumber('$12,400').value, 12400);
  assert.deepEqual(normalizeNumber('($800)').value, -800);
  assert.deepEqual(normalizeNumber('($1,200)').value, -1200);
  assert.deepEqual(normalizeNumber('  1500 ').value, 1500);
  assert.deepEqual(normalizeNumber('12%').value, 0.12);
  assert.deepEqual(normalizeNumber(-42).value, -42);
});

test('normalizeNumber: blank is not zero', () => {
  assert.equal(normalizeNumber('').state, 'blank');
  assert.equal(normalizeNumber('   ').state, 'blank');
  assert.equal(normalizeNumber(null).state, 'blank');
  assert.equal(normalizeNumber('N/A').state, 'blank');

  const zero = normalizeNumber('0');
  assert.equal(zero.state, 'ok');
  assert.equal(zero.value, 0);
});

test('normalizeNumber: unparseable is invalid, not a guess', () => {
  assert.equal(normalizeNumber('twelve').state, 'invalid');
  assert.equal(normalizeNumber('twelve').value, null);
});

test('normalizeDate: ISO and US formats fold to YYYY-MM-DD', () => {
  assert.equal(normalizeDate('2025-01-31').value, '2025-01-31');
  assert.equal(normalizeDate('01/31/2025').value, '2025-01-31');
  assert.equal(normalizeDate('1/5/2025').value, '2025-01-05');
  assert.equal(normalizeDate('2025/02/28').value, '2025-02-28');
  assert.equal(normalizeDate('04-30-2025').value, '2025-04-30');
});

test('normalizeDate: rejects impossible and unrecognized dates', () => {
  assert.equal(normalizeDate('2025-13-01').state, 'invalid');
  assert.equal(normalizeDate('2025-02-30').state, 'invalid');
  assert.equal(normalizeDate('March 2025').state, 'invalid');
  assert.equal(normalizeDate('').state, 'blank');
});

test('detectGranularity: monthly series with one gap', () => {
  const g = detectGranularity([
    '2025-01-31',
    '2025-02-28',
    '2025-04-30',
    '2025-05-31',
    '2025-06-30',
  ]);
  assert.equal(g.granularity, 'monthly');
  assert.equal(g.validPeriods, 5);
  assert.equal(g.gaps, 1);
});

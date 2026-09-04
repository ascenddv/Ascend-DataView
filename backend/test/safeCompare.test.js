/**
 * services/safeCompare.js — constant-time secret comparison (Phase 31 audit).
 * These lock in behaviour; the timing property itself is demonstrated by the
 * one-off probe in the phase-31 audit report, not asserted here (a timing
 * assertion in unit tests is inherently flaky).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { timingSafeStrEqual } = require('../services/safeCompare');

test('equal strings compare true', () => {
  assert.equal(timingSafeStrEqual('cron-secret-abc123', 'cron-secret-abc123'), true);
});

test('any difference compares false — including a one-byte and a long-common-prefix miss', () => {
  assert.equal(timingSafeStrEqual('cron-secret-abc123', 'Xron-secret-abc123'), false); // first byte
  assert.equal(timingSafeStrEqual('cron-secret-abc123', 'cron-secret-abc124'), false); // last byte
  assert.equal(timingSafeStrEqual('cron-secret-abc123', 'cron-secret-abc123-extra'), false); // length
  assert.equal(timingSafeStrEqual('cron-secret-abc123', 'cron'), false); // shorter
});

test('empty / null / undefined candidates never match a real secret and never throw', () => {
  for (const v of ['', null, undefined]) {
    assert.equal(timingSafeStrEqual(v, 's3cr3t-value-1234'), false);
  }
});

test('two empty strings are equal (callers must still reject an unset secret separately)', () => {
  assert.equal(timingSafeStrEqual('', ''), true);
});

test('non-string inputs are coerced, not crashed on', () => {
  assert.equal(timingSafeStrEqual(12345, '12345'), true);
  assert.equal(timingSafeStrEqual({}, '[object Object]'), true);
});

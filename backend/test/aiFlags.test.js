/**
 * config/aiFlags.js — the two global AI kill-switches. Default ON; only an
 * explicit falsey word turns a feature off.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { insightEnabled, ascendaiEnabled } = require('../config/aiFlags');

const saved = { i: process.env.INSIGHT_ENABLED, a: process.env.ASCENDAI_ENABLED };
test.afterEach(() => {
  for (const [k, v] of [['INSIGHT_ENABLED', saved.i], ['ASCENDAI_ENABLED', saved.a]]) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test('unset -> both enabled', () => {
  delete process.env.INSIGHT_ENABLED;
  delete process.env.ASCENDAI_ENABLED;
  assert.equal(insightEnabled(), true);
  assert.equal(ascendaiEnabled(), true);
});

test('falsey words disable', () => {
  for (const word of ['0', 'false', 'off', 'no', 'FALSE', ' Off ']) {
    process.env.INSIGHT_ENABLED = word;
    assert.equal(insightEnabled(), false, `"${word}" should disable`);
  }
});

test('any other value keeps it enabled', () => {
  for (const word of ['1', 'true', 'on', 'yes', '']) {
    process.env.ASCENDAI_ENABLED = word;
    assert.equal(ascendaiEnabled(), true, `"${word}" should stay enabled`);
  }
});

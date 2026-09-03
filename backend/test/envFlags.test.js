/**
 * config/envFlags.js — the one parser for "defaults-on" boolean env flags,
 * shared by config/aiFlags.js (INSIGHT_ENABLED / ASCENDAI_ENABLED) and
 * services/passwordCheck.js (HIBP_CHECK_ENABLED).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { flagIsOff, flagIsOn } = require('../config/envFlags');

test('unset / empty / whitespace -> ON', () => {
  for (const v of [undefined, null, '', '   ']) {
    assert.equal(flagIsOn(v), true, JSON.stringify(v));
    assert.equal(flagIsOff(v), false);
  }
});

test('the disable words (case-insensitive, trimmed) -> OFF', () => {
  for (const v of ['0', 'false', 'off', 'no', 'FALSE', 'Off', ' no ', '\tNO\n']) {
    assert.equal(flagIsOff(v), true, JSON.stringify(v));
    assert.equal(flagIsOn(v), false);
  }
});

test('anything else -> ON', () => {
  for (const v of ['1', 'true', 'on', 'yes', 'enabled', 'disabled', 'x']) {
    assert.equal(flagIsOn(v), true, JSON.stringify(v));
  }
});

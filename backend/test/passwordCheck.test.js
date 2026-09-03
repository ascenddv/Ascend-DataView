/**
 * services/passwordCheck.js — the HIBP k-anonymity breached-password check,
 * with global.fetch stubbed. The rule that matters: it only ever returns true
 * on a positive HIBP hit, and FAILS OPEN (false) on any error, timeout or when
 * the check is switched off.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { isBreachedPassword } = require('../services/passwordCheck');

const realFetch = global.fetch;
const realFlag = process.env.HIBP_CHECK_ENABLED;
test.afterEach(() => {
  global.fetch = realFetch;
  if (realFlag === undefined) delete process.env.HIBP_CHECK_ENABLED;
  else process.env.HIBP_CHECK_ENABLED = realFlag;
});

const suffixOf = (pw) =>
  crypto.createHash('sha1').update(pw, 'utf8').digest('hex').toUpperCase().slice(5);

test('returns true when HIBP lists the password hash suffix with a non-zero count', async () => {
  delete process.env.HIBP_CHECK_ENABLED;
  let calledUrl = null;
  global.fetch = async (url) => {
    calledUrl = url;
    return { ok: true, text: async () => `00000000000000000000000000000000000:3\r\n${suffixOf('hunter2')}:42\r\nAAAA:1` };
  };
  assert.equal(await isBreachedPassword('hunter2'), true);
  assert.match(calledUrl, /^https:\/\/api\.pwnedpasswords\.com\/range\/[0-9A-F]{5}$/);
});

test('returns false when the suffix is absent from the range response', async () => {
  delete process.env.HIBP_CHECK_ENABLED;
  global.fetch = async () => ({ ok: true, text: async () => 'DEADBEEF:2\r\nCAFEBABE:9' });
  assert.equal(await isBreachedPassword('a-very-unusual-passphrase-9173'), false);
});

test('fails open (false) when HIBP errors or is unreachable', async () => {
  delete process.env.HIBP_CHECK_ENABLED;
  global.fetch = async () => { throw new Error('ENOTFOUND'); };
  assert.equal(await isBreachedPassword('hunter2'), false);

  global.fetch = async () => ({ ok: false, status: 503, text: async () => '' });
  assert.equal(await isBreachedPassword('hunter2'), false);
});

test('short-circuits to false (no network) when HIBP_CHECK_ENABLED is off', async () => {
  process.env.HIBP_CHECK_ENABLED = '0';
  let called = false;
  global.fetch = async () => { called = true; return { ok: true, text: async () => `${suffixOf('hunter2')}:99` }; };
  assert.equal(await isBreachedPassword('hunter2'), false);
  assert.equal(called, false);
});

test('an empty password is never "breached"', async () => {
  assert.equal(await isBreachedPassword(''), false);
});

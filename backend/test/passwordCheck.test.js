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

// Capture the HIBP_DEGRADED signal (written to stderr by the observability layer)
// while an isBreachedPassword call runs.
async function withStderr(fn) {
  const original = process.stderr.write.bind(process.stderr);
  let out = '';
  process.stderr.write = (c) => { out += String(c); return true; };
  try {
    return { result: await fn(), stderr: out };
  } finally {
    process.stderr.write = original;
  }
}

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

test('fails open (false) AND logs HIBP_DEGRADED when the network throws', async () => {
  delete process.env.HIBP_CHECK_ENABLED;
  global.fetch = async () => { throw new Error('ENOTFOUND api.pwnedpasswords.com'); };
  const { result, stderr } = await withStderr(() => isBreachedPassword('hunter2'));
  assert.equal(result, false);
  assert.match(stderr, /"code":"HIBP_DEGRADED"/);
  assert.match(stderr, /ENOTFOUND/);
});

test('fails open (false) AND logs HIBP_DEGRADED on a non-2xx response', async () => {
  delete process.env.HIBP_CHECK_ENABLED;
  global.fetch = async () => ({ ok: false, status: 429, text: async () => '' });
  const { result, stderr } = await withStderr(() => isBreachedPassword('hunter2'));
  assert.equal(result, false);
  assert.match(stderr, /"code":"HIBP_DEGRADED"/);
  assert.match(stderr, /429/);
});

test('short-circuits to false (no network, no log) when HIBP_CHECK_ENABLED is a disable word', async () => {
  for (const word of ['0', 'false', 'off', 'no', 'NO', ' Off ']) {
    process.env.HIBP_CHECK_ENABLED = word;
    let called = false;
    global.fetch = async () => { called = true; return { ok: true, text: async () => `${suffixOf('hunter2')}:99` }; };
    const { result, stderr } = await withStderr(() => isBreachedPassword('hunter2'));
    assert.equal(result, false, `"${word}" should disable the check`);
    assert.equal(called, false, `"${word}" should skip the network call`);
    assert.doesNotMatch(stderr, /HIBP_DEGRADED/, `"${word}" is a deliberate off, not a degradation`);
  }
});

test('an empty password is never "breached"', async () => {
  assert.equal(await isBreachedPassword(''), false);
});

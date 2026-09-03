/**
 * services/email.js — the transactional-email boundary.
 *
 * Without RESEND_API_KEY it must never make a network call and must surface the
 * message + links for local dev / the phase gate. With the key it POSTs to
 * Resend with the right shape. The ready-made messages carry a working link
 * built from APP_BASE_URL.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const email = require('../services/email');

const realFetch = global.fetch;
const saved = { key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM, base: process.env.APP_BASE_URL };
test.afterEach(() => {
  global.fetch = realFetch;
  for (const [k, v] of [['RESEND_API_KEY', saved.key], ['EMAIL_FROM', saved.from], ['APP_BASE_URL', saved.base]]) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test('dev logger: no key -> no network, returns the extracted links', async () => {
  delete process.env.RESEND_API_KEY;
  global.fetch = async () => { throw new Error('must not be called'); };
  const res = await email.sendEmail({
    to: 'a@b.co',
    subject: 'hi',
    text: 'go here: https://app.example/verify-email?token=abc123 thanks',
  });
  assert.equal(res.ok, true);
  assert.equal(res.dev, true);
  assert.deepEqual(res.links, ['https://app.example/verify-email?token=abc123']);
});

test('verificationEmail / passwordResetEmail build links from APP_BASE_URL', () => {
  process.env.APP_BASE_URL = 'https://ascend.example/';
  const v = email.verificationEmail('user@x.co', 'tok_v');
  assert.equal(v.to, 'user@x.co');
  assert.match(v.subject, /verify/i);
  assert.ok(v.text.includes('https://ascend.example/verify-email?token=tok_v'));
  assert.ok(v.html.includes('https://ascend.example/verify-email?token=tok_v'));

  const r = email.passwordResetEmail('user@x.co', 'tok_r');
  assert.match(r.subject, /reset/i);
  assert.ok(r.text.includes('https://ascend.example/reset-password?token=tok_r'));
});

test('Resend path: POSTs to the API with auth + from/to/subject', async () => {
  process.env.RESEND_API_KEY = 'rk_test';
  process.env.EMAIL_FROM = 'AscendDV <noreply@ascend.example>';
  let seen = null;
  global.fetch = async (url, init) => {
    seen = { url, init, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ id: 'msg_123' }) };
  };
  const res = await email.sendEmail({ to: 'x@y.co', subject: 'Subject', html: '<p>hi</p>', text: 'hi' });
  assert.equal(res.ok, true);
  assert.equal(res.id, 'msg_123');
  assert.equal(seen.url, 'https://api.resend.com/emails');
  assert.equal(seen.init.headers.Authorization, 'Bearer rk_test');
  assert.equal(seen.body.from, 'AscendDV <noreply@ascend.example>');
  assert.deepEqual(seen.body.to, ['x@y.co']);
  assert.equal(seen.body.subject, 'Subject');
});

test('Resend path: a provider error is reported, not thrown', async () => {
  process.env.RESEND_API_KEY = 'rk_test';
  global.fetch = async () => ({ ok: false, status: 422, json: async () => ({ message: 'bad from' }) });
  const res = await email.sendEmail({ to: 'x@y.co', subject: 'S', text: 't' });
  assert.equal(res.ok, false);
  assert.match(res.error, /422/);
});

test('sendEmail rejects a call with no recipient', async () => {
  const res = await email.sendEmail({ subject: 'no to' });
  assert.equal(res.ok, false);
});

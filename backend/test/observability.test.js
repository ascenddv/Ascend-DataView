/**
 * services/observability.js — redaction + error capture.
 *
 * The invariant: a secret never survives into a log line or an error report,
 * `redact()` never throws, and the real per-request / per-error context keys
 * this app actually logs stay readable. The adversarial tables below are the
 * exact leak cases found in the Phase 29 audit — kept as tests so the class of
 * regression is caught automatically.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const { redact, redactString, captureError, captureMessage } = require('../services/observability');

/* ---------------- pass 1: key-name matching ---------------- */

const SECRET_KEYS = [
  // exact concept words
  'password', 'passwd', 'passphrase', 'pwd',
  'token', 'jwt', 'secret', 'credential', 'credentials',
  'cookie', 'authorization', 'auth', 'bearer', 'session',
  // audit "!!LEAK!!" list — near-misses that must now be caught
  'userPassword', 'client_secret', 'clientSecret', 'refresh_token', 'refreshToken',
  'access_token', 'accessToken', 'sessionToken', 'secretKey', 'privateKey', 'private_key',
  'api_key', 'apiKey', 'apikey', 'x-api-key', 'X-API-KEY', 'stripe_api_key',
  'GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'RESEND_API_KEY',
  'JWT_SECRET', 'CRON_SECRET', 'SENTRY_DSN', 'sentryDsn',
  'DATABASE_URL', 'databaseUrl', 'POSTGRES_URL', 'pg_url', 'connectionString', 'connection_string',
];

test('redact masks every secret-concept key name (audit leak list) at any depth', () => {
  for (const key of SECRET_KEYS) {
    assert.equal(redact({ [key]: 'SECRET' })[key], '[redacted]', `top-level key "${key}"`);
    assert.equal(redact({ a: { b: { [key]: 'SECRET' } } }).a.b[key], '[redacted]', `nested key "${key}"`);
    assert.equal(redact([{ [key]: 'SECRET' }])[0][key], '[redacted]', `key "${key}" in an array`);
  }
});

test('redact keeps the real log/error context keys this app uses', () => {
  const ctx = { orgId: 42, userId: 7, method: 'GET', path: '/api/x', status: 500, ms: 12,
    code: 'ROUTE_5XX', cause: 'ECONNREFUSED', reason: 'timeout', count: 3, enabled: true, detail: 'nothing secret here' };
  assert.deepEqual(redact(ctx), ctx);
});

/* ---------------- pass 2: value-shape matching ---------------- */

const realJwt = jwt.sign({ userId: 1, orgId: 2, tv: 0 }, 'x'.repeat(40), { expiresIn: '2d' });

// [label, string containing a secret, the substring that must NOT survive]
const SHAPE_LEAKS = [
  ['pg connection string', 'connect ECONNREFUSED postgres://admin:s3cr3tPW@db.x:5432/app', 's3cr3tPW'],
  ['pg conn, "/" in password', 'bad url postgresql://u:pa/ss@h:5432/db', 'pa/ss'],
  ['mongodb+srv conn string', 'mongodb+srv://user:MongoPass1@cluster0.x.net/db', 'MongoPass1'],
  ['real JWT, no Bearer prefix', `session was ${realJwt} — rejected`, realJwt],
  ['Authorization: Bearer <jwt>', `hdr Authorization: Bearer ${realJwt}`, realJwt.slice(0, 24)],
  ['Authorization: Basic <b64>', 'Authorization: Basic dXNlcjpzdXBlcnNlY3JldA==', 'dXNlcjpzdXBlcnNlY3JldA=='],
  ['Authorization: Token <t>', 'Authorization: Token abc123def456ghi789', 'abc123def456ghi789'],
  ['Google AIza… key', 'gemini key AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q rejected', 'AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q'],
  ['DeepSeek/OpenAI sk-… (hyphen)', 'deepseek auth sk-proj-1234567890abcdefghij failed', 'sk-proj-1234567890abcdefghij'],
  ['Stripe sk_live_… (infix)', 'stripe sk_live_51H8xYz2eZvKYlo2C0abcdefghij declined', 'sk_live_51H8xYz2eZvKYlo2C0abcdefghij'],
  ['Stripe sk_test_… (infix)', 'test key sk_test_51H8xYz2eZvKYlo2C0abcdefghij', 'sk_test_51H8xYz2eZvKYlo2C0abcdefghij'],
  ['Resend re_… key', 'resend rejected re_1234567890abcdef', 're_1234567890abcdef'],
  ['secret in a query string (?client_secret=)', 'GET /cb?code=x&client_secret=SUPERSECRETVALUE HTTP/1.1', 'SUPERSECRETVALUE'],
  ['gemini key in a URL (?key=)', 'fetch https://g.googleapis.com/v1/x?key=AIzaSyABCDEFghijkl failed', 'AIzaSyABCDEFghijkl'],
  ['access_token in a query string', '/oauth/cb?state=1&access_token=ya29.a0AfB_byXXXXXXXXXX', 'ya29.a0AfB_byXXXXXXXXXX'],
];

test('redact masks every secret VALUE SHAPE (audit leak list) under an innocent key', () => {
  for (const [label, str, needle] of SHAPE_LEAKS) {
    const out = redact({ detail: str }).detail;
    assert.ok(!out.includes(needle), `LEAK — ${label}\n  in:  ${str}\n  out: ${out}`);
    assert.ok(out.includes('[redacted]'), `${label}: expected a [redacted] marker, got: ${out}`);
  }
});

test('redact leaves benign strings and non-secret query params intact', () => {
  assert.equal(redactString('GET /api/metrics?view=People&page=2'), 'GET /api/metrics?view=People&page=2');
  assert.equal(redactString('connect timeout after 2500ms to api.pwnedpasswords.com'),
    'connect timeout after 2500ms to api.pwnedpasswords.com');
  assert.equal(redactString('period 2025-01-31 revenue 12400'), 'period 2025-01-31 revenue 12400');
});

/* ---------------- redact never throws / exotic inputs ---------------- */

test('redact never throws and contains hostile / exotic input', () => {
  const throwingGetter = {};
  Object.defineProperty(throwingGetter, 'boom', { enumerable: true, get() { throw new Error('nope'); } });
  assert.doesNotThrow(() => redact({ a: 1, bad: throwingGetter }));
  const r = redact({ a: 1, bad: throwingGetter });
  assert.equal(r.a, 1);
  assert.equal(r.bad, '[unredactable]');

  const proxy = new Proxy({}, { ownKeys() { throw new Error('hostile'); } });
  assert.equal(redact({ p: proxy }).p, '[unredactable]');

  assert.equal(redact({ b: Buffer.from('sk-secret-bytes') }).b, '[buffer]');
  assert.equal(redact({ u: new Uint8Array([1, 2, 3]) }).u, '[binary]');
  assert.equal(redact({ d: new Date(0) }).d, '1970-01-01T00:00:00.000Z');
  assert.equal(redact({ n: 10n }).n, '10');
  assert.equal(redact({ f: () => {} }).f, '[function]');

  // Map: key-name masking applies to string keys; Set: values are redacted
  assert.deepEqual(redact({ m: new Map([['password', 'x'], ['orgId', 7]]) }).m, { password: '[redacted]', orgId: 7 });
  assert.deepEqual(redact({ s: new Set(['postgres://u:p@h/db', 'plain']) }).s, ['postgres://[redacted]@h/db', 'plain']);

  const cyclic = { a: 1 };
  cyclic.self = cyclic;
  assert.equal(redact(cyclic).self, '[circular]');

  const e = redact(new Error('boom postgres://u:p@h/db'));
  assert.equal(e.name, 'Error');
  assert.ok(!e.message.includes(':p@'));
});

/* ---------------- captureError / captureMessage ---------------- */

function captureStderr(fn) {
  const original = process.stderr.write.bind(process.stderr);
  let out = '';
  process.stderr.write = (c) => { out += String(c); return true; };
  try { fn(); } finally { process.stderr.write = original; }
  return out;
}

test('captureError: structured line, redacted stack included, code + context preserved, no secret', () => {
  let thrown;
  try { throw new Error('DeepSeek HTTP 500 at postgres://u:s3cr3t@h:5432/db'); } catch (e) { thrown = e; }
  const out = captureStderr(() =>
    captureError(thrown, { code: 'DEEPSEEK_FAILURE', orgId: 7, connectionString: 'postgres://u:p@h:5432/db' }));
  const line = JSON.parse(out.trim());
  assert.equal(line.level, 'error');
  assert.equal(line.code, 'DEEPSEEK_FAILURE');
  assert.equal(line.orgId, 7);
  assert.equal(line.connectionString, '[redacted]');
  assert.equal(typeof line.stack, 'string');
  assert.ok(line.stack.includes('at '), 'the stack must be present for console-only debuggability');
  assert.ok(!out.includes('s3cr3t'), 'no secret from the message');
  assert.ok(!out.includes(':p@h:5432'), 'no secret from the context');
});

test('captureError / captureMessage never throw on hostile input', () => {
  const nasty = {};
  Object.defineProperty(nasty, 'g', { enumerable: true, get() { throw new Error('x'); } });
  const badErr = new Error('ok');
  Object.defineProperty(badErr, 'stack', { get() { throw new Error('z'); } });

  assert.doesNotThrow(() => captureStderr(() => captureError(new Error('y'), nasty)));
  assert.doesNotThrow(() => captureStderr(() => captureError(badErr, { code: 'X' })));
  assert.doesNotThrow(() => captureStderr(() => captureMessage('SIG', nasty)));

  // a hostile context is attached, not spread — no key injection, still valid JSON
  const out = captureStderr(() => captureMessage('SIG', nasty));
  const line = JSON.parse(out.trim());
  assert.equal(line.code, 'SIG');
  assert.equal(line.context, '[unredactable]');
});

test('captureMessage writes a signal line with the code and redacted context', () => {
  const out = captureStderr(() => captureMessage('DEEPSEEK_BALANCE_LOW', { orgId: 3, detail: 'Bearer sk-abc1234567890xyz' }));
  const line = JSON.parse(out.trim());
  assert.equal(line.kind, 'signal');
  assert.equal(line.code, 'DEEPSEEK_BALANCE_LOW');
  assert.equal(line.orgId, 3);
  assert.ok(!line.detail.includes('sk-abc1234567890xyz'));
});

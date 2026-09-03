/**
 * services/observability.js — the redaction pass and error capture. The
 * invariant that matters: a secret never survives into a log line or a report.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { redact, captureError, captureMessage } = require('../services/observability');

test('redact masks secret-named keys at any depth', () => {
  const out = redact({
    password: 'hunter2',
    authorization: 'Bearer abc',
    DATABASE_URL: 'postgres://u:p@h:5432/db',
    GEMINI_API_KEY: 'AIzaSecret',
    nested: { cookie: 'sid=xyz', token: 'jwt-here', keep: 'visible' },
    list: [{ jwt_secret: 's' }],
  });
  assert.equal(out.password, '[redacted]');
  assert.equal(out.authorization, '[redacted]');
  assert.equal(out.DATABASE_URL, '[redacted]');
  assert.equal(out.GEMINI_API_KEY, '[redacted]');
  assert.equal(out.nested.cookie, '[redacted]');
  assert.equal(out.nested.token, '[redacted]');
  assert.equal(out.nested.keep, 'visible');
  assert.equal(out.list[0].jwt_secret, '[redacted]');
});

test('redact masks secret-shaped values under innocent keys', () => {
  const out = redact({
    detail: 'connect failed for postgres://admin:s3cr3t@db.example:5432/app',
    header: 'tried Authorization: Bearer eyJhbGciOiJIUzI1.eyJzdWIiOiIx.abcdEFGH1234',
    note: 'key re_12345678901234567890 rejected',
  });
  assert.ok(!out.detail.includes('s3cr3t'), out.detail);
  assert.ok(out.detail.includes('[redacted]@db.example'));
  assert.ok(!out.header.includes('eyJhbGciOiJIUzI1'), out.header);
  assert.ok(!out.note.includes('re_12345678901234567890'), out.note);
});

test('redact tolerates cycles, Errors and primitives', () => {
  const cyclic = { a: 1 };
  cyclic.self = cyclic;
  const out = redact(cyclic);
  assert.equal(out.a, 1);
  assert.equal(out.self, '[circular]');

  const e = redact(new Error('boom postgres://u:p@h/db'));
  assert.equal(e.name, 'Error');
  assert.ok(!e.message.includes(':p@'));

  assert.equal(redact(42), 42);
  assert.equal(redact(null), null);
});

function captureStderr(fn) {
  const original = process.stderr.write.bind(process.stderr);
  const chunks = [];
  process.stderr.write = (c) => { chunks.push(String(c)); return true; };
  try { fn(); } finally { process.stderr.write = original; }
  return chunks.join('');
}

test('captureError writes a structured line with the code and no secret', () => {
  const out = captureStderr(() =>
    captureError(new Error('DeepSeek HTTP 500'), {
      code: 'DEEPSEEK_FAILURE',
      orgId: 7,
      connectionString: 'postgres://u:p@h:5432/db',
    })
  );
  const parsed = JSON.parse(out.trim().split('\n').pop());
  assert.equal(parsed.level, 'error');
  assert.equal(parsed.code, 'DEEPSEEK_FAILURE');
  assert.equal(parsed.orgId, 7);
  assert.equal(parsed.connectionString, '[redacted]');
  assert.ok(!out.includes(':p@h:5432'));
});

test('captureMessage writes a signal line with the code', () => {
  const out = captureStderr(() => captureMessage('DEEPSEEK_BALANCE_LOW', { orgId: 3 }));
  const parsed = JSON.parse(out.trim());
  assert.equal(parsed.kind, 'signal');
  assert.equal(parsed.code, 'DEEPSEEK_BALANCE_LOW');
  assert.equal(parsed.orgId, 3);
});

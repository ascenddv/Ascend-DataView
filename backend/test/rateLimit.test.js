/**
 * middleware/rateLimit.js (Phase 23) — the expensive-endpoint limiters, with
 * PgRateStore swapped for an in-memory counter so no live Postgres is needed.
 * Verifies each limiter's threshold and response shape, that the key is
 * per-org+user (one org hitting its ceiling doesn't limit another), and that
 * the chat burst limiter degrades to a friendly 200 rather than a 429.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const {
  INSIGHT_RATE_LIMIT,
  PDF_RATE_LIMIT,
  UPLOAD_RATE_LIMIT,
  ASCENDAI_CHAT_BURST_LIMIT,
  EXPORT_RATE_LIMIT,
} = require('../config/thresholds');

/* --- swap PgRateStore for a Map-backed fixed-window counter -------------- */
const storeId = require.resolve('../services/pgRateStore');
const counts = new Map();
require.cache[storeId] = {
  id: storeId, filename: storeId, loaded: true, children: [], paths: [],
  exports: {
    PgRateStore: class {
      constructor({ prefix = 'rl:' } = {}) { this.prefix = prefix; this.localKeys = false; }
      init() {}
      async increment(key) {
        const k = this.prefix + key;
        const n = (counts.get(k) || 0) + 1;
        counts.set(k, n);
        return { totalHits: n, resetTime: new Date(Date.now() + 60_000) };
      }
      async decrement() {}
      async resetKey() {}
      async resetAll() {}
    },
  },
};

const { insightLimiter, chatBurstLimiter, pdfLimiter, uploadLimiter, exportLimiter } = require('../middleware/rateLimit');

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.auth = { orgId: Number(req.headers['x-org']) || 1, userId: Number(req.headers['x-user']) || 1 };
  next();
});
app.get('/api/insight', insightLimiter, (_req, res) => res.json({ ok: true, status: 'served' }));
app.get('/api/report.pdf', pdfLimiter, (_req, res) => res.json({ ok: true, status: 'served' }));
app.post('/api/upload', uploadLimiter, (_req, res) => res.json({ ok: true, status: 'served' }));
app.post('/api/ascendai/chat', chatBurstLimiter, (_req, res) => res.json({ ok: true, status: 'served' }));
app.get('/api/account/export', exportLimiter, (_req, res) => res.json({ ok: true, status: 'served' }));

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());
test.beforeEach(() => counts.clear());

const hit = (path, { method = 'GET', org = 1 } = {}) =>
  fetch(base + path, { method, headers: { 'x-org': String(org) } });

test(`GET /api/insight: ${INSIGHT_RATE_LIMIT} pass, then a hard 429`, async () => {
  for (let i = 0; i < INSIGHT_RATE_LIMIT; i += 1) {
    assert.equal((await hit('/api/insight')).status, 200, `request ${i + 1} should pass`);
  }
  const over = await hit('/api/insight');
  assert.equal(over.status, 429);
  const body = await over.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /too many/i);
});

test('GET /api/report.pdf and POST /api/upload each enforce their own ceiling', async () => {
  for (let i = 0; i < PDF_RATE_LIMIT; i += 1) assert.equal((await hit('/api/report.pdf')).status, 200);
  assert.equal((await hit('/api/report.pdf')).status, 429);

  for (let i = 0; i < UPLOAD_RATE_LIMIT; i += 1) {
    assert.equal((await hit('/api/upload', { method: 'POST' })).status, 200);
  }
  assert.equal((await hit('/api/upload', { method: 'POST' })).status, 429);
});

test('GET /api/account/export enforces its own hard 429 ceiling', async () => {
  for (let i = 0; i < EXPORT_RATE_LIMIT; i += 1) assert.equal((await hit('/api/account/export')).status, 200);
  const over = await hit('/api/account/export');
  assert.equal(over.status, 429);
  assert.match((await over.json()).error, /too many data exports/i);
});

test('the limit is keyed per org — a second org is unaffected', async () => {
  for (let i = 0; i < INSIGHT_RATE_LIMIT + 1; i += 1) await hit('/api/insight', { org: 1 });
  assert.equal((await hit('/api/insight', { org: 1 })).status, 429);
  assert.equal((await hit('/api/insight', { org: 2 })).status, 200);
});

test(`POST /api/ascendai/chat: burst ${ASCENDAI_CHAT_BURST_LIMIT} then a friendly 200, not a 429`, async () => {
  for (let i = 0; i < ASCENDAI_CHAT_BURST_LIMIT; i += 1) {
    assert.equal((await hit('/api/ascendai/chat', { method: 'POST' })).status, 200);
  }
  const over = await hit('/api/ascendai/chat', { method: 'POST' });
  assert.equal(over.status, 200);
  const body = await over.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, 'rate_limited');
  assert.match(body.reason, /burst limit/i);
  assert.doesNotMatch(body.reason, /daily/i);
});

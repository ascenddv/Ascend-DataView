/**
 * GET /api/insight (Phase 28 audit) — route-level coverage with ../db,
 * ../services/generateInsight and ../services/observability stubbed.
 *
 * Locks in: the endpoint is behind requireVerified (an LLM-spend endpoint, like
 * /api/upload and /api/ascendai/chat), the guard runs before insightLimiter so
 * an unverified caller consumes no rate-limit budget, and the global
 * INSIGHT_ENABLED kill-switch still short-circuits for a verified caller.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const dbId = require.resolve('../db');
const genId = require.resolve('../services/generateInsight');
const obsId = require.resolve('../services/observability');

const calls = { generateInsight: 0, rateStoreIncrement: 0 };

require.cache[dbId] = {
  id: dbId, filename: dbId, loaded: true, children: [], paths: [],
  exports: {
    async getStandardizedData() { return []; },
    getDb: () => ({
      query: async () => {
        calls.rateStoreIncrement += 1;
        return { rows: [{ hits: 1, expires_at: new Date(Date.now() + 60000) }] };
      },
    }),
  },
};
require.cache[genId] = {
  id: genId, filename: genId, loaded: true, children: [], paths: [],
  exports: {
    async generateInsight() {
      calls.generateInsight += 1;
      return { status: 'ok', why: 'because', recommendation: 'do the thing', model: 'stub', generatedAt: 'now' };
    },
    sanitizeForPrompt: (x) => x,
  },
};
require.cache[obsId] = {
  id: obsId, filename: obsId, loaded: true, children: [], paths: [],
  exports: { captureError: () => {}, captureMessage: () => {}, redact: (x) => x, requestLog: () => {} },
};

// buildMetrics is pure and cheap — let the real one run on the empty dataset.
const insightRouter = require('../routes/insight');

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.auth = {
    orgId: 7,
    userId: 3,
    email: 't@t',
    role: 'owner',
    emailVerified: req.headers['x-unverified'] ? false : true,
  };
  next();
});
app.use('/api', insightRouter);
app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ ok: false, error: err.message }));

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const get = (headers = {}) => fetch(`${base}/api/insight`, { headers });

test('an unverified user is 403 { needsVerification: true } and never reaches the limiter or the provider', async () => {
  calls.generateInsight = 0;
  calls.rateStoreIncrement = 0;
  const r = await get({ 'x-unverified': '1' });
  assert.equal(r.status, 403);
  const j = await r.json();
  assert.equal(j.needsVerification, true);
  assert.equal(calls.generateInsight, 0, 'no provider call for an unverified user');
  assert.equal(calls.rateStoreIncrement, 0, 'requireVerified runs before insightLimiter — no rate-limit budget spent');
});

test('a verified user passes the guard and gets the narrative', async () => {
  calls.generateInsight = 0;
  const r = await get();
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.status, 'ok');
  assert.equal(calls.generateInsight, 1);
});

test('a verified user with INSIGHT_ENABLED=off gets the clean unavailable shape, no provider call', async () => {
  const saved = process.env.INSIGHT_ENABLED;
  process.env.INSIGHT_ENABLED = 'off';
  calls.generateInsight = 0;
  try {
    const r = await get();
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.status, 'unavailable');
    assert.match(j.reason, /turned off for this deployment/i);
    assert.equal(calls.generateInsight, 0);
  } finally {
    if (saved === undefined) delete process.env.INSIGHT_ENABLED;
    else process.env.INSIGHT_ENABLED = saved;
  }
});

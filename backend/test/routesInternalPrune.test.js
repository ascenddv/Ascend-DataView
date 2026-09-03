/**
 * POST/GET /api/internal/prune (Phase 31) — cron-secret auth, DB stubbed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const dbId = require.resolve('../db');
let pruneCalls = 0;
require.cache[dbId] = {
  id: dbId, filename: dbId, loaded: true, children: [], paths: [],
  exports: {
    pruneOldRows: async () => {
      pruneCalls += 1;
      return { chatMessages: 1, ascendaiUsage: 2, pendingUploads: 0, rateLimits: 5, emailVerifications: 0, passwordResets: 0, invitations: 3 };
    },
  },
};

const internalRouter = require('../routes/internal');

const app = express();
app.use('/api', internalRouter);
app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ ok: false, error: err.message }));
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const savedSecret = process.env.CRON_SECRET;
test.afterEach(() => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedSecret;
  pruneCalls = 0;
});

const hit = (method, headers = {}) => fetch(`${base}/api/internal/prune`, { method, headers });

test('with CRON_SECRET set: bearer or x-cron-secret -> 200 with the prune counts', async () => {
  process.env.CRON_SECRET = 's3cr3t';

  const bearer = await hit('POST', { authorization: 'Bearer s3cr3t' });
  assert.equal(bearer.status, 200);
  const body = await bearer.json();
  assert.equal(body.ok, true);
  assert.equal(body.pruned.ascendaiUsage, 2);
  assert.equal(body.pruned.rateLimits, 5, 'rate_limits is one of the pruned tables');

  const header = await hit('POST', { 'x-cron-secret': 's3cr3t' });
  assert.equal(header.status, 200);

  const asGet = await hit('GET', { authorization: 'Bearer s3cr3t' });
  assert.equal(asGet.status, 200);

  assert.equal(pruneCalls, 3);
});

test('missing or wrong secret -> 401, prune not run', async () => {
  process.env.CRON_SECRET = 's3cr3t';
  assert.equal((await hit('POST')).status, 401);
  assert.equal((await hit('POST', { authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await hit('GET', { 'x-cron-secret': 'nope' })).status, 401);
  assert.equal(pruneCalls, 0);
});

test('no CRON_SECRET on the server -> always 401', async () => {
  delete process.env.CRON_SECRET;
  assert.equal((await hit('POST', { authorization: 'Bearer anything' })).status, 401);
  assert.equal(pruneCalls, 0);
});

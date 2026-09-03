/**
 * GET /api/health (Phase 29 audit follow-up) — always 200 with { status, db },
 * and a state CHANGE emits a captureMessage signal (once, not per poll) so a
 * DB outage isn't fully silent.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const dbId = require.resolve('../db');
const obsId = require.resolve('../services/observability');

let dbOk = true;
const signals = [];

require.cache[dbId] = {
  id: dbId, filename: dbId, loaded: true, children: [], paths: [],
  exports: {
    getDb: () => ({
      query: async () => {
        if (!dbOk) throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
        return { rows: [{ '?column?': 1 }] };
      },
    }),
  },
};
require.cache[obsId] = {
  id: obsId, filename: obsId, loaded: true, children: [], paths: [],
  exports: { captureMessage: (code, ctx) => signals.push({ code, ctx }) },
};

const healthRouter = require('../routes/health');
const app = express();
app.use('/api', healthRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const hit = async () => {
  const r = await fetch(`${base}/api/health`);
  return { status: r.status, body: await r.json() };
};

test('healthy: 200 { status: "ok", db: "ok" }, no signal', async () => {
  dbOk = true;
  signals.length = 0;
  const r = await hit();
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { status: 'ok', db: 'ok' });
  assert.equal(signals.length, 0);
});

test('DB goes down: still 200 { db: "down" }, and exactly ONE HEALTH_DB_DOWN signal for a sustained outage', async () => {
  dbOk = false;
  signals.length = 0;

  const r1 = await hit();
  assert.equal(r1.status, 200, 'health stays reachable during a DB outage');
  assert.deepEqual(r1.body, { status: 'degraded', db: 'down' });

  await hit();
  await hit();

  assert.equal(signals.length, 1, 'the signal fires on the transition, not once per poll');
  assert.equal(signals[0].code, 'HEALTH_DB_DOWN');
  assert.match(signals[0].ctx.reason, /ECONNREFUSED/);
});

test('DB recovers: one HEALTH_DB_RECOVERED signal', async () => {
  dbOk = true;
  signals.length = 0;
  const r = await hit();
  assert.deepEqual(r.body, { status: 'ok', db: 'ok' });
  assert.equal(signals.length, 1);
  assert.equal(signals[0].code, 'HEALTH_DB_RECOVERED');
});

test('the response body exposes ONLY status + db — nothing else', async () => {
  dbOk = true;
  const { body } = await hit();
  assert.deepEqual(Object.keys(body).sort(), ['db', 'status']);
});

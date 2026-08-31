/**
 * POST /api/organizations/:id/onboarding-complete (Phase 17) — route-level
 * coverage with the DB layer stubbed (no live Postgres). Verifies the
 * :id === session org_id guard, the idempotent success path, and that a
 * rejected request never reaches the DB.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// Stub ../db in the module cache BEFORE the route requires it.
const dbId = require.resolve('../db');
const calls = { setOnboardingCompleted: [] };
require.cache[dbId] = {
  id: dbId,
  filename: dbId,
  loaded: true,
  children: [],
  paths: [],
  exports: {
    getOrganizationById: async (id) => ({ id, name: `Org ${id}` }),
    deleteStandardizedData: async () => 0,
    setOnboardingCompleted: async (orgId, value) => {
      calls.setOnboardingCompleted.push([orgId, value]);
      return value === true;
    },
  },
};

const organizationsRouter = require('../routes/organizations');

const ORG = 42;
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.auth = { orgId: ORG, userId: 1, email: 't@t.co' };
  next();
});
app.use('/api', organizationsRouter);
app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ ok: false, error: err.message }));

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const post = (path) => fetch(base + path, { method: 'POST' });

test('the acting org completing its own onboarding -> 200 and the flag is set', async () => {
  calls.setOnboardingCompleted.length = 0;
  const r = await post(`/api/organizations/${ORG}/onboarding-complete`);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(j, { ok: true, onboardingCompleted: true });
  assert.deepEqual(calls.setOnboardingCompleted.at(-1), [ORG, true]);
});

test('a different org id -> 403 and setOnboardingCompleted is never called', async () => {
  calls.setOnboardingCompleted.length = 0;
  const r = await post(`/api/organizations/${ORG + 1}/onboarding-complete`);
  assert.equal(r.status, 403);
  assert.equal(calls.setOnboardingCompleted.length, 0);
});

test('a non-numeric org id -> 403', async () => {
  calls.setOnboardingCompleted.length = 0;
  const r = await post('/api/organizations/not-a-number/onboarding-complete');
  assert.equal(r.status, 403);
  assert.equal(calls.setOnboardingCompleted.length, 0);
});

test('calling it again is idempotent -> still 200 { onboardingCompleted: true }', async () => {
  await post(`/api/organizations/${ORG}/onboarding-complete`);
  const r = await post(`/api/organizations/${ORG}/onboarding-complete`);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.onboardingCompleted, true);
});

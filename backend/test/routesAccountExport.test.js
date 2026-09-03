/**
 * GET /api/account/export (Phase 27) — owner + verified only; returns the
 * acting org's data as a JSON attachment with no password hashes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const dbId = require.resolve('../db');
const seen = { exportCalls: [] };

require.cache[dbId] = {
  id: dbId, filename: dbId, loaded: true, children: [], paths: [],
  exports: {
    exportOrganizationData: async (orgId) => {
      seen.exportCalls.push(orgId);
      return {
        exportedAt: '2026-09-02T00:00:00Z',
        organization: { id: orgId, name: `Org ${orgId}` },
        members: [{ id: 1, email: 'owner@org.co', role: 'owner', created_at: 'x' }],
        standardizedData: [{ period_date: '2025-01-31', revenue: 100 }],
        chatMessages: [],
        ascendaiUsage: [],
        invitations: [],
      };
    },
  },
};

const accountRouter = require('../routes/account');

const app = express();
app.use((req, _res, next) => {
  req.auth = {
    orgId: 55,
    userId: 1,
    role: req.headers['x-role'] || 'owner',
    emailVerified: !req.headers['x-unverified'],
  };
  next();
});
app.use('/api', accountRouter);
app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ ok: false, error: err.message }));

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

test('owner + verified -> 200 JSON attachment scoped to the session org', async () => {
  seen.exportCalls.length = 0;
  const r = await fetch(`${base}/api/account/export`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /application\/json/);
  assert.match(r.headers.get('content-disposition') || '', /attachment; filename="ascenddv-export-org55-\d{4}-\d{2}-\d{2}\.json"/);
  const body = await r.json();
  assert.equal(body.organization.id, 55);
  assert.equal(body.members[0].email, 'owner@org.co');
  assert.ok(!JSON.stringify(body).includes('password_hash'));
  assert.deepEqual(seen.exportCalls, [55]);
});

test('a member -> 403', async () => {
  const r = await fetch(`${base}/api/account/export`, { headers: { 'x-role': 'member' } });
  assert.equal(r.status, 403);
});

test('an unverified owner -> 403 needsVerification', async () => {
  const r = await fetch(`${base}/api/account/export`, { headers: { 'x-unverified': '1' } });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).needsVerification, true);
});

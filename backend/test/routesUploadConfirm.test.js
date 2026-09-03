/**
 * POST /api/upload/confirm (Phase 14b) — route-level coverage with the DB layer
 * stubbed (no live Postgres); the real ingestion pipeline and the real
 * pendingUploads store are exercised. Verifies that a corrected mapping is what
 * actually gets stored, that a confirmed guess is recorded for the confidence
 * engine, and that the pending upload is single-use and org-scoped.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const crypto = require('node:crypto');

const dbId = require.resolve('../db');
const merged = [];
// In-memory stand-ins for the pending_uploads table helpers, with the same
// single-use / org-scoped semantics the real SQL enforces.
const pendingRows = new Map();
require.cache[dbId] = {
  id: dbId,
  filename: dbId,
  loaded: true,
  children: [],
  paths: [],
  exports: {
    mergeStandardizedData: async (orgId, rows) => {
      merged.push({ orgId, rows });
      return { periodsAdded: rows.length, periodsUpdated: 0 };
    },
    upsertStandardizedRow: async () => ({ inserted: true }),
    getStandardizedData: async () => [],
    putPendingUpload: async (orgId, payload) => {
      const id = crypto.randomUUID();
      pendingRows.set(id, { orgId, payload });
      return id;
    },
    takePendingUpload: async (id, orgId) => {
      const row = pendingRows.get(id);
      if (!row || row.orgId !== orgId) return null;
      pendingRows.delete(id); // single-use
      return row.payload;
    },
    // Only the upload rate limiter's PgRateStore reads this; a constant low
    // count keeps the limiter a no-op so these tests stay about route logic.
    getDb: () => ({
      query: async () => ({ rows: [{ hits: 1, expires_at: new Date(Date.now() + 60000) }] }),
    }),
  },
};

const pendingUploads = require('../services/pendingUploads');
const uploadRouter = require('../routes/upload');

const ORG = 5;
const OTHER = 6;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.auth = { orgId: Number(req.query.as) || ORG, userId: 1, email: 't@t' };
  next();
});
app.use('/api', uploadRouter);
app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ ok: false, error: err.message }));

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const parsed = {
  headers: ['Month', 'Rev', 'Spend', 'Cash', 'Helpers'],
  rows: [
    { Month: '2025-01-31', Rev: '100', Spend: '90', Cash: '500', Helpers: '12' },
    { Month: '2025-02-28', Rev: '110', Spend: '92', Cash: '520', Helpers: '15' },
  ],
  parseErrors: [],
};
const guessMapping = {
  Month: { field: 'period_date', confidence: 0.9, source: 'llm' },
  Rev: { field: 'revenue', confidence: 0.55, source: 'llm' },
  Spend: { field: 'expenses', confidence: 0.6, source: 'llm' },
  Cash: { field: 'cash_balance', confidence: 0.92, source: 'llm' },
  Helpers: { field: 'donors_total', confidence: 0.5, source: 'llm' },
};

const seedPending = (orgId = ORG) =>
  pendingUploads.put({ orgId, parsed, mapping: guessMapping, filename: 'f.csv', source: 'csv_upload' });
// seedPending() returns a Promise<id>; tests await it.

const post = (path, body) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

test('confirm stores with the CORRECTED mapping, not the original guess', async () => {
  merged.length = 0;
  const id = await seedPending();
  const r = await post('/api/upload/confirm', {
    pendingId: id,
    corrections: { Rev: 'revenue', Spend: 'expenses', Helpers: 'volunteers_active' },
  });
  const j = await r.json();

  assert.equal(r.status, 200);
  assert.equal(j.ok, true);
  assert.equal(j.confirmedMappingApplied, true);
  assert.equal(j.periodsAdded, 2);
  assert.deepEqual(j.fieldsNeedingConfirmation, []);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].orgId, ORG);
  const row = merged[0].rows[0];
  // "Helpers" was re-pointed donors_total -> volunteers_active
  assert.equal(row.volunteers_active, 12);
  assert.equal(row.donors_total, null);
  assert.equal(row.revenue, 100);
  // the two kept-guess confirmations are recorded for the confidence tier
  assert.deepEqual(row.source_meta.mapping_confirmed, { revenue: true, expenses: true });
});

test('an unknown pendingId -> 404 and nothing is stored', async () => {
  merged.length = 0;
  const r = await post('/api/upload/confirm', { pendingId: 'does-not-exist', corrections: {} });
  assert.equal(r.status, 404);
  assert.equal(merged.length, 0);
});

test('another org cannot complete this org\'s pending upload -> 404, entry still owned', async () => {
  merged.length = 0;
  const id = await seedPending(ORG);
  const r = await post(`/api/upload/confirm?as=${OTHER}`, {
    pendingId: id,
    corrections: { Rev: 'revenue' },
  });
  assert.equal(r.status, 404);
  assert.equal(merged.length, 0);
  // the real owner can still take it — the failed cross-org attempt didn't consume it
  assert.ok(await pendingUploads.take(id, ORG));
});

test('a pending upload is single-use', async () => {
  merged.length = 0;
  const id = await seedPending();
  const first = await post('/api/upload/confirm', { pendingId: id, corrections: { Rev: 'revenue', Spend: 'expenses' } });
  assert.equal(first.status, 200);
  const second = await post('/api/upload/confirm', { pendingId: id, corrections: {} });
  assert.equal(second.status, 404);
  assert.equal(merged.length, 1);
});

/**
 * GET /api/report.pdf (Phase 16) — route-level coverage with the DB layer and
 * the AI insight stubbed (no live Postgres, no LLM call). Verifies it returns a
 * real PDF attachment, is scoped strictly by req.auth.orgId (the DB is queried
 * with exactly that id and nothing else), and an org with no rows still gets a
 * valid "no data" snapshot.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const dbId = require.resolve('../db');
const insightId = require.resolve('../services/generateInsight');

const rowsFor = {};
const seen = { getStandardizedData: [] };

require.cache[dbId] = {
  id: dbId,
  filename: dbId,
  loaded: true,
  children: [],
  paths: [],
  exports: {
    getStandardizedData: async (orgId) => {
      seen.getStandardizedData.push(orgId);
      return rowsFor[orgId] || [];
    },
    getOrganizationById: async (orgId) => ({ id: orgId, name: `Org ${orgId}` }),
  },
};
require.cache[insightId] = {
  id: insightId,
  filename: insightId,
  loaded: true,
  children: [],
  paths: [],
  exports: {
    generateInsight: async () => ({ status: 'unavailable', why: null, recommendation: null }),
  },
};

const pdfRouter = require('../routes/pdf');

const RICH = 7;
const EMPTY = 8;

function buildRows() {
  const rows = [];
  for (let i = 0; i < 6; i += 1) {
    const m = String(i + 1).padStart(2, '0');
    rows.push({
      period_date: `2025-${m}-28`,
      revenue: 10000 + i * 800,
      expenses: 9000 + i * 300,
      cash_balance: 40000 + i * 1500,
      revenue_donations: 6000 + i * 400,
      revenue_grants: 3000 + i * 300,
      revenue_events: 800 + i * 60,
      revenue_other: 200 + i * 40,
      donors_total: 100 + i * 5,
      source_meta: { source: 'csv_upload', mapping_confidence: {}, mapping_confirmed: {} },
    });
  }
  return rows;
}
rowsFor[RICH] = buildRows();

const app = express();
app.use((req, _res, next) => {
  req.auth = { orgId: Number(req.query.as) || RICH, userId: 1, email: 't@t.co' };
  next();
});
app.use('/api', pdfRouter);
app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ ok: false, error: err.message }));

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const pdfText = (ab) =>
  (Buffer.from(ab).toString('latin1').match(/<([0-9A-Fa-f]+)>/g) || [])
    .map((h) => Buffer.from(h.slice(1, -1), 'hex').toString('latin1'))
    .join('');

test('returns a PDF attachment for the session org', async () => {
  const r = await fetch(`${base}/api/report.pdf`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /application\/pdf/);
  assert.match(
    r.headers.get('content-disposition') || '',
    /attachment; filename="ascenddv-overview-\d{4}-\d{2}-\d{2}\.pdf"/
  );
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.toString('latin1').slice(0, 5), '%PDF-');
  const t = pdfText(buf);
  assert.match(t, /POINT-IN-TIME SNAPSHOT/);
  assert.match(t, /Org 7/);
  assert.match(t, /Financial health/);
});

test('scoped strictly by req.auth.orgId — the DB is queried with exactly that id', async () => {
  seen.getStandardizedData.length = 0;
  await fetch(`${base}/api/report.pdf`);
  assert.deepEqual(seen.getStandardizedData, [RICH]);
});

test('an org with no rows still gets a valid "no data" snapshot', async () => {
  const r = await fetch(`${base}/api/report.pdf?as=${EMPTY}`);
  assert.equal(r.status, 200);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.toString('latin1').slice(0, 5), '%PDF-');
  const t = pdfText(buf);
  assert.match(t, /No data yet/);
  assert.match(t, /Org 8/);
  assert.doesNotMatch(t, /Org 7/);
});

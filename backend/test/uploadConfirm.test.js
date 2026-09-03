/**
 * Phase 14b — column-mapping confirmation (mapper-injection path).
 *   - ingestParsed accepts an already-resolved mapping and skips the mapper
 *   - `confirmedFields` is recorded in each row's source_meta
 *   - a corrected mapping changes which field the cell is stored under
 *
 * pendingUploads is now DB-backed (pending_uploads table); its single-use /
 * TTL / org-scope semantics are covered by test/routesUploadConfirm.test.js
 * (mocked) and scripts/serverless-durability-gate.mjs (live, cross-instance).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { ingestParsed } = require('../services/ingest');

const PARSED = {
  headers: ['Month', 'Rev ($)', 'Total Expenses', 'Cash on Hand', 'Supporters'],
  rows: [
    { 'Month': '2025-01-31', 'Rev ($)': '100', 'Total Expenses': '90', 'Cash on Hand': '500', 'Supporters': '12' },
    { 'Month': '2025-02-28', 'Rev ($)': '110', 'Total Expenses': '92', 'Cash on Hand': '520', 'Supporters': '15' },
  ],
  parseErrors: [],
};

const GUESS_MAPPING = {
  'Month': { field: 'period_date', confidence: 0.9, source: 'llm' },
  'Rev ($)': { field: 'revenue', confidence: 0.55, source: 'llm' },
  'Total Expenses': { field: 'expenses', confidence: 0.6, source: 'llm' },
  'Cash on Hand': { field: 'cash_balance', confidence: 0.92, source: 'llm' },
  'Supporters': { field: 'donors_total', confidence: 0.5, source: 'llm' },
};

test('an injected mapping is used verbatim — no mapper call', async () => {
  const { rows } = await ingestParsed(PARSED, {
    orgId: 1,
    filename: 'f.csv',
    source: 'csv_upload',
    mapping: GUESS_MAPPING,
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].revenue, 100);
  assert.equal(rows[0].donors_total, 12);
});

test('confirmedFields land in source_meta.mapping_confirmed', async () => {
  const { rows } = await ingestParsed(PARSED, {
    orgId: 1,
    filename: 'f.csv',
    source: 'csv_upload',
    mapping: GUESS_MAPPING,
    confirmedFields: ['revenue', 'expenses'],
  });
  assert.deepEqual(rows[0].source_meta.mapping_confirmed, { revenue: true, expenses: true });
  assert.equal(rows[0].source_meta.mapping_confidence.revenue, 0.55);
});

test('correcting a mapping stores the cell under the corrected field, not the guess', async () => {
  // user re-points "Supporters" from donors_total to volunteers_active
  const corrected = {
    ...GUESS_MAPPING,
    'Supporters': { field: 'volunteers_active', confidence: 1, source: 'user_corrected' },
  };
  const { rows } = await ingestParsed(PARSED, {
    orgId: 1,
    filename: 'f.csv',
    source: 'csv_upload',
    mapping: corrected,
  });
  assert.equal(rows[0].volunteers_active, 12);
  assert.equal(rows[0].donors_total, null);
});

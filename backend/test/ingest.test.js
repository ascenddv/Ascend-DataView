/**
 * One ingestion pipeline for CSV, Excel and manual entry.
 *   - revenue subcategory reconciliation (runs only with all 4 fields)
 *   - parseXlsx yields the same shape as parseCsv
 *   - ingestXlsx and ingestCsv produce identical rows for equivalent input
 *   - ingestManualEntry runs values through the same normalizers as a CSV cell
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');

const {
  subcategorySumWarning,
  parseCsv,
  parseXlsx,
  ingestCsv,
  ingestXlsx,
  ingestManualEntry,
} = require('../services/ingest');
const { FIELD_NAMES } = require('../config/schema');

/* --- stub column mapper: canonical headers, no DB / LLM ------------------- */
const identityMapColumns = async (headers) => {
  const mapping = {};
  for (const h of headers) {
    mapping[h] = FIELD_NAMES.includes(h)
      ? { field: h, confidence: 1, source: 'exact' }
      : { field: null, confidence: 0, source: 'none' };
  }
  return {
    mapping,
    fieldsNeedingConfirmation: [],
    unmappedHeaders: Object.keys(mapping).filter((h) => !mapping[h].field),
    fromCache: false,
    llmUsed: false,
    llmError: null,
  };
};

/* ---------------------------- subcategory check -------------------------- */

test('no warning: only one subcategory field present (partial breakdown)', () => {
  assert.equal(
    subcategorySumWarning({ period_date: '2025-01-31', revenue: 12400, revenue_other: 350 }),
    null
  );
});

test('warning: all four subcategory fields present and do not sum to revenue', () => {
  const row = {
    period_date: '2025-01-31',
    revenue: 15200,
    revenue_donations: 7400,
    revenue_grants: 5000,
    revenue_events: 2100,
    revenue_other: 100,
  };
  assert.match(subcategorySumWarning(row), /sum to 14600 but revenue is 15200/);
});

/* ------------------------------ parseXlsx ------------------------------- */

function makeXlsxBuffer(headers, dataRows) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]); // all string cells
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

test('parseXlsx returns the same {headers, rows} shape as parseCsv', () => {
  const headers = ['period_date', 'revenue', 'expenses', 'cash_balance', 'revenue_other'];
  const data = [
    ['2025-01-31', '15200', '14800', '73900', '700'],
    ['2025-02-28', '$16,850', '15900', '77100', ''], // a cell containing a comma
  ];
  // CSV must quote a comma-bearing field; xlsx keeps it whole natively.
  const csvText = [
    headers.join(','),
    ...data.map((r) => r.map((c) => (c.includes(',') ? `"${c}"` : c)).join(',')),
  ].join('\n');

  const fromCsv = parseCsv(csvText);
  const fromXlsx = parseXlsx(makeXlsxBuffer(headers, data));

  assert.deepEqual(fromXlsx.headers, fromCsv.headers);
  assert.deepEqual(fromXlsx.rows, fromCsv.rows);
});

/* -------------------- ingestXlsx === ingestCsv (rows) ------------------- */

test('ingestXlsx and ingestCsv produce identical stored rows for the same data', async () => {
  const headers = ['period_date', 'revenue', 'expenses', 'cash_balance', 'donors_total'];
  const rows = [
    ['2025-01-31', '15200', '14800', '73900', '142'],
    ['2025-02-28', '16850', '15900', '77100', '151'],
    ['2025-03-31', '18400', '17600', '79700', '158'],
  ];
  const csvText = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

  const viaCsv = await ingestCsv(csvText, { orgId: 1, mapColumns: identityMapColumns });
  const viaXlsx = await ingestXlsx(makeXlsxBuffer(headers, rows), {
    orgId: 1,
    mapColumns: identityMapColumns,
  });

  const strip = (r) => {
    const { source_meta, ...fields } = r;
    return fields;
  };
  assert.deepEqual(viaXlsx.rows.map(strip), viaCsv.rows.map(strip));
  assert.equal(viaXlsx.report.rowsStored, viaCsv.report.rowsStored);
  assert.equal(viaXlsx.rows[0].source_meta.source, 'xlsx_upload');
  assert.equal(viaCsv.rows[0].source_meta.source, 'csv_upload');
});

/* --------------------------- ingestManualEntry ------------------------- */

test('ingestManualEntry: values flow through the same normalizers as a CSV cell', () => {
  const { row, warnings } = ingestManualEntry({
    period_date: '01/31/2026',
    revenue: '$40,000',
    expenses: '(800)',
    cash_balance: '120000',
    donors_total: '',
    volunteers_active: 'N/A',
  });
  assert.equal(row.period_date, '2026-01-31'); // US date folded to ISO
  assert.equal(row.revenue, 40000); // $ and comma stripped
  assert.equal(row.expenses, -800); // parenthesised negative
  assert.equal(row.cash_balance, 120000);
  assert.equal(row.donors_total, null); // blank stays null, not 0
  assert.equal(row.volunteers_active, null); // N/A stays null
  assert.equal(row.source_meta.source, 'manual_entry');
  assert.deepEqual(warnings, []);
});

test('ingestManualEntry: rejects a missing required field with a 422', () => {
  try {
    ingestManualEntry({ period_date: '2026-01-31', revenue: '100', expenses: '90' });
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.statusCode, 422);
    assert.match(err.message, /missing required field\(s\): cash_balance/);
  }
});

test('ingestManualEntry: unparseable required field is a 422, not a silent null', () => {
  try {
    ingestManualEntry({ period_date: '2026-01-31', revenue: 'lots', expenses: '90', cash_balance: '100' });
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.statusCode, 422);
    assert.match(err.message, /unparseable revenue="lots"/);
  }
});

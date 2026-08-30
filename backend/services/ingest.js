/**
 * Ingestion orchestrator.
 *
 * There is ONE pipeline. CSV, Excel and manual single-period entry all converge
 * on `ingestParsed` / `normalizeRow` — the parser is the only part that differs:
 *
 *   ingestCsv(text)     -> parseCsv    -> ingestParsed
 *   ingestXlsx(buffer)  -> parseXlsx   -> ingestParsed   (rows in the SAME
 *                                                          {header: cell} shape)
 *   ingestManualEntry(values)          -> normalizeRow    (canonical-keyed row,
 *                                                          no column mapping)
 *
 * No I/O and no DB writes here — the route layer persists the result.
 *
 * Guarantees (unchanged from Stage 1):
 *   - A bad row is skipped with a reason; it never aborts the upload.
 *   - Blank and zero stay distinct (missing optional field -> null, not 0).
 *   - Downstream can trust that stored numbers are real.
 */

const Papa = require('papaparse');
const XLSX = require('xlsx');

const {
  FIELD_NAMES,
  REQUIRED_FIELDS,
  REVENUE_SUBCATEGORY_FIELDS,
  FIELDS_BY_NAME,
  TYPE,
} = require('../config/schema');
const {
  LLM_MAPPING_AUTO_ACCEPT_CONFIDENCE,
  REVENUE_RECONCILE_TOLERANCE_PCT,
} = require('../config/thresholds');
const { normalizeNumber, normalizeDate, detectGranularity } = require('./normalize');
const { mapColumns: defaultMapColumns } = require('./mapColumns');

/* -------------------------------------------------------------------------- */
/* Parsers — each produces { headers, rows, parseErrors } in one shape        */
/* -------------------------------------------------------------------------- */

function parseCsv(text) {
  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });
  const headers = (result.meta.fields || []).filter((h) => h !== '');
  return { headers, rows: result.data, parseErrors: result.errors || [] };
}

/**
 * Parse an .xlsx buffer into exactly the shape parseCsv returns: `headers` is
 * the first row, `rows` are objects keyed by header with string cell values
 * (raw:false formats every cell as text, matching PapaParse).
 */
function parseXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  const sheet = sheetName ? wb.Sheets[sheetName] : null;
  if (!sheet) return { headers: [], rows: [], parseErrors: [] };

  const aoa = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });
  if (aoa.length === 0) return { headers: [], rows: [], parseErrors: [] };

  const headers = aoa[0].map((h) => String(h == null ? '' : h).trim());
  const activeHeaders = headers.filter((h) => h !== '');

  const rows = aoa.slice(1).map((arr) => {
    const obj = {};
    headers.forEach((h, i) => {
      if (h === '') return;
      obj[h] = arr[i] == null ? '' : String(arr[i]);
    });
    return obj;
  });

  return { headers: activeHeaders, rows, parseErrors: [] };
}

/* -------------------------------------------------------------------------- */
/* Row normalization — shared by every ingestion path                        */
/* -------------------------------------------------------------------------- */

/**
 * Normalize one row whose keys are already CANONICAL field names.
 * Uses the same normalizeNumber / normalizeDate as the CSV path.
 * @returns {{ out: Record<string, number|string|null>, fieldErrors: Array<{field,raw}> }}
 */
function normalizeRow(mapped) {
  const out = {};
  const fieldErrors = [];
  for (const field of FIELD_NAMES) {
    if (!(field in mapped) || mapped[field] === undefined) {
      out[field] = null;
      continue;
    }
    const isDate = FIELDS_BY_NAME[field].type === TYPE.DATE;
    const r = isDate ? normalizeDate(mapped[field]) : normalizeNumber(mapped[field]);
    if (r.state === 'invalid') {
      fieldErrors.push({ field, raw: r.raw });
      out[field] = null;
    } else {
      out[field] = r.value; // null when blank
    }
  }
  return { out, fieldErrors };
}

/**
 * Reconcile the revenue_* breakdown against total revenue for a row. Runs only
 * when all four subcategory fields are present (a partial breakdown is valid).
 */
function subcategorySumWarning(row) {
  const allPresent = REVENUE_SUBCATEGORY_FIELDS.every(
    (f) => row[f] !== null && row[f] !== undefined
  );
  if (!allPresent) return null;

  const revenue = row.revenue ?? 0;
  const sum = REVENUE_SUBCATEGORY_FIELDS.reduce((acc, f) => acc + row[f], 0);
  const diff = sum - revenue;
  const tolerance = Math.max(1, Math.abs(revenue) * REVENUE_RECONCILE_TOLERANCE_PCT);
  if (Math.abs(diff) <= tolerance) return null;

  return `${row.period_date}: revenue subcategories sum to ${sum} but revenue is ${revenue} (difference ${diff.toFixed(2)})`;
}

/* -------------------------------------------------------------------------- */
/* ingestParsed — the file pipeline, parser-agnostic                          */
/* -------------------------------------------------------------------------- */

/**
 * @param {{ headers: string[], rows: Array<Object>, parseErrors: Array }} parsed
 * @param {{ filename?, orgId?, source?, mapColumns? }} [opts]
 */
async function ingestParsed(parsed, opts = {}) {
  const filename = opts.filename || 'upload';
  const orgId = opts.orgId;
  const source = opts.source || 'file_upload';
  const mapColumns = opts.mapColumns || defaultMapColumns;
  const uploadedAt = new Date().toISOString();

  const { headers, rows: rawRows, parseErrors } = parsed;

  if (headers.length === 0) {
    const err = new Error('That file has no header row — no columns could be read.');
    err.statusCode = 422;
    throw err;
  }
  if (rawRows.length === 0) {
    const err = new Error('That file has a header row but no data rows to import.');
    err.statusCode = 422;
    throw err;
  }

  // --- Column mapping ---------------------------------------------------------
  const mapResult = await mapColumns(headers, { orgId });
  const { mapping } = mapResult;

  const mappedRequired = REQUIRED_FIELDS.filter((f) =>
    Object.values(mapping).some((m) => m.field === f)
  );
  if (mappedRequired.length === 0) {
    const err = new Error(
      'None of the columns in that file match the expected data. A dataset needs at least a date, revenue, expenses, and cash balance column.'
    );
    err.statusCode = 422;
    throw err;
  }

  const activeMap = {};
  for (const [header, m] of Object.entries(mapping)) {
    if (m.field) activeMap[header] = m;
  }

  // --- Row-by-row normalization + validation --------------------------------
  const storedRows = [];
  const skippedReasons = [];
  const duplicatesFlagged = [];
  const valueWarnings = [];
  const seenPeriods = new Set();
  let rowsProcessed = 0;

  rawRows.forEach((raw, idx) => {
    const rowNo = idx + 2; // +1 for header line, +1 for 1-based
    rowsProcessed += 1;

    const mapped = {};
    for (const [header, m] of Object.entries(activeMap)) {
      mapped[m.field] = raw[header];
    }

    const { out, fieldErrors } = normalizeRow(mapped);

    const missing = REQUIRED_FIELDS.filter((f) => out[f] === null || out[f] === undefined);
    if (missing.length > 0) {
      const badParse = fieldErrors
        .filter((e) => missing.includes(e.field))
        .map((e) => `${e.field}="${e.raw}"`);
      const detail = badParse.length
        ? `unparseable ${badParse.join(', ')}`
        : `missing required field(s): ${missing.join(', ')}`;
      skippedReasons.push(`Row ${rowNo}: ${detail}`);
      return;
    }

    if (seenPeriods.has(out.period_date)) {
      const msg = `Row ${rowNo}: duplicate period ${out.period_date} — kept the earlier row`;
      duplicatesFlagged.push(msg);
      skippedReasons.push(msg);
      return;
    }
    seenPeriods.add(out.period_date);

    for (const e of fieldErrors) {
      if (!REQUIRED_FIELDS.includes(e.field)) {
        valueWarnings.push(`Row ${rowNo}: could not parse ${e.field}="${e.raw}", stored as empty`);
      }
    }

    const usedMapConfidence = {};
    let allHigh = true;
    for (const [, m] of Object.entries(activeMap)) {
      if (out[m.field] !== null && out[m.field] !== undefined) {
        usedMapConfidence[m.field] = m.confidence;
        if (m.confidence < LLM_MAPPING_AUTO_ACCEPT_CONFIDENCE) allHigh = false;
      }
    }

    out.source_meta = {
      source,
      filename,
      uploaded_at: uploadedAt,
      row_confidence: allHigh ? 'high' : 'low',
      mapping_confidence: usedMapConfidence,
    };

    storedRows.push(out);
  });

  const revenueSubcategoryWarnings = storedRows.map(subcategorySumWarning).filter(Boolean);
  const { granularity, validPeriods, gaps } = detectGranularity(
    storedRows.map((r) => r.period_date)
  );
  const confidenceSummary = storedRows.reduce(
    (acc, r) => {
      acc[r.source_meta.row_confidence] += 1;
      return acc;
    },
    { high: 0, low: 0 }
  );

  const report = {
    filename,
    headers,
    columnMapping: mapping,
    mappingFromCache: mapResult.fromCache,
    llmUsed: mapResult.llmUsed,
    llmError: mapResult.llmError,
    fieldsNeedingConfirmation: mapResult.fieldsNeedingConfirmation,
    unmappedHeaders: mapResult.unmappedHeaders,
    dateGranularity: granularity,
    dateGaps: gaps,
    validPeriods,
    rowsProcessed,
    rowsStored: storedRows.length,
    rowsSkipped: rowsProcessed - storedRows.length,
    skippedReasons,
    duplicatesFlagged,
    valueWarnings,
    revenueSubcategoryWarnings,
    confidenceSummary,
    parseErrors: parseErrors.map((e) => `${e.type}: ${e.message} (row ${e.row})`),
  };

  return { report, rows: storedRows };
}

/* -------------------------------------------------------------------------- */
/* Public ingestion entry points                                             */
/* -------------------------------------------------------------------------- */

async function ingestCsv(csvText, opts = {}) {
  return ingestParsed(parseCsv(csvText), {
    source: 'csv_upload',
    filename: 'upload.csv',
    ...opts,
  });
}

async function ingestXlsx(buffer, opts = {}) {
  return ingestParsed(parseXlsx(buffer), {
    source: 'xlsx_upload',
    filename: 'upload.xlsx',
    ...opts,
  });
}

/**
 * Manual single-period entry. `values` is keyed by canonical field names (form
 * fields), so there is no column mapping — but every value still flows through
 * the same normalizeRow / required-field / subcategory checks as a file cell.
 * @returns {{ row: Object, warnings: string[] }}  (row includes source_meta)
 * @throws  a 422 Error if a required field is missing or unparseable
 */
function ingestManualEntry(values, opts = {}) {
  const clean = {};
  for (const f of FIELD_NAMES) {
    const v = values ? values[f] : undefined;
    if (v === undefined || v === null || String(v).trim() === '') continue;
    clean[f] = v;
  }

  const { out, fieldErrors } = normalizeRow(clean);

  const missing = REQUIRED_FIELDS.filter((f) => out[f] === null || out[f] === undefined);
  if (missing.length > 0) {
    const badParse = fieldErrors
      .filter((e) => missing.includes(e.field))
      .map((e) => `${e.field}="${e.raw}"`);
    const detail = badParse.length
      ? `unparseable ${badParse.join(', ')}`
      : `missing required field(s): ${missing.join(', ')}`;
    const err = new Error(`Manual entry rejected — ${detail}`);
    err.statusCode = 422;
    throw err;
  }

  const warnings = fieldErrors
    .filter((e) => !REQUIRED_FIELDS.includes(e.field))
    .map((e) => `could not parse ${e.field} = "${e.raw}", stored as empty`);
  const subWarning = subcategorySumWarning(out);
  if (subWarning) warnings.push(subWarning);

  out.source_meta = {
    source: 'manual_entry',
    filename: null,
    uploaded_at: new Date().toISOString(),
    row_confidence: 'high', // canonical fields, no mapping involved
    mapping_confidence: {},
  };

  return { row: out, warnings };
}

module.exports = {
  ingestCsv,
  ingestXlsx,
  ingestParsed,
  ingestManualEntry,
  parseCsv,
  parseXlsx,
  normalizeRow,
  subcategorySumWarning,
};

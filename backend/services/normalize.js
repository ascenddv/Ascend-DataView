/**
 * Deterministic value + date normalization for CSV ingestion.
 *
 * No LLM, no I/O — every function here is pure and independently testable.
 * The consistent return shape is `{ value, state, raw }` where `state` is one of:
 *   - 'ok'      → a usable value (a number, or a 'YYYY-MM-DD' string)
 *   - 'blank'   → intentionally empty / not provided (blank, 'N/A', '-'); value is null
 *   - 'invalid' → present but unparseable; value is null, caller decides what to do
 *
 * Blank and zero are deliberately kept distinct: '' → blank, '0' → ok/0.
 */

const BLANK_TOKENS = new Set(['', 'n/a', 'na', 'none', 'null', '-', '--', '—']);

function blank(raw) {
  return { value: null, state: 'blank', raw };
}
function invalid(raw) {
  return { value: null, state: 'invalid', raw };
}
function ok(value, raw) {
  return { value, state: 'ok', raw };
}

/**
 * Normalize a numeric cell.
 * Handles: `$`, thousands commas, surrounding whitespace, `(1,200)` → -1200,
 * trailing `%` → value / 100, and the blank-vs-zero distinction.
 */
function normalizeNumber(raw) {
  if (raw === null || raw === undefined) return blank(raw);
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? ok(raw, raw) : invalid(raw);
  }

  const trimmed = String(raw).trim();
  if (BLANK_TOKENS.has(trimmed.toLowerCase())) return blank(raw);

  // Parentheses denote a negative accounting value: (800) or ($1,200)
  let negative = false;
  let s = trimmed;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }

  let isPercent = false;
  if (s.endsWith('%')) {
    isPercent = true;
    s = s.slice(0, -1).trim();
  }

  // Strip currency symbols, thousands separators, spaces, and a leading + sign.
  s = s.replace(/[$£€]/g, '').replace(/,/g, '').replace(/\s/g, '').replace(/^\+/, '');

  if (s === '') return blank(raw);
  if (BLANK_TOKENS.has(s.toLowerCase())) return blank(raw);

  const n = Number(s);
  if (!Number.isFinite(n)) return invalid(raw);

  let value = negative ? -n : n;
  if (isPercent) value = value / 100;
  return ok(value, raw);
}

const MONTH_MAX_DAY = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function assembleDate(year, month, day, raw) {
  if (month < 1 || month > 12) return invalid(raw);
  if (day < 1 || day > MONTH_MAX_DAY[month - 1]) return invalid(raw);
  if (year < 1900 || year > 2200) return invalid(raw);
  return ok(`${year}-${pad2(month)}-${pad2(day)}`, raw);
}

/**
 * Normalize a date cell to canonical ISO `YYYY-MM-DD`.
 * Supported inputs:
 *   2025-01-31   (ISO)
 *   2025/01/31   (ISO with slashes)
 *   01/31/2025   1/31/2025   (US M/D/Y)
 *   01-31-2025   (US M-D-Y)
 */
function normalizeDate(raw) {
  if (raw === null || raw === undefined) return blank(raw);

  const s = String(raw).trim();
  if (s === '' || BLANK_TOKENS.has(s.toLowerCase())) return blank(raw);

  let m;

  // ISO: YYYY-MM-DD or YYYY/MM/DD
  m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return assembleDate(+m[1], +m[2], +m[3], raw);

  // US: MM/DD/YYYY or MM-DD-YYYY
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return assembleDate(+m[3], +m[1], +m[2], raw);

  return invalid(raw);
}

function monthsBetween(isoA, isoB) {
  const [ya, ma] = isoA.split('-').map(Number);
  const [yb, mb] = isoB.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

/**
 * Given a list of canonical ISO date strings, report the row-to-row cadence and
 * how many distinct valid periods were found.
 *
 * @returns {{ granularity: string, validPeriods: number, gaps: number }}
 */
function detectGranularity(isoDates) {
  const distinct = [...new Set(isoDates.filter(Boolean))].sort();
  if (distinct.length < 2) {
    return { granularity: 'unknown', validPeriods: distinct.length, gaps: 0 };
  }

  const diffs = [];
  for (let i = 1; i < distinct.length; i += 1) {
    diffs.push(monthsBetween(distinct[i - 1], distinct[i]));
  }

  const counts = diffs.reduce((acc, d) => {
    acc[d] = (acc[d] || 0) + 1;
    return acc;
  }, {});
  const dominant = Number(
    Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
  );

  const BY_MONTHS = { 1: 'monthly', 3: 'quarterly', 6: 'semi-annual', 12: 'annual' };
  const granularity = BY_MONTHS[dominant] || 'irregular';
  const gaps = diffs.filter((d) => d !== dominant).length;

  return { granularity, validPeriods: distinct.length, gaps };
}

module.exports = { normalizeNumber, normalizeDate, detectGranularity, monthsBetween };

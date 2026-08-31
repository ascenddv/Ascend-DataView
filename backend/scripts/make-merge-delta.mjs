/**
 * Build data/fixture_rich_v2_delta.csv for the Phase 13 merge gate:
 *   - the last 3 periods of fixture_rich_v2 with corrected (higher) financials
 *   - 2 brand-new periods (2026-01, 2026-02)
 * Full 28-column rows so the merged dataset still scores every dimension.
 *
 *   node scripts/make-merge-delta.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync('C:/Ascend-DataView/data/fixture_rich_v2.csv', 'utf8').trim().split('\n');
const header = src[0];
const cols = header.split(',');
const rows = src.slice(1).map((line) => {
  const o = {};
  line.split(',').forEach((v, i) => (o[cols[i]] = v));
  return o;
});

const idx = (name) => cols.indexOf(name);
const bump = (o, name, factor) => {
  o[name] = String(Math.round(Number(o[name]) * factor));
};

// 3 overlapping periods, corrected upward. Bump the revenue_* subcategories by
// the same factor as revenue so they still reconcile.
const overlap = rows.slice(-3).map((r) => {
  const o = { ...r };
  for (const c of ['revenue', 'revenue_donations', 'revenue_grants', 'revenue_events', 'revenue_other']) {
    bump(o, c, 1.06);
  }
  bump(o, 'expenses', 1.01);
  bump(o, 'cash_balance', 1.03);
  return o;
});

// 2 new periods: carry the Dec row forward with gentle growth
const dec = overlap[overlap.length - 1];
const grow = (base, name, f) => String(Math.round(Number(base[name]) * f));
function nextPeriod(base, date, f) {
  const o = { ...base, period_date: date };
  for (const c of cols) {
    if (c === 'period_date') continue;
    const n = Number(base[c]);
    if (Number.isFinite(n)) o[c] = grow(base, c, c === 'email_open_rate' ? 1.01 : f);
  }
  return o;
}
const jan = nextPeriod(dec, '2026-01-31', 1.04);
const feb = nextPeriod(jan, '2026-02-28', 1.04);

const all = [...overlap, jan, feb];
const out = [header, ...all.map((o) => cols.map((c) => o[c]).join(','))].join('\n') + '\n';
writeFileSync('C:/Ascend-DataView/data/fixture_rich_v2_delta.csv', out);
console.log(
  `wrote fixture_rich_v2_delta.csv — 5 rows: 3 overlapping (${overlap.map((o) => o.period_date).join(', ')}) + 2 new (${jan.period_date}, ${feb.period_date})`
);

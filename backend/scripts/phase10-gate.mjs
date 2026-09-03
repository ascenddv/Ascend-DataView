/**
 * Phase 10 gate:
 *   1. Upload fixture_rich_v2.csv (Org A) and fixture_rich_v2.xlsx (Org B);
 *      /api/metrics must be byte-identical, stored rows identical bar source_meta.
 *   2. Manual-enter a new period for Org A; it appears in /api/data + /api/metrics.
 *   3. Regression: CSV upload still works (step 1 proves it).
 *   4. org_id scoping: the manual entry lands in Org A only.
 *
 *   node scripts/phase10-gate.mjs <baseUrl> <repoRoot>
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] || 'http://localhost:3002';
const ROOT = process.argv[3] || 'C:/Ascend-DataView';

function client() {
  let cookie = null;
  return async (method, p, { body, form } = {}) => {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(BASE + p, { method, headers, body: payload });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };
}

function fileForm(file, mime) {
  const fd = new FormData();
  fd.append('file', new Blob([readFileSync(path.join(ROOT, 'data', file))], { type: mime }), file);
  return fd;
}

async function signupAndUpload(label, file, mime) {
  const stamp = Date.now() + Math.floor(Math.random() * 1e4);
  const req = client();
  await req('POST', '/api/auth/signup', {
    body: { email: `p10_${label}_${stamp}@test.com`, password: 'ascend-gate-K7m2Qp-Zx9', orgName: `P10 ${label} ${stamp}`, acceptTos: true },
  });
  const up = await req('POST', '/api/upload', { form: fileForm(file, mime) });
  const metrics = await req('GET', '/api/metrics');
  const data = await req('GET', '/api/data');
  return { req, up: up.json, metrics: metrics.json, data: data.json };
}

let failures = 0;
const check = (label, cond, detail = '') => {
  if (!cond) failures += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};
const canon = (x) => JSON.stringify(x);

/* ---- 1. CSV vs XLSX ---------------------------------------------------- */
console.log('\n== fixture_rich_v2: CSV upload vs XLSX upload ==');
const csv = await signupAndUpload('csv', 'fixture_rich_v2.csv', 'text/csv');
const xlsx = await signupAndUpload(
  'xlsx',
  'fixture_rich_v2.xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
);

check('CSV upload stored 12 rows', csv.up.rowsStored === 12, `stored ${csv.up.rowsStored}`);
check('XLSX upload stored 12 rows', xlsx.up.rowsStored === 12, `stored ${xlsx.up.rowsStored}`);
check(
  '/api/metrics is byte-identical (CSV vs XLSX)',
  canon(csv.metrics) === canon(xlsx.metrics)
);
if (canon(csv.metrics) !== canon(xlsx.metrics)) {
  // surface where they diverge
  for (const k of Object.keys(csv.metrics)) {
    if (canon(csv.metrics[k]) !== canon(xlsx.metrics[k])) console.log(`      differs at .${k}`);
  }
}

const stripSourceMeta = (rows) =>
  rows.map((r) => {
    const { source_meta, ...fields } = r;
    return fields;
  });
check(
  'stored rows identical bar source_meta (CSV vs XLSX)',
  canon(stripSourceMeta(csv.data.rows)) === canon(stripSourceMeta(xlsx.data.rows))
);
check(
  'source_meta.source records the input method',
  csv.data.rows[0].source_meta.source === 'csv_upload' &&
    xlsx.data.rows[0].source_meta.source === 'xlsx_upload',
  `${csv.data.rows[0].source_meta.source} / ${xlsx.data.rows[0].source_meta.source}`
);

/* ---- 2. Manual single-period entry ---------------------------------- */
console.log('\n== manual entry: add one new period to the CSV org ==');
const newPeriod = {
  period_date: '01/31/2026', // US format on purpose — same normalizer as a CSV cell
  revenue: '$36,900',
  expenses: '32100',
  cash_balance: '124000',
  donors_total: '248',
  employees_total: '38',
  goals_total: '12',
  goals_completed: '10',
};
const entry = await csv.req('POST', '/api/manual-entry', { body: { values: newPeriod } });
check('manual entry accepted', entry.json && entry.json.ok === true, JSON.stringify(entry.json));
check('normalized period_date to ISO', entry.json && entry.json.period === '2026-01-31', entry.json && entry.json.period);

const afterData = await csv.req('GET', '/api/data');
const afterMetrics = await csv.req('GET', '/api/metrics');
check('/api/data now has 13 rows', afterData.json.count === 13, `count ${afterData.json.count}`);
const jan26 = afterData.json.rows.find((r) => r.period_date === '2026-01-31');
check('new row stored with normalized values', jan26 && jan26.revenue === 36900 && jan26.expenses === 32100, jan26 && JSON.stringify({ rev: jan26.revenue, exp: jan26.expenses }));
check('new row source_meta.source = manual_entry', jan26 && jan26.source_meta.source === 'manual_entry');
check('/api/metrics reflects the new period (13 periods)', afterMetrics.json.dataset.periodCount === 13, `periods ${afterMetrics.json.dataset.periodCount}`);
check('/api/metrics latestPeriod is the manually entered one', afterMetrics.json.dataset.latestPeriod === '2026-01-31');

/* ---- 3. re-entering a period upserts (no duplicate) ---------------- */
const reentry = await csv.req('POST', '/api/manual-entry', {
  body: { values: { ...newPeriod, revenue: '37500' } },
});
const afterReentry = await csv.req('GET', '/api/data');
check('re-entering the same period updates in place (still 13 rows)', afterReentry.json.count === 13, `count ${afterReentry.json.count}`);
check('re-entry updated the value', afterReentry.json.rows.find((r) => r.period_date === '2026-01-31').revenue === 37500);

/* ---- 4. org_id scoping ------------------------------------------- */
console.log('\n== org_id scoping ==');
const xlsxDataAfter = await xlsx.req('GET', '/api/data');
check("the XLSX org is untouched by the CSV org's manual entry (still 12 rows)", xlsxDataAfter.json.count === 12, `count ${xlsxDataAfter.json.count}`);
check('manual-entry requires auth', (await (await fetch(BASE + '/api/manual-entry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()).error === 'Authentication required.');

console.log(`\n${failures === 0 ? 'ALL PHASE 10 CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

/**
 * Phase 14 gate — confidence indicators, mapping confirmation, metric definitions.
 *   node scripts/phase14-gate.mjs <baseUrl> <repoRoot>
 *
 * The messy fixture's per-org mapping cache is seeded with realistic
 * sub-threshold confidences (Gemini's free tier is exhausted), so the
 * confirmation flow and the Medium/Low tiers are exercised against real
 * endpoints end to end.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { hashHeaders } = require('../services/mapColumns');
const { putCachedMapping } = require('../db');

const BASE = process.argv[2] || 'http://localhost:3002';
const ROOT = process.argv[3] || 'C:/Ascend-DataView';

let fail = 0;
const check = (label, cond, detail = '') => {
  if (!cond) fail += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

function client() {
  let cookie = null;
  return async (m, p, { body, form } = {}) => {
    const h = {};
    if (cookie) h.Cookie = cookie;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
      h['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const r = await fetch(BASE + p, { method: m, headers: h, body: payload });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, json: await r.json().catch(() => null) };
  };
}
const fileForm = (f) => {
  const fd = new FormData();
  fd.append('file', new Blob([readFileSync(path.join(ROOT, 'data', f))], { type: 'text/csv' }), f);
  return fd;
};
async function signup(req, label) {
  const s = Date.now() + Math.floor(Math.random() * 1e5);
  const r = await req('POST', '/api/auth/signup', {
    body: { email: `p14_${label}_${s}@t.co`, password: 'ascend-gate-K7m2Qp-Zx9', orgName: `P14 ${label} ${s}`, acceptTos: true },
  });
  return r.json.org;
}

const MESSY_HEADERS = ['Month', 'Rev ($)', 'Total Expenses', 'Cash on Hand', 'Other Income', 'Total Donors', 'New Donors'];
const MESSY_MAPPING = {
  'Month': { field: 'period_date', confidence: 0.9, source: 'llm' },
  'Rev ($)': { field: 'revenue', confidence: 0.58, source: 'llm' },
  'Total Expenses': { field: 'expenses', confidence: 0.62, source: 'llm' },
  'Cash on Hand': { field: 'cash_balance', confidence: 0.9, source: 'llm' },
  'Other Income': { field: 'revenue_other', confidence: 0.45, source: 'llm' },
  'Total Donors': { field: 'donors_total', confidence: 0.9, source: 'llm' },
  'New Donors': { field: 'donors_new', confidence: 0.9, source: 'llm' },
};

/* ---- 14b: mapping confirmation ----------------------------------------- */
console.log('\n== 14b — column mapping confirmation (pre-storage) ==');
const M = client();
const orgM = await signup(M, 'messy');
await putCachedMapping(orgM.id, hashHeaders(MESSY_HEADERS), MESSY_MAPPING);

const up1 = await M('POST', '/api/upload', { form: fileForm('fixture_messy.csv') });
check('a low-confidence upload pauses instead of storing',
  up1.json.needsConfirmation === true && typeof up1.json.pendingId === 'string',
  JSON.stringify({ needs: up1.json.needsConfirmation }));

const flaggedHeaders = (up1.json.fieldsNeedingConfirmation || []).map((f) => f.header).sort();
check('exactly the sub-threshold columns are flagged',
  JSON.stringify(flaggedHeaders) === JSON.stringify(['Other Income', 'Rev ($)', 'Total Expenses']),
  flaggedHeaders.join(', '));
check('a confidently-mapped column (Cash on Hand) is NOT flagged',
  !flaggedHeaders.includes('Cash on Hand'));
check('flagged entries carry example cell values for the user',
  (up1.json.fieldsNeedingConfirmation || []).every((f) => Array.isArray(f.samples) && f.samples.length > 0));

const dataBeforeConfirm = await M('GET', '/api/data');
check('nothing was stored while the upload is paused', dataBeforeConfirm.json.count === 0,
  `count ${dataBeforeConfirm.json.count}`);

// confirm two guesses as-is; deliberately RE-POINT "Other Income" to revenue_donations
const confirmRes = await M('POST', '/api/upload/confirm', {
  body: {
    pendingId: up1.json.pendingId,
    corrections: {
      'Rev ($)': 'revenue',
      'Total Expenses': 'expenses',
      'Other Income': 'revenue_donations',
    },
  },
});
check('confirming stores the file', confirmRes.status === 200 && confirmRes.json.ok === true
  && confirmRes.json.confirmedMappingApplied === true
  && confirmRes.json.periodsAdded > 0,
  JSON.stringify({ s: confirmRes.status, added: confirmRes.json.periodsAdded }));

const dataM = await M('GET', '/api/data');
const rowM = dataM.json.rows.find((r) => r.period_date === '2025-01-31');
check('the CORRECTED mapping is what got stored (Other Income -> revenue_donations)',
  rowM && rowM.revenue_donations === 350 && rowM.revenue_other === null,
  JSON.stringify({ donations: rowM && rowM.revenue_donations, other: rowM && rowM.revenue_other }));
check('a confirmed guess still stored its cell (Rev ($) -> revenue)', rowM && rowM.revenue === 12400,
  `revenue ${rowM && rowM.revenue}`);
check('source_meta records the human confirmation',
  rowM && rowM.source_meta && rowM.source_meta.mapping_confirmed
    && rowM.source_meta.mapping_confirmed.revenue === true
    && rowM.source_meta.mapping_confirmed.expenses === true);

const reconfirmExpired = await M('POST', '/api/upload/confirm', {
  body: { pendingId: up1.json.pendingId, corrections: {} },
});
check('a pending upload is single-use (re-confirm -> 404)', reconfirmExpired.status === 404);

/* ---- pending uploads are org-scoped ---------------------------------- */
console.log('\n== pending upload is scoped to the acting org ==');
const R = client();
const orgR = await signup(R, 'rich');
const up2 = await M('POST', '/api/upload', { form: fileForm('fixture_messy.csv') }); // fresh pause (cache hit)
check('re-upload pauses again from the seeded cache', up2.json.needsConfirmation === true);
const crossOrg = await R('POST', '/api/upload/confirm', {
  body: { pendingId: up2.json.pendingId, corrections: { 'Rev ($)': 'revenue' } },
});
check('another org cannot complete this org\'s pending upload -> 404', crossOrg.status === 404,
  `status ${crossOrg.status}`);
await M('POST', '/api/upload/confirm', {
  body: { pendingId: up2.json.pendingId, corrections: { 'Rev ($)': 'revenue', 'Total Expenses': 'expenses', 'Other Income': 'revenue_donations' } },
});

/* ---- 14a: confidence tiers on the merged metrics -------------------- */
console.log('\n== 14a — per-card confidence tiers ==');
const metricsM = await M('GET', '/api/metrics');
const cM = metricsM.json.confidence || {};
check('metrics payload carries a confidence block', Object.keys(cM).length > 0);
check('a card fed by a confirmed fuzzy match reads Medium (kpi-revenue)',
  cM['kpi-revenue'] && cM['kpi-revenue'].tier === 'Medium',
  cM['kpi-revenue'] && cM['kpi-revenue'].tier);
check('a card fed only by a confident match reads High (kpi-cash_balance)',
  cM['kpi-cash_balance'] && cM['kpi-cash_balance'].tier === 'High',
  cM['kpi-cash_balance'] && cM['kpi-cash_balance'].tier);
check('weakest-link: Financial health (revenue+expenses+cash) reads Medium',
  cM['health-Financial'] && cM['health-Financial'].tier === 'Medium',
  cM['health-Financial'] && cM['health-Financial'].tier);
check('the explanation is plain language with no raw confidence numbers',
  cM['kpi-revenue'] && cM['kpi-revenue'].reasons.length > 0
    && cM['kpi-revenue'].reasons.every((r) => typeof r === 'string' && !/\d/.test(r)),
  JSON.stringify(cM['kpi-revenue'] && cM['kpi-revenue'].reasons));

const upR = await R('POST', '/api/upload', { form: fileForm('fixture_rich_v2.csv') });
check('a clean all-exact-headers upload stores with no confirmation step',
  upR.json.ok === true && !upR.json.needsConfirmation && upR.json.periodsAdded === 12,
  JSON.stringify({ needs: upR.json.needsConfirmation, added: upR.json.periodsAdded }));
const metricsR = await R('GET', '/api/metrics');
const cR = metricsR.json.confidence || {};
check('every cleanly-sourced card on the rich org reads High',
  cR['kpi-revenue'] && cR['kpi-revenue'].tier === 'High'
    && cR['health-Financial'] && cR['health-Financial'].tier === 'High'
    && cR['kpi-expenses'].tier === 'High',
  JSON.stringify({ rev: cR['kpi-revenue'] && cR['kpi-revenue'].tier, fin: cR['health-Financial'] && cR['health-Financial'].tier }));

console.log(`\n${fail === 0 ? 'ALL PHASE 14 CHECKS PASSED' : `${fail} CHECK(S) FAILED`}`);
process.exit(fail === 0 ? 0 : 1);

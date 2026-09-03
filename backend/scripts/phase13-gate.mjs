/**
 * Phase 13 gate — upload merge + the explicit reset action.
 *   node scripts/phase13-gate.mjs <baseUrl> <repoRoot>
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] || 'http://localhost:3002';
const ROOT = process.argv[3] || 'C:/Ascend-DataView';

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
    body: { email: `p13_${label}_${s}@t.co`, password: 'ascend-gate-K7m2Qp-Zx9', orgName: `P13 ${label} ${s}`, acceptTos: true },
  });
  return r.json.org;
}

let fail = 0;
const check = (label, cond, detail = '') => {
  if (!cond) fail += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

/* ---- merge ---------------------------------------------------------------- */
console.log('\n== upload merges into existing history ==');
const A = client();
const orgA = await signup(A, 'A');

const up1 = await A('POST', '/api/upload', { form: fileForm('fixture_rich_v2.csv') });
check('first upload: 12 periods added, 0 updated',
  up1.json.periodsAdded === 12 && up1.json.periodsUpdated === 0,
  JSON.stringify({ a: up1.json.periodsAdded, u: up1.json.periodsUpdated }));

const up2 = await A('POST', '/api/upload', { form: fileForm('fixture_rich_v2_delta.csv') });
check('second upload reports "2 periods added, 3 updated"',
  up2.json.periodsAdded === 2 && up2.json.periodsUpdated === 3,
  JSON.stringify({ a: up2.json.periodsAdded, u: up2.json.periodsUpdated }));

const dataA = await A('GET', '/api/data');
check('dataset now has 14 periods total (not 12, not 17)', dataA.json.count === 14, `count ${dataA.json.count}`);

const byPeriod = Object.fromEntries(dataA.json.rows.map((r) => [r.period_date, r]));
check('an overlapping period (2025-12-31) shows the SECOND file\'s corrected figure',
  byPeriod['2025-12-31'].revenue === 36676,
  `revenue ${byPeriod['2025-12-31'].revenue} (was 34600)`);
check('a non-overlapping original period (2025-06-30) is untouched',
  byPeriod['2025-06-30'].revenue === 22300);
check('the 2 new periods exist', Boolean(byPeriod['2026-01-31'] && byPeriod['2026-02-28']));
check('an overlapping row now carries source_meta from the second file',
  byPeriod['2025-12-31'].source_meta.filename === 'fixture_rich_v2_delta.csv');

const metricsA = await A('GET', '/api/metrics');
check('/api/metrics is computed over the merged 14-period history',
  metricsA.json.dataset.periodCount === 14 && metricsA.json.dataset.latestPeriod === '2026-02-28',
  `periods ${metricsA.json.dataset.periodCount}, latest ${metricsA.json.dataset.latestPeriod}`);
check('all 8 dimensions still score on the merged set',
  Object.values(metricsA.json.healthScores).every((h) => h.status === 'Available'));
check('a trend series spans the full merged range',
  metricsA.json.series.revenue.length === 14 &&
    metricsA.json.series.revenue[13].period === '2026-02-28');

/* ---- reset ------------------------------------------------------------- */
console.log('\n== reset action ==');
const B = client();
const orgB = await signup(B, 'B');
await B('POST', '/api/upload', { form: fileForm('fixture_sparse.csv') });
const bBefore = await B('GET', '/api/data');
check('org B has 3 periods before A resets', bBefore.json.count === 3);

const noConfirm = await A('DELETE', `/api/organizations/${orgA.id}/data`, { body: {} });
check('reset with no confirmation text -> 400, nothing deleted', noConfirm.status === 400,
  `status ${noConfirm.status}`);
const wrongConfirm = await A('DELETE', `/api/organizations/${orgA.id}/data`, { body: { confirm: 'not the name' } });
check('reset with wrong confirmation text -> 400', wrongConfirm.status === 400);
const stillThere = await A('GET', '/api/data');
check('data still intact after the two rejected resets', stillThere.json.count === 14);

const crossOrg = await A('DELETE', `/api/organizations/${orgB.id}/data`, { body: { confirm: orgB.name } });
check('org A cannot target org B by changing the :id param -> 403', crossOrg.status === 403,
  `status ${crossOrg.status}`);

const ok = await A('DELETE', `/api/organizations/${orgA.id}/data`, { body: { confirm: orgA.name } });
check('reset with the correct org name -> 200, deletes A\'s 14 periods',
  ok.status === 200 && ok.json.deleted === 14, JSON.stringify({ s: ok.status, d: ok.json.deleted }));
const aAfter = await A('GET', '/api/data');
check('org A now has 0 periods', aAfter.json.count === 0);

const bAfter = await B('GET', '/api/data');
check('org B is completely untouched (still 3 periods)', bAfter.json.count === 3, `count ${bAfter.json.count}`);

console.log(`\n${fail === 0 ? 'ALL PHASE 13 CHECKS PASSED' : `${fail} CHECK(S) FAILED`}`);
process.exit(fail === 0 ? 0 : 1);

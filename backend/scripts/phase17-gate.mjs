/**
 * Phase 17 gate — onboarding flag + completion endpoint.
 *   node scripts/phase17-gate.mjs <baseUrl>
 *
 * The wizard/tour UI itself is covered by the Playwright walkthrough; this
 * verifies the server contract: a fresh org starts un-onboarded, the flag flips
 * only for the acting org and then persists across logins, and the CSV template
 * has a real schema to build from.
 */

import { readFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:3001';

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
async function signup(req, label) {
  const s = Date.now() + Math.floor(Math.random() * 1e5);
  const email = `p17_${label}_${s}@t.co`;
  const r = await req('POST', '/api/auth/signup', {
    body: { email, password: 'ascend-gate-K7m2Qp-Zx9', orgName: `P17 ${label} ${s}`, acceptTos: true },
  });
  return { org: r.json.org, email, password: 'ascend-gate-K7m2Qp-Zx9' };
}

/* ---- a fresh org starts un-onboarded ------------------------------- */
console.log('\n== a new signup is not yet onboarded ==');
const A = client();
const a = await signup(A, 'A');
check('signup response carries onboardingCompleted: false', a.org.onboardingCompleted === false,
  JSON.stringify(a.org));
const meA1 = await A('GET', '/api/auth/me');
check('/api/auth/me reports the org as not onboarded',
  meA1.json.authenticated === true && meA1.json.org.onboardingCompleted === false);

/* ---- CSV template has a schema to build from --------------------- */
const schema = await A('GET', '/api/schema');
const periodField = (schema.json.fields || []).find((f) => f.name === 'period_date');
check('GET /api/schema exposes the field list the template is built from',
  Array.isArray(schema.json.fields) && schema.json.fields.length >= 20 && periodField && periodField.type === 'date' && periodField.required === true,
  `${schema.json.fields && schema.json.fields.length} fields`);

/* ---- completion is scoped to the acting org -------------------- */
console.log('\n== only the acting org can flip its own flag ==');
const B = client();
const b = await signup(B, 'B');
const cross = await A('POST', `/api/organizations/${b.org.id}/onboarding-complete`);
check('org A cannot complete org B\'s onboarding -> 403', cross.status === 403, `status ${cross.status}`);
const meB = await B('GET', '/api/auth/me');
check('org B is still not onboarded after A\'s attempt', meB.json.org.onboardingCompleted === false);
const badId = await A('POST', '/api/organizations/not-a-number/onboarding-complete');
check('a non-numeric :id is rejected -> 403', badId.status === 403);

/* ---- the wizard upload path, then completion ------------------ */
console.log('\n== completing onboarding sticks across logins ==');
const upForm = () => {
  const fd = new FormData();
  fd.append('file', new Blob([readFileSync('C:/Ascend-DataView/data/fixture_rich_v2.csv')], { type: 'text/csv' }), 'fixture_rich_v2.csv');
  return fd;
};
const up = await A('POST', '/api/upload', { form: upForm() });
check('the wizard\'s upload path stores data', up.json.ok === true && up.json.periodsAdded === 12);

const done = await A('POST', `/api/organizations/${a.org.id}/onboarding-complete`);
check('completing onboarding -> 200 { onboardingCompleted: true }',
  done.status === 200 && done.json.onboardingCompleted === true, JSON.stringify(done.json));

const meA2 = await A('GET', '/api/auth/me');
check('the same session now reports onboarded', meA2.json.org.onboardingCompleted === true);

const relogin = await A('POST', '/api/auth/login', { body: { email: a.email, password: a.password } });
check('a fresh login still reports onboarded (wizard/tour will not reappear)',
  relogin.json.org.onboardingCompleted === true, JSON.stringify(relogin.json.org));

const again = await A('POST', `/api/organizations/${a.org.id}/onboarding-complete`);
check('calling completion again is idempotent -> still true',
  again.status === 200 && again.json.onboardingCompleted === true);

console.log(`\n${fail === 0 ? 'ALL PHASE 17 CHECKS PASSED' : `${fail} CHECK(S) FAILED`}`);
process.exit(fail === 0 ? 0 : 1);

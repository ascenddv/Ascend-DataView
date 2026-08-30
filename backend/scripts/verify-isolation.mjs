/**
 * Phase 8 isolation proof — runs against a live server. Creates two orgs, uploads
 * different fixtures to each, then calls the real endpoints under each session
 * and asserts no cross-org leakage. Includes deliberate isolation-breaking
 * attempts (no cookie, forged JWT, tampered query param).
 *
 *   node scripts/verify-isolation.mjs <baseUrl> <repoRoot>
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: path.join(process.argv[3] || '.', '.env') });

const BASE = process.argv[2] || 'http://localhost:3002';
const ROOT = process.argv[3] || 'C:/Ascend-DataView';

let failures = 0;
const check = (label, cond, detail = '') => {
  const ok = Boolean(cond);
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

// --- tiny cookie-aware client -------------------------------------------------
function makeClient() {
  let cookie = null;
  return {
    get cookie() {
      return cookie;
    },
    async req(method, urlPath, { body, form, rawCookie } = {}) {
      const headers = {};
      const useCookie = rawCookie !== undefined ? rawCookie : cookie;
      if (useCookie) headers.Cookie = useCookie;
      let payload;
      if (form) {
        payload = form;
      } else if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
      const res = await fetch(`${BASE}${urlPath}`, { method, headers, body: payload });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie && rawCookie === undefined) cookie = setCookie.split(';')[0];
      let json = null;
      try {
        json = await res.json();
      } catch {
        /* non-json */
      }
      return { status: res.status, json };
    },
  };
}

function fixtureForm(name) {
  const fd = new FormData();
  const buf = readFileSync(path.join(ROOT, 'data', `fixture_${name}.csv`));
  fd.append('file', new Blob([buf], { type: 'text/csv' }), `fixture_${name}.csv`);
  return fd;
}

// --- run -------------------------------------------------------------------
console.log('\n== signup ==');
const A = makeClient();
const B = makeClient();
const stamp = Date.now();
const su1 = await A.req('POST', '/api/auth/signup', {
  body: { email: `a_${stamp}@test.com`, password: 'password123', orgName: 'Org Alpha' },
});
const su2 = await B.req('POST', '/api/auth/signup', {
  body: { email: `b_${stamp}@test.com`, password: 'password123', orgName: 'Org Beta' },
});
check('Org Alpha signup 201', su1.status === 201, `status ${su1.status}`);
check('Org Beta signup 201', su2.status === 201, `status ${su2.status}`);
const orgAId = su1.json?.org?.id;
const orgBId = su2.json?.org?.id;
check('distinct org ids', orgAId && orgBId && orgAId !== orgBId, `A=${orgAId} B=${orgBId}`);

console.log('\n== upload: rich -> Alpha, sparse -> Beta ==');
const upA = await A.req('POST', '/api/upload', { form: fixtureForm('rich') });
const upB = await B.req('POST', '/api/upload', { form: fixtureForm('sparse') });
check('Alpha upload ok, 12 rows', upA.json?.ok && upA.json?.rowsStored === 12, JSON.stringify({ s: upA.status, n: upA.json?.rowsStored }));
check('Beta upload ok, 3 rows', upB.json?.ok && upB.json?.rowsStored === 3, JSON.stringify({ s: upB.status, n: upB.json?.rowsStored }));

console.log('\n== each session sees only its own data ==');
const mA = await A.req('GET', '/api/metrics');
const mB = await B.req('GET', '/api/metrics');
check('Alpha /api/metrics = 12 periods', mA.json?.dataset?.periodCount === 12, `got ${mA.json?.dataset?.periodCount}`);
check('Beta /api/metrics = 3 periods', mB.json?.dataset?.periodCount === 3, `got ${mB.json?.dataset?.periodCount}`);
check(
  'Alpha has all 3 health scores',
  ['Financial', 'Growth', 'Community'].every((d) => mA.json?.healthScores?.[d]?.status === 'Available')
);
check(
  'Beta has ONLY Financial (Growth/Community Unavailable)',
  mB.json?.healthScores?.Financial?.status === 'Available' &&
    mB.json?.healthScores?.Growth?.status === 'Unavailable' &&
    mB.json?.healthScores?.Community?.status === 'Unavailable'
);

const dA = await A.req('GET', '/api/data');
const dB = await B.req('GET', '/api/data');
const filesA = new Set(dA.json?.rows?.map((r) => r.source_meta?.filename));
const filesB = new Set(dB.json?.rows?.map((r) => r.source_meta?.filename));
check('Alpha /api/data has 12 rows, all fixture_rich.csv', dA.json?.count === 12 && filesA.size === 1 && filesA.has('fixture_rich.csv'), [...filesA].join());
check('Beta /api/data has 3 rows, all fixture_sparse.csv', dB.json?.count === 3 && filesB.size === 1 && filesB.has('fixture_sparse.csv'), [...filesB].join());
check('Alpha never sees sparse data', !filesA.has('fixture_sparse.csv'));
check('Beta never sees rich data', !filesB.has('fixture_rich.csv'));
check('Neither sees the Demo Nonprofit (messy) data', !filesA.has('fixture_messy.csv') && !filesB.has('fixture_messy.csv'));

console.log('\n== isolation-breaking attempts ==');
const noCookie = await A.req('GET', '/api/metrics', { rawCookie: null });
check('no cookie -> 401', noCookie.status === 401, `status ${noCookie.status}`);

const forged = jwt.sign({ userId: 1, orgId: orgBId, email: 'attacker@evil.com' }, 'wrong-secret');
const forgedRes = await A.req('GET', '/api/metrics', { rawCookie: `ascenddv_token=${forged}` });
check('forged JWT (wrong secret) claiming Org Beta -> 401', forgedRes.status === 401, `status ${forgedRes.status}`);

const noneAlg = jwt.sign({ userId: 1, orgId: orgBId }, '', { algorithm: 'none' });
const noneRes = await A.req('GET', '/api/metrics', { rawCookie: `ascenddv_token=${noneAlg}` });
check('alg:none JWT claiming Org Beta -> 401', noneRes.status === 401, `status ${noneRes.status}`);

// Alpha's *valid* session, but trying to steer it at Beta via query params.
const tamper1 = await A.req('GET', `/api/metrics?org_id=${orgBId}`);
const tamper2 = await A.req('GET', `/api/data?orgId=${orgBId}&org=${orgBId}`);
check(
  'Alpha valid cookie + ?org_id=<Beta> -> still 12 periods (param ignored)',
  tamper1.json?.dataset?.periodCount === 12,
  `got ${tamper1.json?.dataset?.periodCount}`
);
const tamperFiles = new Set(tamper2.json?.rows?.map((r) => r.source_meta?.filename));
check(
  'Alpha valid cookie + ?orgId=<Beta> on /api/data -> still fixture_rich.csv only',
  tamper2.json?.count === 12 && tamperFiles.size === 1 && tamperFiles.has('fixture_rich.csv'),
  [...tamperFiles].join()
);

console.log(`\n${failures === 0 ? 'ALL ISOLATION CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

/**
 * Phase 21 gate — the security-hardening items that shipped in Phase 21 with
 * no automated coverage (flagged in the Stages 21–31 audit close-out):
 *
 *   1. the security response headers (helmet/CSP, X-Content-Type-Options,
 *      X-Frame-Options, Permissions-Policy, Referrer-Policy) are actually
 *      emitted on a live response, and the app leaves HSTS to the Vercel edge.
 *   2. an upload larger than the 4 MB multer cap is rejected 413 with the
 *      size-limit message (not a generic 500 or an opaque platform error).
 *   3. data/fixture_rich_v2.xlsx ingests to the same standardized rows as
 *      data/fixture_rich_v2.csv — i.e. the SheetJS CDN repin still round-trips.
 *   4. with VERCEL=1 the AscendAI chat response carries no `trace` key
 *      (the debugging payload is suppressed in production), while a non-Vercel
 *      backend still exposes it (positive control, so this isn't a false pass).
 *
 *   node scripts/phase21-gate.mjs
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const db = require('../db');

const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]+$/, '');
const PLAIN = 'http://localhost:3211';
const VERCEL_BASE = 'http://localhost:3212';
const LOCAL_PG = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5433/ascenddv';
const PW = 'ascend-gate-K7m2Qp-Zx9';

let fail = 0;
const check = (label, cond, detail = '') => {
  if (!cond) fail += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealth(base, tries = 80) {
  for (let i = 0; i < tries; i += 1) {
    try { if ((await fetch(base + '/api/health')).ok) return; } catch { /* not up */ }
    await sleep(250);
  }
  throw new Error(`${base} never became healthy`);
}

function startBackend(port, extraEnv = {}) {
  return spawn(process.execPath, ['index.js'], {
    cwd: `${ROOT}/backend`,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: LOCAL_PG,
      JWT_SECRET: process.env.JWT_SECRET || 'phase21-gate-secret-not-for-production-00000',
      HIBP_CHECK_ENABLED: '0',
      RESEND_API_KEY: '',
      GEMINI_API_KEY: '',
      DEEPSEEK_API_KEY: '',
      ...extraEnv,
    },
    stdio: 'ignore',
  });
}

function makeClient(base) {
  let cookie = null;
  return {
    async req(m, p, { body, form } = {}) {
      const h = {};
      if (cookie) h.Cookie = cookie;
      let payload;
      if (form) payload = form;
      else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
      const r = await fetch(base + p, { method: m, headers: h, body: payload });
      const sc = r.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      return { status: r.status, headers: r.headers, json: async () => r.json().catch(() => null) };
    },
  };
}

const clearLimits = () => db.getDb().query('DELETE FROM rate_limits');

async function signupVerified(base, label) {
  const c = makeClient(base);
  const s = Date.now() + Math.floor(Math.random() * 1e5);
  const email = `p21_${label}_${s}@t.co`;
  const r = await c.req('POST', '/api/auth/signup', {
    body: { email, password: PW, orgName: `P21 ${label} ${s}`, acceptTos: true },
  });
  const org = (await r.json())?.org;
  await db.getDb().query('UPDATE users SET email_verified_at = now() WHERE org_id = $1', [org.id]);
  await c.req('POST', '/api/auth/login', { body: { email, password: PW } });
  return { c, org };
}

const blobForm = (bytes, name, type) => {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type }), name);
  return fd;
};

// standardized_data columns that legitimately differ between two uploads of the
// same data (row id, org, ingest time, and the per-file source metadata).
const VOLATILE = new Set(['id', 'org_id', 'created_at', 'source_meta']);
const normRows = (rows) =>
  rows
    .map((row) => {
      const out = {};
      for (const [k, v] of Object.entries(row)) if (!VOLATILE.has(k)) out[k] = v;
      return out;
    })
    .sort((a, b) => String(a.period_date).localeCompare(String(b.period_date)));

const procs = [];
try {
  await db.initDb();
  procs.push(startBackend(3211));
  procs.push(startBackend(3212, { VERCEL: '1' }));
  await waitHealth(PLAIN);
  await waitHealth(VERCEL_BASE);

  /* ============================================================ */
  console.log('\n== 1. security response headers are present on a live response ==');
  const h = (await fetch(PLAIN + '/api/health')).headers;
  const csp = h.get('content-security-policy') || '';
  check("Content-Security-Policy: default-src 'none' + frame-ancestors 'none'",
    /default-src 'none'/.test(csp) && /frame-ancestors 'none'/.test(csp), csp.slice(0, 90));
  check('X-Content-Type-Options: nosniff', h.get('x-content-type-options') === 'nosniff',
    String(h.get('x-content-type-options')));
  check('X-Frame-Options: DENY', h.get('x-frame-options') === 'DENY', String(h.get('x-frame-options')));
  check('Referrer-Policy: strict-origin-when-cross-origin',
    h.get('referrer-policy') === 'strict-origin-when-cross-origin', String(h.get('referrer-policy')));
  check('Permissions-Policy locks camera/microphone/geolocation/payment',
    /camera=\(\)/.test(h.get('permissions-policy') || '') && /payment=\(\)/.test(h.get('permissions-policy') || ''),
    String(h.get('permissions-policy')));
  check('the app sets no HSTS (left to the Vercel edge)',
    h.get('strict-transport-security') === null, String(h.get('strict-transport-security')));

  /* ============================================================ */
  console.log('\n== 2. an upload over the 4 MB multer cap -> 413 with the size message ==');
  await clearLimits();
  const big = await signupVerified(PLAIN, 'big');
  await clearLimits();
  const bigRes = await big.c.req('POST', '/api/upload', {
    form: blobForm(Buffer.alloc(5 * 1024 * 1024, 0x61), 'too-big.csv', 'text/csv'),
  });
  const bigBody = await bigRes.json();
  check('a ~5 MB upload -> HTTP 413 (not 500, not an opaque error)', bigRes.status === 413, `-> ${bigRes.status}`);
  check('the 413 body names the 4 MB limit',
    /maximum upload size is 4 MB/i.test(bigBody?.error || ''), JSON.stringify(bigBody));

  /* ============================================================ */
  console.log('\n== 3. fixture_rich_v2.xlsx ingests to the same standardized rows as the .csv ==');
  await clearLimits();
  const csvOrg = await signupVerified(PLAIN, 'csv');
  const xlsxOrg = await signupVerified(PLAIN, 'xlsx');
  await clearLimits();
  await csvOrg.c.req('POST', '/api/upload', {
    form: blobForm(readFileSync(`${ROOT}/data/fixture_rich_v2.csv`), 'fixture_rich_v2.csv', 'text/csv'),
  });
  await xlsxOrg.c.req('POST', '/api/upload', {
    form: blobForm(
      readFileSync(`${ROOT}/data/fixture_rich_v2.xlsx`),
      'fixture_rich_v2.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ),
  });
  const csvRows = (await (await csvOrg.c.req('GET', '/api/data')).json())?.rows || [];
  const xlsxRows = (await (await xlsxOrg.c.req('GET', '/api/data')).json())?.rows || [];
  check('the CSV upload produced standardized rows', csvRows.length > 0, `${csvRows.length} rows`);
  check('the XLSX upload produced the same row count', xlsxRows.length === csvRows.length,
    `csv=${csvRows.length} xlsx=${xlsxRows.length}`);
  check('every standardized value from the XLSX matches the CSV exactly',
    JSON.stringify(normRows(xlsxRows)) === JSON.stringify(normRows(csvRows)),
    `csv[0]=${JSON.stringify(normRows(csvRows)[0])}  xlsx[0]=${JSON.stringify(normRows(xlsxRows)[0])}`);

  /* ============================================================ */
  console.log('\n== 4. VERCEL=1 suppresses the `trace` key in the chat response ==');
  await clearLimits();
  const plainChatOrg = await signupVerified(PLAIN, 'trace-plain');
  const vercelChatOrg = await signupVerified(VERCEL_BASE, 'trace-vercel');
  await clearLimits();
  const plainChat = await (await plainChatOrg.c.req('POST', '/api/ascendai/chat', { body: { message: 'hi' } })).json();
  const vercelChat = await (await vercelChatOrg.c.req('POST', '/api/ascendai/chat', { body: { message: 'hi' } })).json();
  const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
  check('positive control: the non-Vercel backend DOES include `trace`', has(plainChat, 'trace'),
    JSON.stringify(Object.keys(plainChat || {})));
  check('VERCEL=1: the chat response has NO `trace` key', !has(vercelChat, 'trace'),
    JSON.stringify(Object.keys(vercelChat || {})));
  check('VERCEL=1: the response is otherwise the normal shape (ok + status + reply + reason)',
    vercelChat && vercelChat.ok === true && typeof vercelChat.status === 'string'
      && 'reply' in vercelChat && 'reason' in vercelChat,
    JSON.stringify(vercelChat));

  console.log(`\n${fail === 0 ? 'ALL PHASE 21 CHECKS PASSED' : `${fail} CHECK(S) FAILED`}`);
} finally {
  for (const p of procs) p.kill();
  await db.closeDb();
}
process.exit(fail === 0 ? 0 : 1);

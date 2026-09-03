/**
 * Serverless durability gate — the state that used to live in a per-process
 * Map (auth rate limiter, AscendAI daily cap, Phase 14b pending uploads) must
 * now be shared across function instances.
 *
 * Runs TWO backend processes against the SAME local Postgres and drives each
 * scenario across BOTH — the faithful local stand-in for Vercel routing
 * consecutive requests to different instances.
 *
 *   node scripts/serverless-durability-gate.mjs
 */

import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const db = require('../db');
const { hashHeaders } = require('../services/mapColumns');
const { ASCENDAI_DAILY_MESSAGE_LIMIT_PER_ORG } = require('../config/thresholds');

const ROOT = 'C:/Ascend-DataView';
const A = 'http://localhost:3101';
const B = 'http://localhost:3102';
// Pin BOTH spawned backends and this script to the local dev Postgres, so the
// cross-instance checks aren't split-brained by whatever DATABASE_URL is in
// backend/.env (e.g. a Supabase string). dotenv (override:false) yields to an
// already-set env var.
const LOCAL_PG = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5433/ascenddv';

let fail = 0;
const check = (label, cond, detail = '') => {
  if (!cond) fail += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealth(base, tries = 80) {
  for (let i = 0; i < tries; i += 1) {
    try {
      if ((await fetch(base + '/api/health')).ok) return;
    } catch { /* not up */ }
    await sleep(250);
  }
  throw new Error(`${base} never became healthy`);
}
function startBackend(port, extraEnv = {}) {
  return spawn(process.execPath, ['index.js'], {
    cwd: `${ROOT}/backend`,
    env: { ...process.env, PORT: String(port), DATABASE_URL: LOCAL_PG, HIBP_CHECK_ENABLED: '0', ...extraEnv },
    stdio: 'ignore',
  });
}

function makeClient(base) {
  let cookie = null;
  return {
    base,
    getCookie: () => cookie,
    setCookie: (c) => { cookie = c; },
    async req(m, p, { body, form } = {}) {
      const h = {};
      if (cookie) h.Cookie = cookie;
      let payload;
      if (form) payload = form;
      else if (body !== undefined) {
        h['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
      const r = await fetch(base + p, { method: m, headers: h, body: payload });
      const sc = r.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      return { status: r.status, headers: r.headers, json: async () => r.json().catch(() => null), buf: async () => Buffer.from(await r.arrayBuffer()) };
    },
  };
}
const fileForm = (f) => {
  const fd = new FormData();
  fd.append('file', new Blob([readFileSync(`${ROOT}/data/${f}`)], { type: 'text/csv' }), f);
  return fd;
};
async function signup(client, label) {
  const s = Date.now() + Math.floor(Math.random() * 1e5);
  const r = await client.req('POST', '/api/auth/signup', {
    body: { email: `sd_${label}_${s}@t.co`, password: 'ascend-gate-K7m2Qp-Zx9', orgName: `SD ${label} ${s}`, acceptTos: true },
  });
  const org = (await r.json()).org;
  // Phase 25: upload / chat require a verified email — this gate is about
  // cross-instance shared state, not verification, so mark it verified.
  await db.getDb().query('UPDATE users SET email_verified_at = now() WHERE org_id = $1', [org.id]);
  return { org, status: r.status };
}
const userIdForOrg = async (orgId) => {
  const { rows } = await db.getDb().query('SELECT id FROM users WHERE org_id = $1 ORDER BY id LIMIT 1', [orgId]);
  return rows[0].id;
};
const startOfUtcDayIso = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
};

const procs = [];
try {
  await db.initDb(); // apply pending migrations up front (each spawned backend also migrates on boot)
  await db.getDb().query("DELETE FROM rate_limits WHERE key LIKE 'auth:%'");

  procs.push(startBackend(3101));
  await waitHealth(A);
  procs.push(startBackend(3102, { VERCEL: '1' })); // B also exercises the serverless code paths
  await waitHealth(B);

  const ca = makeClient(A);
  const cb = makeClient(B);

  /* ============================================================ */
  console.log('\n== 1. auth rate limiter: shared count across instances ==');
  await db.getDb().query("DELETE FROM rate_limits WHERE key LIKE 'auth:%'");
  const results = [];
  for (let i = 0; i < 12; i += 1) {
    const client = i % 2 === 0 ? ca : cb; // alternate A / B
    const s = Date.now() + i;
    const r = await client.req('POST', '/api/auth/signup', {
      body: { email: `rl_${s}_${i}@t.co`, password: 'ascend-gate-K7m2Qp-Zx9', orgName: `RL ${s} ${i}`, acceptTos: true },
    });
    results.push({ i, instance: i % 2 === 0 ? 'A' : 'B', status: r.status });
  }
  const first10ok = results.slice(0, 10).every((r) => r.status !== 429);
  const n11 = results[10].status;
  const n12 = results[11].status;
  check('first 10 attempts (6 on A, ~5 on B, alternating) are NOT rate-limited', first10ok,
    results.slice(0, 10).map((r) => `${r.instance}:${r.status}`).join(' '));
  check('attempt 11 -> 429 even though its instance served only ~5 of them', n11 === 429,
    `attempt 11 on instance ${results[10].instance} -> ${n11}`);
  check('attempt 12 (other instance) -> 429 too', n12 === 429, `-> ${n12}`);
  const { rows: rlRows } = await db.getDb().query('SELECT max(hits) AS peak FROM rate_limits');
  check('the shared rate_limits row counted every one of the 12 attempts', Number(rlRows[0].peak) >= 12, `peak hits=${rlRows[0].peak}`);
  // reset so the rest of the gate can sign up from this same IP
  await db.getDb().query('DELETE FROM rate_limits');

  /* ============================================================ */
  console.log('\n== 2. AscendAI daily cap: instance B blocks on a count it never wrote ==');
  const orgA = (await signup(ca, 'aiA')).org;
  cb.setCookie(ca.getCookie()); // same signed session, now used against instance B
  const uid = await userIdForOrg(orgA.id);
  let used = await db.countAscendaiUsageSince(orgA.id, startOfUtcDayIso());
  for (; used < ASCENDAI_DAILY_MESSAGE_LIMIT_PER_ORG; used += 1) {
    await db.recordAscendaiUsage(orgA.id, uid, { status: 'seed', totalTokens: 0 });
  }
  // The chat request goes to instance B, which has served no chat turns for this org.
  const chat = await cb.req('POST', '/api/ascendai/chat', { body: { message: 'anything?' } });
  const cj = await chat.json();
  check('instance B returns HTTP 200 (not a raw error)', chat.status === 200);
  check('instance B returns status "rate_limited" from the shared ascendai_usage count',
    cj.status === 'rate_limited' && /message limit/i.test(cj.reply || ''), JSON.stringify(cj.status));

  /* ============================================================ */
  console.log('\n== 3. pending upload: stashed on A, confirmed on B ==');
  const orgP = (await signup(ca, 'pu')).org;
  cb.setCookie(ca.getCookie()); // same session; the confirm request will hit instance B
  const messyHeaders = readFileSync(`${ROOT}/data/fixture_messy.csv`, 'utf8').split('\n')[0].split(',').map((h) => h.trim());
  const hash = hashHeaders(messyHeaders);
  const seededMapping = {
    'Month': { field: 'period_date', confidence: 0.95, source: 'llm' },
    'Rev ($)': { field: 'revenue', confidence: 0.55, source: 'llm' },
    'Total Expenses': { field: 'expenses', confidence: 0.95, source: 'llm' },
    'Cash on Hand': { field: 'cash_balance', confidence: 0.95, source: 'llm' },
    'Other Income': { field: 'revenue_other', confidence: 0.6, source: 'llm' },
    'Total Donors': { field: 'donors_total', confidence: 0.95, source: 'llm' },
    'New Donors': { field: 'donors_new', confidence: 0.95, source: 'llm' },
  };
  await db.getDb().query(
    `INSERT INTO mapping_cache (org_id, header_hash, mapping_json) VALUES ($1,$2,$3)
     ON CONFLICT (org_id, header_hash) DO UPDATE SET mapping_json = EXCLUDED.mapping_json`,
    [orgP.id, hash, JSON.stringify(seededMapping)]
  );

  const up = await ca.req('POST', '/api/upload', { form: fileForm('fixture_messy.csv') });
  const uj = await up.json();
  check('upload to instance A pauses for confirmation and returns a pendingId',
    uj.needsConfirmation === true && typeof uj.pendingId === 'string', JSON.stringify({ nc: uj.needsConfirmation, id: !!uj.pendingId }));

  const confirm = await cb.req('POST', '/api/upload/confirm', {
    body: { pendingId: uj.pendingId, corrections: { 'Rev ($)': 'revenue', 'Other Income': 'revenue_other' } },
  });
  const cfj = await confirm.json();
  check('instance B finds the pending upload A stashed and completes it',
    confirm.status === 200 && cfj.ok === true && cfj.confirmedMappingApplied === true && cfj.periodsAdded > 0,
    JSON.stringify({ s: confirm.status, added: cfj.periodsAdded }));

  const reConfirm = await ca.req('POST', '/api/upload/confirm', { body: { pendingId: uj.pendingId, corrections: {} } });
  check('the pending upload is single-use across instances (re-confirm on A -> 404)', reConfirm.status === 404);

  const data = await cb.req('GET', '/api/data');
  check('the corrected rows are stored', (await data.json()).count > 0);

  /* ============================================================ */
  console.log('\n== 4. PDF export under the serverless code path (instance B, VERCEL=1) ==');
  const orgPdf = (await signup(cb, 'pdf')).org;
  await cb.req('POST', '/api/upload', { form: fileForm('fixture_rich_v2.csv') });
  const pdf = await cb.req('GET', '/api/report.pdf');
  const pbuf = await pdf.buf();
  check('GET /api/report.pdf -> a real PDF on the serverless-configured instance',
    pdf.status === 200 && (pdf.headers.get('content-type') || '').includes('application/pdf') &&
      pbuf.toString('latin1').startsWith('%PDF-') && pbuf.length > 3000,
    `${pdf.status} ${pdf.headers.get('content-type')} ${pbuf.length}b`);
  console.log('  (note: proves the pdfkit code path + serverless pool config; the bundling');
  console.log('   fix is vercel.json includeFiles — confirm with a live curl after deploy.)');

  console.log(`\n${fail === 0 ? 'ALL SERVERLESS-DURABILITY CHECKS PASSED' : `${fail} CHECK(S) FAILED`}`);
} finally {
  for (const p of procs) p.kill();
  await db.getDb().query("DELETE FROM rate_limits WHERE key LIKE 'auth:%'").catch(() => {});
  await db.closeDb();
}
process.exit(fail === 0 ? 0 : 1);

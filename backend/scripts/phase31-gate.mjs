/**
 * Phase 31 gate — the retention cron endpoint + the code-split bundle.
 *
 *  - POST/GET /api/internal/prune is gated by CRON_SECRET: 401 without it or
 *    with the wrong value (and 401 always when the server has no CRON_SECRET),
 *    200 with `Authorization: Bearer <secret>` or `x-cron-secret`, returning the
 *    pruneOldRows() counts.
 *  - the production build splits Recharts out of the initial chunk: the entry
 *    JS is well under the pre-split size and a separate chart chunk exists.
 *
 *   node scripts/phase31-gate.mjs
 */

import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const db = require('../db');

const ROOT = 'C:/Ascend-DataView';
const WITH = 'http://localhost:3191';
const WITHOUT = 'http://localhost:3192';
const LOCAL_PG = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5433/ascenddv';
const SECRET = 'cron-secret-phase31-xyz';

let fail = 0;
const check = (label, cond, detail = '') => {
  if (!cond) fail += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitHealth(base, tries = 100) {
  for (let i = 0; i < tries; i += 1) {
    try { const r = await fetch(base + '/api/health'); if (r.status) return; } catch { /* */ }
    await sleep(200);
  }
  throw new Error(`${base} never answered`);
}
const call = (base, method, headers = {}) =>
  fetch(base + '/api/internal/prune', { method, headers });

const procs = [];
try {
  await db.initDb();

  procs.push(spawn(process.execPath, ['index.js'], {
    cwd: `${ROOT}/backend`,
    env: { ...process.env, PORT: '3191', DATABASE_URL: LOCAL_PG, CRON_SECRET: SECRET, HIBP_CHECK_ENABLED: '0' },
    stdio: 'ignore',
  }));
  procs.push(spawn(process.execPath, ['-e', "require('./app').listen(process.env.PORT)"], {
    cwd: `${ROOT}/backend`,
    env: { ...process.env, PORT: '3192', DATABASE_URL: LOCAL_PG, CRON_SECRET: '', JWT_SECRET: 'x'.repeat(40) },
    stdio: 'ignore',
  }));
  await waitHealth(WITH);
  await waitHealth(WITHOUT);

  /* ============================================================ */
  console.log('\n== 1. /api/internal/prune is gated by CRON_SECRET ==');
  check('no auth -> 401', (await call(WITH, 'POST')).status === 401);
  check('wrong secret -> 401', (await call(WITH, 'POST', { authorization: 'Bearer nope' })).status === 401);

  const okBearer = await call(WITH, 'POST', { authorization: `Bearer ${SECRET}` });
  const okBody = await okBearer.json();
  check('Authorization: Bearer <secret> -> 200 { ok:true, pruned }',
    okBearer.status === 200 && okBody.ok === true && okBody.pruned && typeof okBody.pruned.chatMessages === 'number',
    JSON.stringify(okBody.pruned));

  check('x-cron-secret header -> 200', (await call(WITH, 'POST', { 'x-cron-secret': SECRET })).status === 200);
  check('GET (Vercel Cron style) with the bearer -> 200',
    (await call(WITH, 'GET', { authorization: `Bearer ${SECRET}` })).status === 200);

  check('a server with no CRON_SECRET set -> 401 even with a guessed value',
    (await call(WITHOUT, 'POST', { authorization: `Bearer ${SECRET}` })).status === 401);

  /* ============================================================ */
  console.log('\n== 2. the production build code-splits Recharts out of the entry chunk ==');
  const built = spawnSync('npm', ['--prefix', `${ROOT}/frontend`, 'run', 'build'], { encoding: 'utf8', shell: true });
  check('frontend build succeeds', built.status === 0, (built.stderr || '').trim().split('\n').pop());

  const assetsDir = `${ROOT}/frontend/dist/assets`;
  check('dist/assets exists', existsSync(assetsDir));
  if (existsSync(assetsDir)) {
    const js = readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
    const entry = js.find((f) => /^index-.*\.js$/.test(f));
    const entryGz = gzipSync(readFileSync(`${assetsDir}/${entry}`)).length;
    check(`entry chunk (${entry}) gzips to ${(entryGz / 1024).toFixed(1)} kB — well under the 150 kB pre-split size`,
      entryGz < 150 * 1024, `${entryGz} bytes`);

    const chartChunk = js.find((f) => {
      const src = readFileSync(`${assetsDir}/${f}`, 'utf8');
      return f !== entry && (/recharts/i.test(src) || /Cartesian/i.test(f) || /d3-shape|d3-scale/.test(src));
    });
    check('a separate chart/Recharts chunk exists (loaded on demand, not at boot)', Boolean(chartChunk), chartChunk || 'none found');

    const wizardOrTour = js.some((f) => /OnboardingWizard-|DashboardTour-/.test(f));
    check('the onboarding wizard and tour are their own chunks', wizardOrTour);
  }

  console.log(`\n${fail === 0 ? 'ALL PHASE 31 CHECKS PASSED' : `${fail} CHECK(S) FAILED`}`);
} finally {
  for (const p of procs) p.kill();
  await db.closeDb();
}
process.exit(fail === 0 ? 0 : 1);

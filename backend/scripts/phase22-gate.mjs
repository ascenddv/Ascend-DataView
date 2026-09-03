/**
 * Phase 22 gate — versioned migrations replace request-time DDL; FKs cascade.
 *   node scripts/phase22-gate.mjs
 *
 * Self-contained: creates a throwaway database on the local :5433 cluster,
 * migrates it from empty, verifies the full schema + idempotency + cascade
 * deletes + the checksum guard, spawns its OWN backend against the migrated DB
 * to prove no request-time DDL, then drops everything. Assumes nothing is
 * already running.
 */

import { spawn, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

const ROOT = 'C:/Ascend-DataView';

// The set of migrations on disk, in numeric order — the gate checks the ledger
// against this rather than a hardcoded list, so later phases don't break it.
const EXPECTED_MIGRATIONS = readdirSync(`${ROOT}/backend/db/migrations`)
  .filter((f) => /^\d+.*\.sql$/.test(f))
  .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  .map((f) => f.replace(/\.sql$/, ''));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GATE_PORT = 3125; // this gate spawns its own backend — never assumes :3001
const DBNAME = `ascenddv_mig_${Date.now()}`;

// Derive host + credentials from DATABASE_URL when present (CI's postgres
// service needs a password), else the local trust cluster on :5433.
function pgBase() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return 'postgresql://postgres@127.0.0.1:5433';
  const u = new URL(raw);
  const auth = u.username + (u.password ? `:${u.password}` : '');
  return `${u.protocol}//${auth}@${u.host}`;
}
const PG_BASE = pgBase();
const ADMIN = `${PG_BASE}/postgres`;
const TESTDB_URL = `${PG_BASE}/${DBNAME}`;

let fail = 0;
const check = (label, cond, detail = '') => {
  if (!cond) fail += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};
const runMigrate = () =>
  spawnSync(process.execPath, ['db/migrate.js'], {
    cwd: 'C:/Ascend-DataView/backend',
    env: { ...process.env, DATABASE_URL: TESTDB_URL },
    encoding: 'utf8',
  });

const admin = new Client({ connectionString: ADMIN });
let db;
let backend;
try {
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DBNAME}`);
  await admin.query(`CREATE DATABASE ${DBNAME}`);

  /* ---- 1. migrate an empty DB ---------------------------------------- */
  console.log('\n== migrate from empty ==');
  const first = runMigrate();
  check('first migrate exits 0', first.status === 0, first.stderr.trim());
  check('applied every migration on disk',
    EXPECTED_MIGRATIONS.every((v) => new RegExp(`applied ${v}`).test(first.stdout)),
    EXPECTED_MIGRATIONS.join(', '));

  db = new Client({ connectionString: TESTDB_URL });
  await db.connect();

  const tbl = async (n) =>
    (await db.query(`SELECT to_regclass($1) AS t`, [n])).rows[0].t !== null;
  for (const t of [
    'organizations', 'users', 'standardized_data', 'mapping_cache', 'chat_messages',
    'ascendai_usage', 'rate_limits', 'pending_uploads', 'schema_migrations',
  ]) {
    check(`table ${t} exists`, await tbl(t));
  }
  const { rows: idx } = await db.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public'`
  );
  const idxNames = idx.map((r) => r.indexname);
  for (const i of ['chat_messages_org_user_idx', 'ascendai_usage_org_time_idx', 'rate_limits_expires_idx', 'pending_uploads_created_idx']) {
    check(`index ${i} exists`, idxNames.includes(i));
  }
  const { rows: cons } = await db.query(`SELECT conname FROM pg_constraint`);
  const conNames = cons.map((r) => r.conname);
  check('mapping_cache_org_header_pk exists', conNames.includes('mapping_cache_org_header_pk'));
  check('standardized_data_org_period_uq exists', conNames.includes('standardized_data_org_period_uq'));

  const { rows: sm } = await db.query(`SELECT version FROM schema_migrations ORDER BY version`);
  check('schema_migrations records exactly the on-disk migrations',
    sm.map((r) => r.version).join(',') === EXPECTED_MIGRATIONS.join(','),
    sm.map((r) => r.version).join(','));

  const { rows: fks } = await db.query(`
    SELECT conname, confdeltype FROM pg_constraint
    WHERE contype='f' AND connamespace='public'::regnamespace`);
  const nonCascade = fks.filter((f) => f.confdeltype !== 'c');
  check('every foreign key is ON DELETE CASCADE', nonCascade.length === 0,
    nonCascade.map((f) => f.conname).join(', '));

  /* ---- 2. idempotent ---------------------------------------------- */
  console.log('\n== re-run is a no-op ==');
  const second = runMigrate();
  check('second migrate exits 0 and applies nothing',
    second.status === 0 && /up to date \(0 applied\)/.test(second.stdout));
  const { rows: sm2 } = await db.query(`SELECT count(*)::int n FROM schema_migrations`);
  check('schema_migrations row count is unchanged after a re-run',
    sm2[0].n === EXPECTED_MIGRATIONS.length, `n=${sm2[0].n}`);

  /* ---- 3. cascade delete ---------------------------------------- */
  console.log('\n== deleting an organization cascades away all its data ==');
  const mkOrg = async (name) => (await db.query(
    `INSERT INTO organizations (name) VALUES ($1) RETURNING id`, [name])).rows[0].id;
  const mkUser = async (org, email) => (await db.query(
    `INSERT INTO users (org_id, email, password_hash) VALUES ($1,$2,'x') RETURNING id`, [org, email])).rows[0].id;

  const orgA = await mkOrg('A');
  const userA = await mkUser(orgA, 'a@t.co');
  await db.query(`INSERT INTO standardized_data (org_id, period_date, revenue) VALUES ($1,'2025-01-31',100)`, [orgA]);
  await db.query(`INSERT INTO mapping_cache (org_id, header_hash, mapping_json) VALUES ($1,'h','{}')`, [orgA]);
  await db.query(`INSERT INTO chat_messages (org_id, user_id, role, content) VALUES ($1,$2,'user','hi')`, [orgA, userA]);
  await db.query(`INSERT INTO ascendai_usage (org_id, user_id, status) VALUES ($1,$2,'ok')`, [orgA, userA]);
  await db.query(`INSERT INTO pending_uploads (id, org_id, payload) VALUES (gen_random_uuid(),$1,'{}'::jsonb)`, [orgA]).catch(async () => {
    // gen_random_uuid needs pgcrypto on very old PG; fall back to a literal
    await db.query(`INSERT INTO pending_uploads (id, org_id, payload) VALUES ('00000000-0000-0000-0000-000000000001',$1,'{}'::jsonb)`, [orgA]);
  });

  const orgB = await mkOrg('B');
  const userB = await mkUser(orgB, 'b@t.co');
  await db.query(`INSERT INTO standardized_data (org_id, period_date, revenue) VALUES ($1,'2025-01-31',999)`, [orgB]);

  await db.query(`DELETE FROM organizations WHERE id = $1`, [orgA]);

  for (const t of ['users', 'standardized_data', 'mapping_cache', 'chat_messages', 'ascendai_usage', 'pending_uploads']) {
    const { rows } = await db.query(`SELECT count(*)::int n FROM ${t} WHERE org_id = $1`, [orgA]);
    check(`${t}: 0 rows left for the deleted org`, rows[0].n === 0, `n=${rows[0].n}`);
  }
  const { rows: bRows } = await db.query(`SELECT count(*)::int n FROM standardized_data WHERE org_id = $1`, [orgB]);
  check('the other org is untouched', bRows[0].n === 1);

  /* ---- 4. a backend against the migrated DB serves with no request-time DDL ---- */
  console.log('\n== a backend on the migrated DB needs no DDL at request time ==');
  backend = spawn(process.execPath, ['index.js'], {
    cwd: `${ROOT}/backend`,
    env: {
      ...process.env,
      PORT: String(GATE_PORT),
      DATABASE_URL: TESTDB_URL,
      JWT_SECRET: 'phase22-gate-secret-not-for-production-0000',
      HIBP_CHECK_ENABLED: '0',
    },
    stdio: 'ignore',
  });
  const gateBase = `http://localhost:${GATE_PORT}`;
  let up = false;
  for (let i = 0; i < 80 && !up; i += 1) {
    try { up = (await fetch(`${gateBase}/api/health`)).ok; } catch { /* not up */ }
    if (!up) await sleep(200);
  }
  const h = await fetch(`${gateBase}/api/health`).then((r) => r.status).catch(() => 0);
  const m = await fetch(`${gateBase}/api/metrics`).then((r) => r.status).catch(() => 0);
  check('spawned backend: /api/health 200 and /api/metrics 401 (SELECT 1 readiness, no DDL)',
    h === 200 && m === 401, `health ${h}, metrics ${m}`);

  /* ---- 5. checksum guard rejects a drifted already-applied migration ---- */
  console.log('\n== the checksum guard catches a modified applied migration ==');
  await db.query(`UPDATE schema_migrations SET checksum = 'tampered_${'0'.repeat(56)}' WHERE version = $1`,
    [EXPECTED_MIGRATIONS[0]]);
  const drifted = runMigrate();
  check('re-running migrate after a checksum was tampered -> non-zero exit',
    drifted.status !== 0, `status ${drifted.status}`);
  check('the error names the modified migration and refuses to proceed',
    /was modified after it was applied/.test(drifted.stderr) &&
      new RegExp(EXPECTED_MIGRATIONS[0]).test(drifted.stderr),
    (drifted.stderr || '').trim().split('\n')[0]);
} finally {
  try { if (backend) backend.kill(); } catch { /* */ }
  try { if (db) await db.end(); } catch { /* */ }
  try { await admin.query(`DROP DATABASE IF EXISTS ${DBNAME} WITH (FORCE)`); } catch { /* */ }
  await admin.end();
}

console.log(`\n${fail === 0 ? 'ALL PHASE 22 CHECKS PASSED' : `${fail} CHECK(S) FAILED`}`);
process.exit(fail === 0 ? 0 : 1);

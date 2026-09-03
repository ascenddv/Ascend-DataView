/**
 * Phase 22 gate — versioned migrations replace request-time DDL; FKs cascade.
 *   node scripts/phase22-gate.mjs [runningBackendBaseUrl]
 *
 * Spins a throwaway database on the local :5433 cluster, migrates it from empty,
 * verifies the full schema + idempotency + cascade deletes, then drops it.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

// The set of migrations on disk, in order — the gate checks the ledger against
// this rather than a hardcoded list, so later phases that add migrations don't
// break it.
const EXPECTED_MIGRATIONS = readdirSync('C:/Ascend-DataView/backend/db/migrations')
  .filter((f) => /^\d+.*\.sql$/.test(f))
  .sort()
  .map((f) => f.replace(/\.sql$/, ''));

const BASE = process.argv[2] || 'http://localhost:3001';
const ADMIN = 'postgresql://postgres@127.0.0.1:5433/postgres';
const DBNAME = `ascenddv_mig_${Date.now()}`;
const TESTDB_URL = `postgresql://postgres@127.0.0.1:5433/${DBNAME}`;

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

  /* ---- 4. running backend serves with no request-time DDL ---- */
  console.log('\n== the running backend needs no DDL at request time ==');
  const h = await fetch(`${BASE}/api/health`).then((r) => r.status).catch(() => 0);
  const m = await fetch(`${BASE}/api/metrics`).then((r) => r.status).catch(() => 0);
  check('/api/health 200 and /api/metrics 401 (SELECT 1 readiness reached, no DDL)', h === 200 && m === 401,
    `health ${h}, metrics ${m}`);
} finally {
  try { if (db) await db.end(); } catch { /* */ }
  try { await admin.query(`DROP DATABASE IF EXISTS ${DBNAME} WITH (FORCE)`); } catch { /* */ }
  await admin.end();
}

console.log(`\n${fail === 0 ? 'ALL PHASE 22 CHECKS PASSED' : `${fail} CHECK(S) FAILED`}`);
process.exit(fail === 0 ? 0 : 1);

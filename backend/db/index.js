/**
 * Postgres connection, schema bootstrap, and data-access helpers.
 *
 * Phase 7: storage engine SQLite -> Postgres (data helpers became async).
 * Phase 8: multi-tenancy. `organizations` + `users` tables; `standardized_data`
 * and `mapping_cache` gain a NOT NULL `org_id`. Every helper that reads or writes
 * tenant data takes `orgId` as its first argument and scopes the query by it —
 * middleware is not the only line of defence. A missing/blank `orgId` throws
 * before any SQL runs (CLAUDE.md: an unscoped tenant query is a gate-blocking bug).
 *
 * Table columns for `standardized_data` are still generated from the canonical
 * field dictionary so field names live in exactly one place (config/schema.js).
 */

const { Pool } = require('pg');

const { FIELDS, FIELD_NAMES, TYPE } = require('../config/schema');

const CONNECTION_STRING =
  process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5433/ascenddv';

const DB_PATH = CONNECTION_STRING; // kept as an export for backwards compat

const DEMO_ORG_NAME = 'Demo Nonprofit';

function sqlColumnType(field) {
  // period_date stays TEXT ('YYYY-MM-DD'); everything else DOUBLE PRECISION
  // (8-byte IEEE float, matching SQLite's REAL exactly).
  return field.type === TYPE.DATE ? 'TEXT' : 'DOUBLE PRECISION';
}

function buildStandardizedDataDDL() {
  const columns = FIELDS.map((f) => `  ${f.name} ${sqlColumnType(f)}`);
  return [
    'CREATE TABLE IF NOT EXISTS standardized_data (',
    '  id SERIAL PRIMARY KEY,',
    '  org_id INTEGER REFERENCES organizations(id),',
    columns.join(',\n') + ',',
    '  source_meta TEXT,',
    '  created_at TIMESTAMPTZ NOT NULL DEFAULT now()',
    ');',
  ].join('\n');
}

const ORGANIZATIONS_DDL = `
CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  org_type TEXT NOT NULL DEFAULT 'small_nonprofit',
  onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

const USERS_DDL = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

const MAPPING_CACHE_DDL = `
CREATE TABLE IF NOT EXISTS mapping_cache (
  org_id INTEGER REFERENCES organizations(id),
  header_hash TEXT NOT NULL,
  mapping_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

let pool;

function getDb() {
  if (pool) return pool;
  pool = new Pool({ connectionString: CONNECTION_STRING });
  // A pooled connection that dies while idle (DB restart, dropped network,
  // pg_terminate_backend) makes node-postgres emit 'error' on the Pool. With no
  // listener Node treats it as uncaught and crashes the process — outside any
  // request's try/catch. Swallow it: the broken client is discarded, the next
  // query gets a healthy one or fails inside a route's try/catch (clean 500).
  pool.on('error', (err) => {
    console.error('Postgres pool: idle client error —', err.message);
  });
  return pool;
}

async function closeDb() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

/**
 * Converge the schema to the current shape, whether starting from an empty DB
 * or from a Phase 7 (pre-tenancy) database. Every statement is idempotent.
 */
async function initDb() {
  const conn = getDb();

  await conn.query(ORGANIZATIONS_DDL);
  await conn.query(USERS_DDL);
  await conn.query(buildStandardizedDataDDL());
  await conn.query(MAPPING_CACHE_DDL);

  // Phase 17: onboarding flag on pre-existing organizations tables.
  await conn.query(
    "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false"
  );

  // Add any schema fields introduced since the table was created (CREATE TABLE
  // IF NOT EXISTS won't add columns to an existing table). Idempotent.
  for (const f of FIELDS) {
    await conn.query(
      `ALTER TABLE standardized_data ADD COLUMN IF NOT EXISTS ${f.name} ${sqlColumnType(f)}`
    );
  }

  // --- add org_id to pre-tenancy tables (no-op on a fresh DB) ---------------
  await conn.query('ALTER TABLE standardized_data ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id)');
  await conn.query('ALTER TABLE mapping_cache ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id)');

  // --- backfill any rows left without an org onto the Demo Nonprofit org ----
  const orphanData = await conn.query('SELECT 1 FROM standardized_data WHERE org_id IS NULL LIMIT 1');
  const orphanCache = await conn.query('SELECT 1 FROM mapping_cache WHERE org_id IS NULL LIMIT 1');
  if (orphanData.rowCount > 0 || orphanCache.rowCount > 0) {
    let { rows } = await conn.query('SELECT id FROM organizations WHERE name = $1', [DEMO_ORG_NAME]);
    if (rows.length === 0) {
      rows = (await conn.query('INSERT INTO organizations (name, org_type) VALUES ($1, $2) RETURNING id', [
        DEMO_ORG_NAME,
        'small_nonprofit',
      ])).rows;
    }
    const demoOrgId = rows[0].id;
    await conn.query('UPDATE standardized_data SET org_id = $1 WHERE org_id IS NULL', [demoOrgId]);
    await conn.query('UPDATE mapping_cache SET org_id = $1 WHERE org_id IS NULL', [demoOrgId]);
    console.log(`initDb: backfilled Stage 1 data onto "${DEMO_ORG_NAME}" (org ${demoOrgId})`);
  }

  // --- enforce NOT NULL once nothing is orphaned ---------------------------
  await conn.query('ALTER TABLE standardized_data ALTER COLUMN org_id SET NOT NULL');
  await conn.query('ALTER TABLE mapping_cache ALTER COLUMN org_id SET NOT NULL');

  // --- mapping_cache: composite (org_id, header_hash) primary key ----------
  // Two orgs with coincidentally identical header shapes must stay separate
  // cache entries (CLAUDE.md).
  await conn.query('ALTER TABLE mapping_cache DROP CONSTRAINT IF EXISTS mapping_cache_pkey');
  await conn.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'mapping_cache_org_header_pk'
      ) THEN
        ALTER TABLE mapping_cache ADD CONSTRAINT mapping_cache_org_header_pk PRIMARY KEY (org_id, header_hash);
      END IF;
    END $$;
  `);

  // --- standardized_data: one row per (org, period) ----------------------
  // Lets manual single-period entry upsert cleanly; the CSV/xlsx path already
  // de-dupes before storing so this never rejects a file import.
  await conn.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'standardized_data_org_period_uq'
      ) THEN
        ALTER TABLE standardized_data
          ADD CONSTRAINT standardized_data_org_period_uq UNIQUE (org_id, period_date);
      END IF;
    END $$;
  `);

  return conn;
}

/* -------------------------------------------------------------------------- */
/* org_id guard — an unscoped tenant query must never reach SQL               */
/* -------------------------------------------------------------------------- */

function assertOrgId(orgId, fnName) {
  if (!Number.isInteger(orgId) || orgId <= 0) {
    throw new Error(`${fnName}: a valid integer orgId is required (got ${JSON.stringify(orgId)})`);
  }
}

/* -------------------------------------------------------------------------- */
/* organizations / users                                                      */
/* -------------------------------------------------------------------------- */

async function createOrganization({ name, orgType = 'small_nonprofit' }) {
  const conn = getDb();
  const { rows } = await conn.query(
    'INSERT INTO organizations (name, org_type) VALUES ($1, $2) RETURNING id, name, org_type, onboarding_completed, created_at',
    [name, orgType]
  );
  return rows[0];
}

async function getOrganizationById(id) {
  const conn = getDb();
  const { rows } = await conn.query(
    'SELECT id, name, org_type, onboarding_completed, created_at FROM organizations WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

/** Phase 17: mark (or unmark) an org's first-run onboarding as done. */
async function setOnboardingCompleted(orgId, value = true) {
  assertOrgId(orgId, 'setOnboardingCompleted');
  const conn = getDb();
  const { rows } = await conn.query(
    'UPDATE organizations SET onboarding_completed = $2 WHERE id = $1 RETURNING onboarding_completed',
    [orgId, value === true]
  );
  return rows[0] ? rows[0].onboarding_completed : null;
}

async function createUser({ orgId, email, passwordHash, role = 'owner' }) {
  assertOrgId(orgId, 'createUser');
  const conn = getDb();
  const { rows } = await conn.query(
    `INSERT INTO users (org_id, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, org_id, email, role, created_at`,
    [orgId, email.toLowerCase(), passwordHash, role]
  );
  return rows[0];
}

/** Full row incl. password_hash — for login verification only. */
async function getUserByEmail(email) {
  const conn = getDb();
  const { rows } = await conn.query(
    'SELECT id, org_id, email, password_hash, role, created_at FROM users WHERE email = $1',
    [String(email || '').toLowerCase()]
  );
  return rows[0] || null;
}

async function getUserById(id) {
  const conn = getDb();
  const { rows } = await conn.query(
    'SELECT id, org_id, email, role, created_at FROM users WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

/* -------------------------------------------------------------------------- */
/* standardized_data — org-scoped                                             */
/* -------------------------------------------------------------------------- */

const STD_COLS = ['org_id', ...FIELD_NAMES, 'source_meta'];
const STD_PLACEHOLDERS = STD_COLS.map((_, i) => `$${i + 1}`).join(', ');
const STD_UPDATE_SET = [...FIELD_NAMES.filter((f) => f !== 'period_date'), 'source_meta']
  .map((c) => `${c} = EXCLUDED.${c}`)
  .join(', ');
const STD_UPSERT_SQL = `INSERT INTO standardized_data (${STD_COLS.join(', ')})
  VALUES (${STD_PLACEHOLDERS})
  ON CONFLICT (org_id, period_date) DO UPDATE SET ${STD_UPDATE_SET}`;

function stdRowValues(orgId, row) {
  return [
    orgId,
    ...FIELD_NAMES.map((name) => (row[name] === undefined ? null : row[name])),
    row.source_meta === undefined || row.source_meta === null
      ? null
      : JSON.stringify(row.source_meta),
  ];
}

/**
 * Merge a batch of standardized rows into an org's history (Phase 13): a period
 * already present is overwritten, a new one is added. NEVER deletes — a full
 * wipe only happens through deleteStandardizedData (the explicit reset action).
 * @returns {{ periodsAdded: number, periodsUpdated: number }}
 */
async function mergeStandardizedData(orgId, rows) {
  assertOrgId(orgId, 'mergeStandardizedData');
  const conn = getDb();
  const client = await conn.connect();
  try {
    await client.query('BEGIN');

    const { rows: existing } = await client.query(
      'SELECT period_date FROM standardized_data WHERE org_id = $1',
      [orgId]
    );
    const present = new Set(existing.map((r) => r.period_date));

    let periodsAdded = 0;
    let periodsUpdated = 0;
    for (const row of rows) {
      if (present.has(row.period_date)) periodsUpdated += 1;
      else {
        periodsAdded += 1;
        present.add(row.period_date); // guard against a dup within this same batch
      }
      await client.query(STD_UPSERT_SQL, stdRowValues(orgId, row));
    }

    await client.query('COMMIT');
    return { periodsAdded, periodsUpdated };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Insert or update a single period's row for an org (manual entry). Upserts on
 * the (org_id, period_date) unique constraint so re-entering a period edits it.
 * @returns {{ inserted: boolean }} — true if this was a new period
 */
async function upsertStandardizedRow(orgId, row) {
  assertOrgId(orgId, 'upsertStandardizedRow');
  const conn = getDb();
  const { rows } = await conn.query(
    `${STD_UPSERT_SQL} RETURNING (xmax = 0) AS inserted`,
    stdRowValues(orgId, row)
  );
  return { inserted: rows[0]?.inserted === true };
}

/**
 * The explicit, destructive reset (Phase 13). Wipes ONLY this org's rows.
 * @returns {number} rows deleted
 */
async function deleteStandardizedData(orgId) {
  assertOrgId(orgId, 'deleteStandardizedData');
  const conn = getDb();
  const { rowCount } = await conn.query(
    'DELETE FROM standardized_data WHERE org_id = $1',
    [orgId]
  );
  return rowCount;
}

async function getStandardizedData(orgId) {
  assertOrgId(orgId, 'getStandardizedData');
  const conn = getDb();
  const { rows } = await conn.query(
    `SELECT ${FIELD_NAMES.join(', ')}, source_meta
     FROM standardized_data
     WHERE org_id = $1
     ORDER BY period_date ASC`,
    [orgId]
  );
  return rows.map((r) => ({
    ...r,
    source_meta: r.source_meta ? JSON.parse(r.source_meta) : null,
  }));
}

/* -------------------------------------------------------------------------- */
/* mapping_cache — org-scoped (no cross-org sharing, even on identical headers)*/
/* -------------------------------------------------------------------------- */

async function getCachedMapping(orgId, headerHash) {
  assertOrgId(orgId, 'getCachedMapping');
  const conn = getDb();
  const { rows } = await conn.query(
    'SELECT mapping_json FROM mapping_cache WHERE org_id = $1 AND header_hash = $2',
    [orgId, headerHash]
  );
  return rows[0] ? JSON.parse(rows[0].mapping_json) : null;
}

async function putCachedMapping(orgId, headerHash, mapping) {
  assertOrgId(orgId, 'putCachedMapping');
  const conn = getDb();
  await conn.query(
    `INSERT INTO mapping_cache (org_id, header_hash, mapping_json)
     VALUES ($1, $2, $3)
     ON CONFLICT (org_id, header_hash) DO UPDATE SET mapping_json = EXCLUDED.mapping_json`,
    [orgId, headerHash, JSON.stringify(mapping)]
  );
}

module.exports = {
  getDb,
  initDb,
  closeDb,
  DB_PATH,
  DEMO_ORG_NAME,
  buildStandardizedDataDDL,
  createOrganization,
  getOrganizationById,
  setOnboardingCompleted,
  createUser,
  getUserByEmail,
  getUserById,
  mergeStandardizedData,
  upsertStandardizedRow,
  deleteStandardizedData,
  getStandardizedData,
  getCachedMapping,
  putCachedMapping,
};

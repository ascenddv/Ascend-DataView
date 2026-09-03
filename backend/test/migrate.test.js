/**
 * db/migrate.js — the migration runner, with the pool stubbed (no live DB).
 * Verifies: creates schema_migrations, applies only unapplied files in order,
 * each in its own transaction, records the version, is idempotent, and the
 * drift guard fires when standardized_data is missing a canonical field.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { FIELD_NAMES } = require('../config/schema');

const MIGRATION_FILES = fs
  .readdirSync(path.join(__dirname, '..', 'db', 'migrations'))
  .filter((f) => /^\d+.*\.sql$/.test(f))
  .sort()
  .map((f) => f.replace(/\.sql$/, ''));

/** Build a fake `getDb()` pool. `applied` = versions already in schema_migrations. */
function fakePool({ applied = [], columns = FIELD_NAMES }) {
  const log = { pool: [], client: [], txns: [] };
  const answer = (sql) => {
    if (/FROM schema_migrations/i.test(sql)) return { rows: applied.map((v) => ({ version: v })) };
    if (/information_schema\.columns/i.test(sql)) return { rows: columns.map((c) => ({ column_name: c })) };
    return { rows: [], rowCount: 0 };
  };
  let openTxn = null;
  const client = {
    query: async (sql) => {
      log.client.push(sql.trim().split('\n')[0].slice(0, 40));
      if (/^BEGIN/i.test(sql)) openTxn = [];
      else if (/^COMMIT/i.test(sql)) { log.txns.push({ committed: true, sql: openTxn }); openTxn = null; }
      else if (/^ROLLBACK/i.test(sql)) { log.txns.push({ committed: false, sql: openTxn }); openTxn = null; }
      else if (openTxn) openTxn.push(sql.trim().split('\n')[0].slice(0, 40));
      return answer(sql);
    },
    release: () => {},
  };
  const pool = {
    query: async (sql) => { log.pool.push(sql.trim().split('\n')[0].slice(0, 50)); return answer(sql); },
    connect: async () => client,
  };
  return { pool, log };
}

function loadMigrateWith(pool) {
  const idPath = require.resolve('../db/index');
  require.cache[idPath] = {
    id: idPath, filename: idPath, loaded: true, children: [], paths: [],
    exports: { getDb: () => pool },
  };
  delete require.cache[require.resolve('../db/migrate')];
  return require('../db/migrate').migrate;
}

test('a fresh database applies every migration, in order, each in a transaction', async () => {
  const { pool, log } = fakePool({ applied: [] });
  const migrate = loadMigrateWith(pool);
  const count = await migrate({ log: () => {} });

  assert.equal(count, MIGRATION_FILES.length);
  assert.ok(log.pool.some((s) => /CREATE TABLE IF NOT EXISTS\s*\n?\s*schema_migrations/i.test(s) || /schema_migrations/i.test(s)));
  // one committed transaction per migration, each ending with the version INSERT
  const committed = log.txns.filter((t) => t.committed);
  assert.equal(committed.length, MIGRATION_FILES.length);
  for (const t of committed) {
    assert.ok(t.sql.at(-1).startsWith('INSERT INTO schema_migrations'));
  }
});

test('an already-applied migration is skipped', async () => {
  const { pool } = fakePool({ applied: [MIGRATION_FILES[0]] });
  const migrate = loadMigrateWith(pool);
  const count = await migrate({ log: () => {} });
  assert.equal(count, MIGRATION_FILES.length - 1);
});

test('nothing to do -> 0 applied', async () => {
  const { pool } = fakePool({ applied: MIGRATION_FILES });
  const migrate = loadMigrateWith(pool);
  assert.equal(await migrate({ log: () => {} }), 0);
});

test('drift guard: a canonical field missing from standardized_data throws', async () => {
  const { pool } = fakePool({ applied: MIGRATION_FILES, columns: FIELD_NAMES.filter((f) => f !== 'revenue') });
  const migrate = loadMigrateWith(pool);
  await assert.rejects(migrate({ log: () => {} }), /missing column\(s\) \[revenue\].*needs its own migration/s);
});

test('drift guard passes when every field column is present', async () => {
  const { pool } = fakePool({ applied: MIGRATION_FILES, columns: [...FIELD_NAMES, 'id', 'org_id', 'source_meta', 'created_at'] });
  const migrate = loadMigrateWith(pool);
  await assert.doesNotReject(migrate({ log: () => {} }));
});

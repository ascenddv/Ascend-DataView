/**
 * db/migrate.js — the migration runner, with the pool stubbed (no live DB).
 * Verifies: creates schema_migrations, applies only unapplied files in numeric
 * order, each in its own transaction, records version + checksum, is idempotent,
 * rolls back and aborts on a failing migration, and the checksum guard rejects
 * an already-applied migration whose file was edited afterwards.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { FIELD_NAMES } = require('../config/schema');
const { checksumOf } = require('../db/migrate');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');
const MIGRATION_FILES = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^\d+.*\.sql$/.test(f))
  .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  .map((f) => f.replace(/\.sql$/, ''));

const realChecksum = (version) =>
  checksumOf(fs.readFileSync(path.join(MIGRATIONS_DIR, `${version}.sql`), 'utf8'));

/**
 * Fake `getDb()` pool.
 *   applied  — versions already in schema_migrations. String -> {version, checksum:null};
 *              or pass {version, checksum} objects directly.
 *   columns  — what information_schema.columns reports for standardized_data.
 *   failOn   — RegExp; a migration-body query matching it rejects (to test rollback).
 */
function fakePool({ applied = [], columns = FIELD_NAMES, failOn = null } = {}) {
  const rows = applied.map((a) => (typeof a === 'string' ? { version: a, checksum: null } : a));
  const log = { pool: [], client: [], txns: [] };
  const answer = (sql) => {
    if (/FROM schema_migrations/i.test(sql)) return { rows };
    if (/information_schema\.columns/i.test(sql)) return { rows: columns.map((c) => ({ column_name: c })) };
    return { rows: [], rowCount: 0 };
  };
  const isControl = (sql) =>
    /^(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql) || /INSERT INTO schema_migrations/i.test(sql);
  let openTxn = null;
  const client = {
    query: async (sql) => {
      const head = sql.trim().split('\n')[0].slice(0, 48);
      log.client.push(head);
      if (failOn && failOn.test(sql) && !isControl(sql)) throw new Error('boom in migration body');
      if (/^BEGIN/i.test(sql)) openTxn = [];
      else if (/^COMMIT/i.test(sql)) { log.txns.push({ committed: true, sql: openTxn }); openTxn = null; }
      else if (/^ROLLBACK/i.test(sql)) { log.txns.push({ committed: false, sql: openTxn }); openTxn = null; }
      else if (openTxn) openTxn.push(head);
      return answer(sql);
    },
    release: () => {},
  };
  const pool = {
    query: async (sql) => { log.pool.push(sql.trim().split('\n')[0].slice(0, 60)); return answer(sql); },
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

test('a fresh database applies every migration, in order, each in a transaction, recording version + checksum', async () => {
  const { pool, log } = fakePool({ applied: [] });
  const migrate = loadMigrateWith(pool);
  const count = await migrate({ log: () => {} });

  assert.equal(count, MIGRATION_FILES.length);
  assert.ok(log.pool.some((s) => /schema_migrations/i.test(s)));
  assert.ok(log.pool.some((s) => /ALTER TABLE schema_migrations ADD COLUMN/i.test(s)), 'adds the checksum column');

  const committed = log.txns.filter((t) => t.committed);
  assert.equal(committed.length, MIGRATION_FILES.length);
  for (const t of committed) {
    assert.ok(t.sql.at(-1).startsWith('INSERT INTO schema_migrations'));
  }
});

test('an already-applied migration is skipped', async () => {
  const { pool } = fakePool({ applied: [{ version: MIGRATION_FILES[0], checksum: realChecksum(MIGRATION_FILES[0]) }] });
  const migrate = loadMigrateWith(pool);
  assert.equal(await migrate({ log: () => {} }), MIGRATION_FILES.length - 1);
});

test('nothing to do -> 0 applied', async () => {
  const all = MIGRATION_FILES.map((v) => ({ version: v, checksum: realChecksum(v) }));
  const { pool } = fakePool({ applied: all });
  const migrate = loadMigrateWith(pool);
  assert.equal(await migrate({ log: () => {} }), 0);
});

test('checksum guard: an already-applied migration whose file was edited afterwards -> hard error', async () => {
  const all = MIGRATION_FILES.map((v) => ({ version: v, checksum: realChecksum(v) }));
  all[0].checksum = 'a'.repeat(64); // pretend 001 was applied with different content
  const { pool } = fakePool({ applied: all });
  const migrate = loadMigrateWith(pool);
  await assert.rejects(
    migrate({ log: () => {} }),
    /was modified after it was applied.*Never edit an applied migration/s
  );
});

test('checksum guard: a matching checksum passes cleanly', async () => {
  const all = MIGRATION_FILES.map((v) => ({ version: v, checksum: realChecksum(v) }));
  const { pool } = fakePool({ applied: all });
  const migrate = loadMigrateWith(pool);
  await assert.doesNotReject(migrate({ log: () => {} }));
});

test('checksum backfill: a pre-checksum row (checksum NULL) is recorded, not rejected', async () => {
  const all = MIGRATION_FILES.map((v) => ({ version: v, checksum: null }));
  const { pool, log } = fakePool({ applied: all });
  const migrate = loadMigrateWith(pool);
  await assert.doesNotReject(migrate({ log: () => {} }));
  assert.ok(
    log.pool.some((s) => /UPDATE schema_migrations SET checksum/i.test(s)),
    'a NULL checksum is back-filled with the current file content'
  );
});

test('rollback on failure: a migration that errors mid-file is ROLLED BACK, aborts the run, records nothing', async () => {
  // fail inside 003's body (its content contains "token_version")
  const { pool, log } = fakePool({ applied: [], failOn: /token_version/ });
  const migrate = loadMigrateWith(pool);

  await assert.rejects(migrate({ log: () => {} }), /migration 003_token_version failed: boom in migration body/);

  const committed = log.txns.filter((t) => t.committed);
  const rolledBack = log.txns.filter((t) => !t.committed);
  assert.equal(committed.length, 2, '001 and 002 committed before the failure');
  assert.equal(rolledBack.length, 1, '003 was rolled back, not committed');
  // exactly two version rows were ever inserted (001, 002) — the failing one left none
  const inserts = log.client.filter((s) => /INSERT INTO schema_migrations/i.test(s)).length;
  assert.equal(inserts, 2, 'the failing migration recorded no schema_migrations row');
});

test('drift guard: a canonical field missing from standardized_data throws', async () => {
  const all = MIGRATION_FILES.map((v) => ({ version: v, checksum: realChecksum(v) }));
  const { pool } = fakePool({ applied: all, columns: FIELD_NAMES.filter((f) => f !== 'revenue') });
  const migrate = loadMigrateWith(pool);
  await assert.rejects(migrate({ log: () => {} }), /missing column\(s\) \[revenue\].*needs its own migration/s);
});

test('drift guard passes when every field column is present', async () => {
  const all = MIGRATION_FILES.map((v) => ({ version: v, checksum: realChecksum(v) }));
  const { pool } = fakePool({ applied: all, columns: [...FIELD_NAMES, 'id', 'org_id', 'source_meta', 'created_at'] });
  const migrate = loadMigrateWith(pool);
  await assert.doesNotReject(migrate({ log: () => {} }));
});

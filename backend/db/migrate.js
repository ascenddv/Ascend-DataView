/**
 * Migration runner. Applies every `backend/db/migrations/NNN_*.sql` not yet in
 * `schema_migrations`, in numeric filename order, each in its own transaction.
 *
 *   npm run migrate            (local — loads ../../.env)
 *   node db/migrate.js         (same)
 *   require('./migrate').migrate()   (from code — dotenv already loaded)
 *
 * Idempotent: a second run applies nothing. NOT run at request time (see
 * backend/app.js) — run it as a deploy step against the production database.
 *
 * Each applied migration's SHA-256 (over LF-normalised content) is stored in
 * `schema_migrations.checksum`. On every run, an already-applied migration whose
 * file no longer matches its recorded checksum is a hard error — you must never
 * edit an applied migration; add a new numbered file instead. Rows applied
 * before checksums existed are back-filled once with their current content as
 * the baseline (pre-existing drift cannot be recovered — that is why the column
 * exists from the start).
 *
 * Known limitations (deliberate, not bugs):
 *   - Every migration runs inside BEGIN/COMMIT, so statements that cannot run in
 *     a transaction block (CREATE INDEX CONCURRENTLY, VACUUM, …) are not
 *     supported. Add an out-of-band step if you ever need one.
 *   - Forward-only: there are no down migrations. Fix a bad migration with a new
 *     one.
 */

if (require.main === module) {
  // eslint-disable-next-line global-require
  require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
}

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FIELD_NAMES } = require('../config/schema');
const { getDb } = require('./index');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/** SHA-256 over LF-normalised content, so CRLF checkouts hash the same as CI. */
function checksumOf(sql) {
  return crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

async function migrate({ log = console.log } = {}) {
  const conn = getDb();

  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await conn.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT');

  const { rows: appliedRows } = await conn.query('SELECT version, checksum FROM schema_migrations');
  const appliedChecksum = new Map(appliedRows.map((r) => [r.version, r.checksum]));

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+.*\.sql$/.test(f))
    // numeric-aware: "010_x" sorts after "009_x", and "2_x" would not jump ahead
    // of "10_x" the way a plain lexical sort makes it.
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  let count = 0;
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const checksum = checksumOf(sql);

    if (appliedChecksum.has(version)) {
      const stored = appliedChecksum.get(version);
      if (stored == null) {
        await conn.query('UPDATE schema_migrations SET checksum = $2 WHERE version = $1', [version, checksum]);
        log(`migrate: recorded checksum for previously-applied ${version}`);
      } else if (stored !== checksum) {
        throw new Error(
          `migration ${version} was modified after it was applied ` +
            `(checksum ${stored.slice(0, 12)}… on record, ${checksum.slice(0, 12)}… on disk). ` +
            'Never edit an applied migration — add a new NNN_*.sql instead.'
        );
      }
      continue;
    }

    const client = await conn.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [version, checksum]);
      await client.query('COMMIT');
      log(`migrate: applied ${version}`);
      count += 1;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`migration ${version} failed: ${err.message}`);
    } finally {
      client.release();
    }
  }

  if (count === 0) log('migrate: schema is up to date (0 applied)');

  // Drift guard: standardized_data must carry every canonical field column.
  // Catches "added a field to config/schema.js but forgot the migration".
  // (Presence only — it does not check column types; that is a known limitation.)
  const { rows: cols } = await conn.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'standardized_data'`
  );
  const have = new Set(cols.map((c) => c.column_name));
  const missing = FIELD_NAMES.filter((f) => !have.has(f));
  if (missing.length) {
    throw new Error(
      `standardized_data is missing column(s) [${missing.join(', ')}] — ` +
        'a config/schema.js field needs its own migration.'
    );
  }

  return count;
}

module.exports = { migrate, checksumOf };

if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}

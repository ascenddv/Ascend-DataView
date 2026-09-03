/**
 * Migration runner. Applies every `backend/db/migrations/NNN_*.sql` not yet in
 * `schema_migrations`, in filename order, each in its own transaction.
 *
 *   npm run migrate            (local — loads ../../.env)
 *   node db/migrate.js         (same)
 *   require('./migrate').migrate()   (from code — dotenv already loaded)
 *
 * Idempotent: a second run applies nothing. NOT run at request time (see
 * backend/app.js) — run it as a deploy step against the production database.
 */

if (require.main === module) {
  // eslint-disable-next-line global-require
  require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
}

const fs = require('fs');
const path = require('path');
const { FIELD_NAMES } = require('../config/schema');
const { getDb } = require('./index');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function migrate({ log = console.log } = {}) {
  const conn = getDb();

  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows: appliedRows } = await conn.query('SELECT version FROM schema_migrations');
  const applied = new Set(appliedRows.map((r) => r.version));

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort();

  let count = 0;
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await conn.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
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

module.exports = { migrate };

if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}

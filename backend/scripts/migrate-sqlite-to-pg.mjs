/**
 * One-time Phase 7 migration: copy every row from the Stage 1 SQLite database
 * into Postgres verbatim, so the exact same records exist in the new store and
 * remain a regression baseline.
 *
 *   node scripts/migrate-sqlite-to-pg.mjs [path-to-sqlite-file]
 *
 * Idempotent-ish: it TRUNCATEs both target tables first, then re-inserts.
 * standardized_data.id is not preserved (SERIAL, opaque, never returned by the
 * API); everything else — including source_meta and created_at — is copied as-is.
 */

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
require('dotenv').config({ path: path.join(fileURLToPath(new URL('..', import.meta.url)), '..', '.env') });

const Database = require('better-sqlite3');
const { initDb, getDb, closeDb } = require('../db/index.js');
const { FIELD_NAMES } = require('../config/schema.js');

const sqlitePath =
  process.argv[2] ||
  path.join(fileURLToPath(new URL('..', import.meta.url)), 'db', 'ascenddv.sqlite');

if (!existsSync(sqlitePath)) {
  console.error(`SQLite file not found: ${sqlitePath}`);
  process.exit(1);
}

const sqlite = new Database(sqlitePath, { readonly: true });

const stdRows = sqlite.prepare(`SELECT ${FIELD_NAMES.join(', ')}, source_meta, created_at FROM standardized_data`).all();
const cacheRows = sqlite.prepare('SELECT header_hash, mapping_json, created_at FROM mapping_cache').all();
sqlite.close();

console.log(`SQLite source: ${sqlitePath}`);
console.log(`  standardized_data: ${stdRows.length} rows`);
console.log(`  mapping_cache:     ${cacheRows.length} rows`);

await initDb();
const pool = getDb();
const client = await pool.connect();

try {
  await client.query('BEGIN');
  await client.query('TRUNCATE standardized_data RESTART IDENTITY');
  await client.query('TRUNCATE mapping_cache');

  const stdCols = [...FIELD_NAMES, 'source_meta', 'created_at'];
  const stdPlaceholders = stdCols.map((_, i) => `$${i + 1}`).join(', ');
  const stdSql = `INSERT INTO standardized_data (${stdCols.join(', ')}) VALUES (${stdPlaceholders})`;
  for (const r of stdRows) {
    const values = stdCols.map((c) => (r[c] === undefined ? null : r[c]));
    await client.query(stdSql, values);
  }

  for (const r of cacheRows) {
    await client.query(
      `INSERT INTO mapping_cache (header_hash, mapping_json, created_at) VALUES ($1, $2, $3)
       ON CONFLICT (header_hash) DO UPDATE SET mapping_json = EXCLUDED.mapping_json`,
      [r.header_hash, r.mapping_json, r.created_at]
    );
  }

  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
}

const { rows: stdCount } = await pool.query('SELECT count(*)::int AS n FROM standardized_data');
const { rows: cacheCount } = await pool.query('SELECT count(*)::int AS n FROM mapping_cache');
console.log(`Postgres now holds:`);
console.log(`  standardized_data: ${stdCount[0].n} rows`);
console.log(`  mapping_cache:     ${cacheCount[0].n} rows`);

await closeDb();
console.log('Migration complete.');

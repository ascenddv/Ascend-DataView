/**
 * SQLite connection and schema bootstrap.
 *
 * The `standardized_data` table columns are generated from the canonical field
 * dictionary so that field names live in exactly one place (config/schema.js).
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const { FIELDS, TYPE } = require('../config/schema');

const DB_DIR = path.join(__dirname);
const DB_PATH = process.env.ASCENDDV_DB_PATH || path.join(DB_DIR, 'ascenddv.sqlite');

function sqlColumnType(field) {
  // Dates are stored as ISO-8601 `YYYY-MM-DD` strings; everything else numeric.
  return field.type === TYPE.DATE ? 'TEXT' : 'REAL';
}

function buildStandardizedDataDDL() {
  const columns = FIELDS.map((f) => `  ${f.name} ${sqlColumnType(f)}`);
  return [
    'CREATE TABLE IF NOT EXISTS standardized_data (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    columns.join(',\n') + ',',
    '  source_meta TEXT,', // JSON: original source + per-row mapping confidence
    "  created_at TEXT NOT NULL DEFAULT (datetime('now'))",
    ');',
  ].join('\n');
}

const MAPPING_CACHE_DDL = `
CREATE TABLE IF NOT EXISTS mapping_cache (
  header_hash TEXT PRIMARY KEY,
  mapping_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

let db;

function getDb() {
  if (db) return db;

  fs.mkdirSync(DB_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(buildStandardizedDataDDL());
  db.exec(MAPPING_CACHE_DDL);

  return db;
}

module.exports = { getDb, DB_PATH, buildStandardizedDataDDL };

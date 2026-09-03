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

const crypto = require('crypto');
const { Pool } = require('pg');

const { FIELD_NAMES } = require('../config/schema');
const {
  CHAT_MESSAGE_STORED_MAX_CHARS,
  PENDING_UPLOAD_MAX_BYTES,
  CHAT_MESSAGE_RETENTION_DAYS,
  ASCENDAI_USAGE_RETENTION_DAYS,
  AUTH_TOKEN_RETENTION_DAYS,
} = require('../config/thresholds');

/**
 * Normalise a connection string pasted into an env var: drop a stray `psql `
 * prefix, surrounding quotes, and ALL whitespace (a URL-form connection string
 * has none — a space usually means the value got line-wrapped on paste).
 */
function cleanConnectionString(raw) {
  if (!raw) return '';
  let s = String(raw).trim().replace(/^psql\s+/i, '').trim();
  if (s.length >= 2 && ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'"))) {
    s = s.slice(1, -1);
  }
  return s.replace(/\s+/g, '');
}

const CONNECTION_STRING =
  cleanConnectionString(process.env.DATABASE_URL) ||
  cleanConnectionString(process.env.POSTGRES_URL) || // set by the Vercel Postgres integration
  'postgresql://postgres@127.0.0.1:5433/ascenddv';

const DB_PATH = CONNECTION_STRING; // kept as an export for backwards compat

// mirrors services/pendingUploads.js TTL_MS and the interval in 001_init.sql
const PENDING_UPLOAD_TTL = '15 minutes';

let pool;

// A hosted Postgres (Neon / Supabase / Vercel Postgres / RDS) needs TLS; the
// local dev cluster on 127.0.0.1 does not. In a serverless runtime keep the
// pool tiny — each concurrent invocation is its own process.
const IS_LOCAL_DB = /(^|@)(localhost|127\.0\.0\.1)[:/]/.test(CONNECTION_STRING);
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

function poolConfig() {
  const cfg = { connectionString: CONNECTION_STRING };
  if (!IS_LOCAL_DB) cfg.ssl = { rejectUnauthorized: false };
  if (IS_SERVERLESS) {
    cfg.max = 2;
    cfg.idleTimeoutMillis = 10000;
    cfg.connectionTimeoutMillis = 10000;
  }
  return cfg;
}

function getDb() {
  if (pool) return pool;

  // Fail with an actionable message instead of a bare "Invalid URL" from deep in pg.
  try {
    new URL(CONNECTION_STRING); // eslint-disable-line no-new
  } catch {
    throw new Error(
      'The database connection string (DATABASE_URL) is malformed. Check for an unreplaced ' +
        '[YOUR-PASSWORD] placeholder, unescaped special characters in the password (URL-encode ' +
        '@ # ? / & =), or surrounding quotes. Expected: postgresql://user:password@host:5432/dbname'
    );
  }

  pool = new Pool(poolConfig());
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
 * Apply any pending SQL migrations (backend/db/migrations). Kept under the old
 * name so existing callers (backend/index.js, the gate scripts) are unchanged.
 * NOT run at request time — see backend/app.js. `require` is lazy to avoid a
 * circular dependency with ./migrate.
 */
async function initDb(opts) {
  // eslint-disable-next-line global-require
  return require('./migrate').migrate(opts);
}

/**
 * Retention prune (wired to a cron in Phase 31). Also opportunistically clears
 * expired pending uploads. Returns the row counts removed.
 */
async function pruneOldRows() {
  const conn = getDb();
  const chat = await conn.query(
    `DELETE FROM chat_messages WHERE created_at < now() - ($1 || ' days')::interval`,
    [CHAT_MESSAGE_RETENTION_DAYS]
  );
  const usage = await conn.query(
    `DELETE FROM ascendai_usage WHERE created_at < now() - ($1 || ' days')::interval`,
    [ASCENDAI_USAGE_RETENTION_DAYS]
  );
  const pending = await conn.query(
    `DELETE FROM pending_uploads WHERE created_at < now() - interval '${PENDING_UPLOAD_TTL}'`
  );
  const verifications = await conn.query(
    `DELETE FROM email_verifications WHERE created_at < now() - ($1 || ' days')::interval`,
    [AUTH_TOKEN_RETENTION_DAYS]
  );
  const resets = await conn.query(
    `DELETE FROM password_resets WHERE created_at < now() - ($1 || ' days')::interval`,
    [AUTH_TOKEN_RETENTION_DAYS]
  );
  const invites = await conn.query(
    `DELETE FROM invitations
      WHERE accepted_at IS NOT NULL
         OR expires_at < now() - ($1 || ' days')::interval`,
    [AUTH_TOKEN_RETENTION_DAYS]
  );
  return {
    chatMessages: chat.rowCount,
    ascendaiUsage: usage.rowCount,
    pendingUploads: pending.rowCount,
    emailVerifications: verifications.rowCount,
    passwordResets: resets.rowCount,
    invitations: invites.rowCount,
  };
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
     RETURNING id, org_id, email, role, token_version, created_at`,
    [orgId, email.toLowerCase(), passwordHash, role]
  );
  return rows[0];
}

/** Full row incl. password_hash — for login verification only. */
async function getUserByEmail(email) {
  const conn = getDb();
  const { rows } = await conn.query(
    'SELECT id, org_id, email, password_hash, role, token_version, email_verified_at, created_at FROM users WHERE email = $1',
    [String(email || '').toLowerCase()]
  );
  return rows[0] || null;
}

async function getUserById(id) {
  const conn = getDb();
  const { rows } = await conn.query(
    'SELECT id, org_id, email, role, token_version, email_verified_at, created_at FROM users WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

/**
 * Invalidate every outstanding session for a user by bumping token_version —
 * requireAuth then rejects any JWT minted at the old value. Used by
 * POST /api/auth/logout-all and (Phase 25) password reset. Returns the new
 * version, or null if the user no longer exists.
 */
async function bumpTokenVersion(userId) {
  assertUserId(userId, 'bumpTokenVersion');
  const { rows } = await getDb().query(
    'UPDATE users SET token_version = token_version + 1 WHERE id = $1 RETURNING token_version',
    [userId]
  );
  return rows[0] ? rows[0].token_version : null;
}

async function updateUserPassword(userId, passwordHash) {
  assertUserId(userId, 'updateUserPassword');
  const { rowCount } = await getDb().query(
    'UPDATE users SET password_hash = $2 WHERE id = $1',
    [userId, passwordHash]
  );
  return rowCount > 0;
}

/* -------------------------------------------------------------------------- */
/* email verification + password reset — single-use, time-boxed tokens        */
/* -------------------------------------------------------------------------- */

async function createEmailVerification(userId, token, ttlHours) {
  assertUserId(userId, 'createEmailVerification');
  await getDb().query(
    `INSERT INTO email_verifications (token, user_id, expires_at)
     VALUES ($1, $2, now() + ($3 || ' hours')::interval)`,
    [token, userId, ttlHours]
  );
}

/**
 * Consume a verification token: if it is unused and unexpired, mark it used and
 * stamp users.email_verified_at (idempotent — a second valid token is a no-op
 * on an already-verified user). Returns { userId } on success, null otherwise.
 */
async function consumeEmailVerification(token) {
  if (typeof token !== 'string' || !token) return null;
  const client = await getDb().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE email_verifications SET used_at = now()
       WHERE token = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING user_id`,
      [token]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    const userId = rows[0].user_id;
    await client.query(
      'UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1',
      [userId]
    );
    await client.query('COMMIT');
    return { userId };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function createPasswordReset(userId, token, ttlHours) {
  assertUserId(userId, 'createPasswordReset');
  await getDb().query(
    `INSERT INTO password_resets (token, user_id, expires_at)
     VALUES ($1, $2, now() + ($3 || ' hours')::interval)`,
    [token, userId, ttlHours]
  );
}

/** Claim a reset token (mark used) if valid. Returns { userId } or null. */
async function consumePasswordReset(token) {
  if (typeof token !== 'string' || !token) return null;
  const { rows } = await getDb().query(
    `UPDATE password_resets SET used_at = now()
     WHERE token = $1 AND used_at IS NULL AND expires_at > now()
     RETURNING user_id`,
    [token]
  );
  return rows[0] ? { userId: rows[0].user_id } : null;
}

/* -------------------------------------------------------------------------- */
/* team: invitations + member roster — org-scoped                             */
/* -------------------------------------------------------------------------- */

async function createInvitation({ orgId, email, role, invitedByUserId, token, ttlHours }) {
  assertOrgId(orgId, 'createInvitation');
  await getDb().query(
    `INSERT INTO invitations (token, org_id, email, role, invited_by_user_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' hours')::interval)`,
    [token, orgId, String(email).toLowerCase(), role, invitedByUserId, ttlHours]
  );
}

/** Pending (unaccepted, unexpired) invitations for an org. */
async function listPendingInvitations(orgId) {
  assertOrgId(orgId, 'listPendingInvitations');
  const { rows } = await getDb().query(
    `SELECT token, email, role, created_at, expires_at
       FROM invitations
      WHERE org_id = $1 AND accepted_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC`,
    [orgId]
  );
  return rows;
}

/**
 * Look up an invitation by its token — NOT org-scoped, because the accept flow
 * has no session yet. Returns the row only if it is still claimable.
 */
async function getInvitationByToken(token) {
  if (typeof token !== 'string' || !token) return null;
  const { rows } = await getDb().query(
    `SELECT token, org_id, email, role
       FROM invitations
      WHERE token = $1 AND accepted_at IS NULL AND expires_at > now()`,
    [token]
  );
  return rows[0] || null;
}

/** Revoke a pending invitation. org-scoped. Returns the token if one was removed. */
async function deleteInvitation(orgId, token) {
  assertOrgId(orgId, 'deleteInvitation');
  const { rows } = await getDb().query(
    'DELETE FROM invitations WHERE org_id = $1 AND token = $2 RETURNING token',
    [orgId, String(token || '')]
  );
  return rows[0] ? rows[0].token : null;
}

/**
 * Accept an invitation atomically: re-check it is claimable, create the user in
 * the invitation's org with the invitation's role (email pre-verified — they
 * proved control by receiving the link), and mark the invite accepted.
 * Returns the new user row, or null if the invite was consumed/expired in the
 * meantime or the email is already taken.
 */
async function acceptInvitation({ token, email, passwordHash }) {
  const client = await getDb().connect();
  try {
    await client.query('BEGIN');
    const { rows: invRows } = await client.query(
      `SELECT org_id, email, role FROM invitations
        WHERE token = $1 AND accepted_at IS NULL AND expires_at > now()
        FOR UPDATE`,
      [token]
    );
    if (!invRows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    const inv = invRows[0];
    const { rows: existing } = await client.query('SELECT 1 FROM users WHERE email = $1', [
      String(email).toLowerCase(),
    ]);
    if (existing[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    const { rows: userRows } = await client.query(
      `INSERT INTO users (org_id, email, password_hash, role, email_verified_at)
       VALUES ($1, $2, $3, $4, now())
       RETURNING id, org_id, email, role, token_version, email_verified_at, created_at`,
      [inv.org_id, String(email).toLowerCase(), passwordHash, inv.role]
    );
    await client.query('UPDATE invitations SET accepted_at = now() WHERE token = $1', [token]);
    await client.query('COMMIT');
    return userRows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Every user in an org (no password hashes). org-scoped. */
async function listOrgMembers(orgId) {
  assertOrgId(orgId, 'listOrgMembers');
  const { rows } = await getDb().query(
    `SELECT id, email, role, email_verified_at, created_at
       FROM users WHERE org_id = $1 ORDER BY created_at ASC`,
    [orgId]
  );
  return rows;
}

/** Remove a member from an org. org-scoped; refuses to remove an owner. */
async function removeOrgMember(orgId, userId) {
  assertOrgId(orgId, 'removeOrgMember');
  assertUserId(userId, 'removeOrgMember');
  const { rows } = await getDb().query(
    "DELETE FROM users WHERE org_id = $1 AND id = $2 AND role <> 'owner' RETURNING id",
    [orgId, userId]
  );
  return rows[0] ? rows[0].id : null;
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

/* -------------------------------------------------------------------------- */
/* AscendAI chat — (org_id, user_id)-scoped conversation + per-org usage       */
/* -------------------------------------------------------------------------- */

function assertUserId(userId, fnName) {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error(`${fnName}: a valid integer userId is required (got ${JSON.stringify(userId)})`);
  }
}

/** Cap a stored message — the user saw the full reply; this only feeds context. */
const capStoredContent = (c) => String(c ?? '').slice(0, CHAT_MESSAGE_STORED_MAX_CHARS);

async function insertChatMessage(orgId, userId, role, content) {
  assertOrgId(orgId, 'insertChatMessage');
  assertUserId(userId, 'insertChatMessage');
  const stored = capStoredContent(content);
  const conn = getDb();
  const { rows } = await conn.query(
    `INSERT INTO chat_messages (org_id, user_id, role, content)
     VALUES ($1, $2, $3, $4) RETURNING id, role, content, created_at`,
    [orgId, userId, role, stored]
  );
  return rows[0];
}

/** Most recent `limit` messages for one user's conversation, oldest-first. */
async function getRecentChatMessages(orgId, userId, limit) {
  assertOrgId(orgId, 'getRecentChatMessages');
  assertUserId(userId, 'getRecentChatMessages');
  const cap = Math.max(0, Math.min(200, Number(limit) || 0));
  const conn = getDb();
  const { rows } = await conn.query(
    `SELECT id, role, content, created_at
     FROM (
       SELECT id, role, content, created_at
       FROM chat_messages
       WHERE org_id = $1 AND user_id = $2
       ORDER BY created_at DESC, id DESC
       LIMIT $3
     ) recent
     ORDER BY created_at ASC, id ASC`,
    [orgId, userId, cap]
  );
  return rows;
}

/** Clear one user's conversation. Does NOT touch ascendai_usage. */
async function deleteChatMessages(orgId, userId) {
  assertOrgId(orgId, 'deleteChatMessages');
  assertUserId(userId, 'deleteChatMessages');
  const conn = getDb();
  const { rowCount } = await conn.query(
    'DELETE FROM chat_messages WHERE org_id = $1 AND user_id = $2',
    [orgId, userId]
  );
  return rowCount;
}

async function recordAscendaiUsage(orgId, userId, { status, promptTokens = 0, completionTokens = 0, totalTokens = 0, iterations = 0 }) {
  assertOrgId(orgId, 'recordAscendaiUsage');
  assertUserId(userId, 'recordAscendaiUsage');
  const conn = getDb();
  await conn.query(
    `INSERT INTO ascendai_usage (org_id, user_id, status, prompt_tokens, completion_tokens, total_tokens, iterations)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [orgId, userId, status, promptTokens, completionTokens, totalTokens, iterations]
  );
}

/** How many AscendAI turns this ORG (all its users) has run since `sinceIso`. */
async function countAscendaiUsageSince(orgId, sinceIso) {
  assertOrgId(orgId, 'countAscendaiUsageSince');
  const conn = getDb();
  const { rows } = await conn.query(
    'SELECT count(*)::int AS n FROM ascendai_usage WHERE org_id = $1 AND created_at >= $2',
    [orgId, sinceIso]
  );
  return rows[0].n;
}

/* -------------------------------------------------------------------------- */
/* pending_uploads — Phase 14b stash, DB-backed so it survives across          */
/* serverless instances. Single-use + TTL + org scope enforced in one query.  */
/* -------------------------------------------------------------------------- */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function putPendingUpload(orgId, payload) {
  assertOrgId(orgId, 'putPendingUpload');
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized) > PENDING_UPLOAD_MAX_BYTES) {
    throw Object.assign(
      new Error(
        'This file has too much data to hold for the mapping-confirmation step. ' +
          'Please split it into smaller uploads.'
      ),
      { statusCode: 413 }
    );
  }
  const conn = getDb();
  await conn.query(
    `DELETE FROM pending_uploads WHERE created_at < now() - interval '${PENDING_UPLOAD_TTL}'`
  );
  const id = crypto.randomUUID();
  await conn.query('INSERT INTO pending_uploads (id, org_id, payload) VALUES ($1, $2, $3)', [
    id,
    orgId,
    serialized,
  ]);
  return id;
}

/** Atomically claim (delete + return) a non-expired pending upload for this org. */
async function takePendingUpload(id, orgId) {
  assertOrgId(orgId, 'takePendingUpload');
  if (typeof id !== 'string' || !UUID_RE.test(id)) return null;
  const conn = getDb();
  const { rows } = await conn.query(
    `DELETE FROM pending_uploads
     WHERE id = $1 AND org_id = $2 AND created_at > now() - interval '${PENDING_UPLOAD_TTL}'
     RETURNING payload`,
    [id, orgId]
  );
  return rows[0] ? rows[0].payload : null;
}

module.exports = {
  getDb,
  initDb,
  pruneOldRows,
  closeDb,
  DB_PATH,
  capStoredContent,
  putPendingUpload,
  takePendingUpload,
  createOrganization,
  getOrganizationById,
  setOnboardingCompleted,
  createUser,
  getUserByEmail,
  getUserById,
  bumpTokenVersion,
  updateUserPassword,
  createEmailVerification,
  consumeEmailVerification,
  createPasswordReset,
  consumePasswordReset,
  createInvitation,
  listPendingInvitations,
  getInvitationByToken,
  deleteInvitation,
  acceptInvitation,
  listOrgMembers,
  removeOrgMember,
  mergeStandardizedData,
  upsertStandardizedRow,
  deleteStandardizedData,
  getStandardizedData,
  getCachedMapping,
  putCachedMapping,
  insertChatMessage,
  getRecentChatMessages,
  deleteChatMessages,
  recordAscendaiUsage,
  countAscendaiUsageSince,
};

/**
 * Holding area for uploads paused on the column-mapping confirmation step
 * (Phase 14b).
 *
 * When an upload produces a field in `fieldsNeedingConfirmation`, its parsed
 * rows are stashed here — NOT written to standardized_data — until the user
 * confirms or corrects each flagged mapping. Entries are single-use, expire
 * after TTL_MS, and are scoped by `orgId` on the way out (never leak another
 * tenant's rows).
 *
 * Backed by the `pending_uploads` table (was an in-memory Map): a serverless
 * platform runs many function instances with separate memory, so a paused
 * upload stashed by one instance has to be reachable from any other.
 */

const { putPendingUpload, takePendingUpload } = require('../db');

const TTL_MS = 15 * 60 * 1000; // mirrors PENDING_UPLOAD_TTL in db/index.js

/** Stash a parsed-but-unstored upload; returns its one-time id. */
async function put({ orgId, parsed, mapping, filename, source }) {
  return putPendingUpload(orgId, { parsed, mapping, filename, source });
}

/**
 * Retrieve and remove a pending upload. Returns null if the id is unknown,
 * malformed, expired, or belongs to a different org.
 */
async function take(id, orgId) {
  const payload = await takePendingUpload(id, orgId);
  return payload ? { orgId, ...payload } : null;
}

module.exports = { put, take, TTL_MS };

/**
 * In-memory holding area for uploads paused on the column-mapping confirmation
 * step (Phase 14b).
 *
 * When an upload produces a field in `fieldsNeedingConfirmation`, its parsed
 * rows are stashed here — NOT written to the database — until the user confirms
 * or corrects each flagged mapping. Entries are single-use and expire, so a
 * user who walks away never leaves data half-ingested.
 *
 * Process-local and deliberately not persisted: an abandoned confirmation is
 * meant to evaporate, and a server restart legitimately discards it (the user
 * just re-uploads). Scoped by `orgId` on the way out.
 */

const crypto = require('crypto');

const TTL_MS = 15 * 60 * 1000;
const store = new Map(); // id -> { orgId, parsed, mapping, filename, source, createdAt }

function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, entry] of store) {
    if (entry.createdAt < cutoff) store.delete(id);
  }
}

/** Stash a parsed-but-unstored upload; returns its one-time id. */
function put({ orgId, parsed, mapping, filename, source }) {
  sweep();
  const id = crypto.randomUUID();
  store.set(id, { orgId, parsed, mapping, filename, source, createdAt: Date.now() });
  return id;
}

/**
 * Retrieve and remove a pending upload. Returns null if the id is unknown,
 * expired, or belongs to a different org (never leak another tenant's rows).
 */
function take(id, orgId) {
  sweep();
  const entry = store.get(id);
  if (!entry || entry.orgId !== orgId) return null;
  store.delete(id);
  return entry;
}

module.exports = { put, take, _store: store, TTL_MS };

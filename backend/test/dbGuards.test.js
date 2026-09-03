/**
 * Phase 22 storage guards (no live DB — both checks run before any query).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { capStoredContent, putPendingUpload } = require('../db');
const { CHAT_MESSAGE_STORED_MAX_CHARS, PENDING_UPLOAD_MAX_BYTES } = require('../config/thresholds');

test('capStoredContent truncates an over-long reply to the cap', () => {
  assert.equal(
    capStoredContent('x'.repeat(CHAT_MESSAGE_STORED_MAX_CHARS + 5000)).length,
    CHAT_MESSAGE_STORED_MAX_CHARS
  );
  assert.equal(capStoredContent('short answer'), 'short answer');
  assert.equal(capStoredContent(null), '');
});

test('putPendingUpload refuses an oversized payload before touching the DB', async () => {
  const huge = { rows: Array.from({ length: 200000 }, () => ({ a: 'x'.repeat(30) })) };
  assert.ok(JSON.stringify(huge).length > PENDING_UPLOAD_MAX_BYTES, 'test payload really is oversized');
  await assert.rejects(
    () => putPendingUpload(1, huge),
    (e) => e.statusCode === 413 && /too much data/i.test(e.message)
  );
});

/**
 * Seed N AscendAI usage rows for an org (today), so the per-org daily rate
 * limit trips on the next chat request. Test helper for the Phase 20 walkthrough.
 *   node scripts/seed-ascendai-usage.mjs <orgId> <count>
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const db = require('../db');

const [orgId, count] = process.argv.slice(2).map(Number);
if (!Number.isInteger(orgId) || !Number.isInteger(count)) {
  console.error('usage: node scripts/seed-ascendai-usage.mjs <orgId> <count>');
  process.exit(1);
}

const { rows } = await db.getDb().query(
  'SELECT id FROM users WHERE org_id = $1 ORDER BY id ASC LIMIT 1',
  [orgId]
);
if (!rows[0]) {
  console.error(`no user for org ${orgId}`);
  process.exit(1);
}
const userId = rows[0].id;
for (let i = 0; i < count; i += 1) {
  await db.recordAscendaiUsage(orgId, userId, { status: 'seed', totalTokens: 0 });
}
console.log(`seeded ${count} ascendai_usage rows for org ${orgId} (user ${userId})`);
await db.closeDb();

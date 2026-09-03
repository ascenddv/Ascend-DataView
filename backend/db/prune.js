/**
 * One-shot retention prune — deletes chat_messages / ascendai_usage past their
 * retention windows and expired pending_uploads.  `npm run prune`
 * (Vercel Cron calls the endpoint version in Phase 31.)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { pruneOldRows } = require('./index');

pruneOldRows()
  .then((r) => {
    console.log(`prune: removed ${JSON.stringify(r)}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });

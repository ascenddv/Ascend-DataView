/**
 * Local dev entry point. Loads .env, applies pending migrations, then binds a
 * port. On Vercel the app is served through ../api/index.js (no listen, no
 * migrate — migrations run as a deploy step).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const app = require('./app');
const { migrate } = require('./db/migrate');
const { DB_PATH } = require('./db');

const PORT = process.env.PORT || 3001;
const redactedDb = String(DB_PATH).replace(/:\/\/[^@/]+@/, '://***@');

migrate()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`AscendDV backend listening on http://localhost:${PORT}`);
      console.log(`Postgres: ${redactedDb}`);
    });
  })
  .catch((err) => {
    console.error('Startup failed:', err.message);
    process.exit(1);
  });

module.exports = app;

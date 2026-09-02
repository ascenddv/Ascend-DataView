/**
 * Local dev entry point. Loads .env, converges the schema, then binds a port.
 * On Vercel the app is served through ../api/index.js instead (no listen).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const app = require('./app');
const { DB_PATH } = require('./db');

const PORT = process.env.PORT || 3001;

app
  .ready()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`AscendDV backend listening on http://localhost:${PORT}`);
      console.log(`Postgres: ${DB_PATH}`);
    });
  })
  .catch((err) => {
    console.error('Database initialisation failed:', err.message);
    process.exit(1);
  });

module.exports = app;

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');

const healthRoutes = require('./routes/health');
const { getDb, DB_PATH } = require('./db');

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', healthRoutes);

// Initialise the database (creates tables on first run) before listening.
getDb();

app.listen(PORT, () => {
  console.log(`AscendDV backend listening on http://localhost:${PORT}`);
  console.log(`SQLite database: ${DB_PATH}`);
});

module.exports = app;

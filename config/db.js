const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => { console.error('DB error', err); process.exit(-1); });

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  pool,
};

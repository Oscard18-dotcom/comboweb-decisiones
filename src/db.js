const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  keepAlive: true,
});
pool.on('error', (e) => console.error('[db] conexión ociosa cerrada:', e.message));

module.exports = { query: (text, params) => pool.query(text, params), pool };

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  idleTimeoutMillis: 30000,        // cierra conexiones ociosas antes de que la nube las corte
  connectionTimeoutMillis: 15000,  // da tiempo a que una base en reposo (Neon) despierte
  keepAlive: true,
});
// Si el proveedor corta una conexión ociosa, no debe tumbar el servidor: el pool crea otra.
pool.on('error', (e) => console.error('[db] conexión ociosa cerrada:', e.message));

module.exports = { query: (text, params) => pool.query(text, params), pool };

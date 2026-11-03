require('../src/config');
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db');

(async () => {
  try {
    await pool.query(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
    console.log('Esquema creado correctamente.');
  } catch (e) {
    console.error('No se pudo crear el esquema:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();

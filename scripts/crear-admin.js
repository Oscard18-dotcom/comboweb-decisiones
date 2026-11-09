require('../src/config');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');

(async () => {
  const correo = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const nombre = (process.env.ADMIN_NAME || 'Administrador').trim();
  const clave = process.env.ADMIN_PASSWORD || '';
  const reiniciar = process.argv.includes('--reiniciar');
  const fallar = (m) => { console.error('✖ ' + m); process.exitCode = 1; };
  try {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) || correo.length > 120) return fallar('Define ADMIN_EMAIL con un correo válido.');
    if (nombre.length < 2 || nombre.length > 80) return fallar('ADMIN_NAME debe tener entre 2 y 80 caracteres.');
    if (clave.length < 8 || Buffer.byteLength(clave) > 72) return fallar('ADMIN_PASSWORD debe tener entre 8 y 72 caracteres.');
    const hash = await bcrypt.hash(clave, 12);
    const { rows } = await pool.query('SELECT id FROM usuarios WHERE lower(correo)=$1', [correo]);
    if (rows[0] && !reiniciar) return fallar('Ya existe un usuario con ese correo. Para restablecer su contraseña y dejarlo como administrador, agrega --reiniciar.');
    if (rows[0]) {
      await pool.query("UPDATE usuarios SET nombre=$2, password_hash=$3, rol='admin', activo=true, token_version=token_version+1 WHERE id=$1", [rows[0].id, nombre, hash]);
      console.log(`✔ Se restableció la contraseña de ${correo} y quedó como administrador (sus sesiones anteriores se cerraron).`);
    } else {
      await pool.query("INSERT INTO usuarios(nombre,correo,password_hash,rol) VALUES($1,$2,$3,'admin')", [nombre, correo, hash]);
      console.log(`✔ Administrador creado: ${correo}`);
    }
  } finally { await pool.end(); }
})().catch((e) => { console.error('✖ Error:', e.message); process.exit(1); });

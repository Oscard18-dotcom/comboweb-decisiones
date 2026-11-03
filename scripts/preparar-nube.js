// Prepara el sistema cada vez que arranca en la nube (Render, Railway…). Es SEGURO repetirlo:
//  1) crea/actualiza las tablas (db/schema.sql es idempotente),
//  2) carga los datos de ejemplo (insumos, productos, presentaciones) SOLO si la base está vacía,
//     así lo que borres o cambies no reaparece en el siguiente reinicio,
//  3) crea el administrador con ADMIN_EMAIL / ADMIN_PASSWORD SOLO si todavía no existe ninguno.
//     (Si olvidaste la contraseña: pon ADMIN_REINICIAR=true junto con ADMIN_EMAIL y ADMIN_PASSWORD nuevos, reinicia el servicio y luego QUITA ADMIN_REINICIAR.)
// No crea cuentas de prueba (@encombo.test): en internet cualquiera podría conocerlas.
require('../src/config');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');
const { isEmail, isPassword } = require('../src/util');

(async () => {
  await pool.query(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  console.log('✔ Tablas listas.');
  const vacia = (await pool.query('SELECT (SELECT count(*) FROM insumos)::int AS i, (SELECT count(*) FROM productos)::int AS p')).rows[0];
  if (vacia.i === 0 && vacia.p === 0) {
    execFileSync('node', [path.join(__dirname, 'seed.js')], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
  } else console.log('✔ La base ya tiene datos: no se vuelven a cargar los de ejemplo.');

  const hay = (await pool.query("SELECT count(*)::int AS n FROM usuarios WHERE rol='admin' AND activo")).rows[0].n;
  const correo = (process.env.ADMIN_EMAIL || '').trim().toLowerCase(), clave = process.env.ADMIN_PASSWORD || '';
  const reiniciar = process.env.ADMIN_REINICIAR === 'true';
  const credencialesOk = isEmail(correo) && isPassword(clave);
  if (hay && !(reiniciar && credencialesOk)) console.log('✔ Ya hay un administrador activo.' + (reiniciar ? ' (ADMIN_REINICIAR no hizo nada: revisa ADMIN_EMAIL y ADMIN_PASSWORD)' : ''));
  else if (!credencialesOk) console.log('⚠ No hay administrador. Define ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 8 caracteres) y reinicia el servicio.');
  else {
    const hash = await bcrypt.hash(clave, 12);
    const previo = (await pool.query('SELECT id FROM usuarios WHERE lower(correo)=$1', [correo])).rows[0];
    if (previo) await pool.query("UPDATE usuarios SET rol='admin', activo=true, password_hash=$2, token_version=token_version+1 WHERE id=$1", [previo.id, hash]);
    else await pool.query("INSERT INTO usuarios(nombre,correo,password_hash,rol) VALUES($1,$2,$3,'admin')", [(process.env.ADMIN_NAME || 'Administrador').trim().slice(0, 80) || 'Administrador', correo, hash]);
    console.log(previo && hay ? `✔ Contraseña restablecida para el administrador ${correo}. Recuerda QUITAR la variable ADMIN_REINICIAR.` : `✔ Administrador creado: ${correo}`);
  }
  await pool.end();
})().catch((e) => { console.error('✖ No se pudo preparar el sistema:', e.message); process.exit(1); });

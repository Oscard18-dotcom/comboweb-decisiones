const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { spawnSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
let pg;
try { pg = require('pg'); } catch (e) { console.error('\nPROBLEMA - Faltan piezas del sistema. Cierre esta ventana y haga doble clic otra vez en instalar.bat.'); process.exit(1); }

const BD = process.env.DB_NAME || 'comboweb', USUARIO = process.env.DB_USER || 'combo_user';
const CLAVE_SISTEMA = process.env.SEED_PASSWORD || 'EnCombo-2026';
const CLAVE_PG_DEFECTO = 'AdminEnCombo2026';
const PUERTOS = process.env.PGPORT ? [Number(process.env.PGPORT)] : [5432, 5433];
const linea = '='.repeat(62);
const di = (t = '') => console.log(t);
const ok = (t) => di('  OK - ' + t);
const problema = (t) => { di('\n  PROBLEMA - ' + t + '\n'); };
if (!/^[a-z][a-z0-9_]{0,30}$/.test(BD) || !/^[a-z][a-z0-9_]{0,30}$/.test(USUARIO)) { problema('Nombre de base de datos o de usuario no válido.'); process.exit(1); }

const rl = readline.createInterface({ input: process.stdin });
const cola = []; let espera = null, cerrado = false;
rl.on('line', (l) => { if (espera) { const r = espera; espera = null; r(l.trim()); } else cola.push(l.trim()); });
rl.on('close', () => { cerrado = true; if (espera) { const r = espera; espera = null; r(''); } });
function preguntar(texto) {
  process.stdout.write(texto);
  if (cola.length) return Promise.resolve(cola.shift());
  if (cerrado) return Promise.resolve('');
  return new Promise((r) => { espera = r; });
}

async function conectarComoAdministrador() {
  let clave = process.env.PGADMIN_PASSWORD, ultimo = null;
  for (let intento = 1; intento <= 3; intento++) {
    if (clave === undefined) {
      di('\n  Escriba la contraseña de PostgreSQL (la que puso al instalarlo) y pulse Enter.');
      di(`  Si siguió la guía al pie de la letra, es:  ${CLAVE_PG_DEFECTO}   (puede solo pulsar Enter)`);
      clave = (await preguntar('  Contraseña de PostgreSQL: ')) || CLAVE_PG_DEFECTO;
    }
    ultimo = null;
    for (const puerto of PUERTOS) {
      const c = new pg.Client({ host: 'localhost', port: puerto, user: 'postgres', password: clave, database: 'postgres', connectionTimeoutMillis: 5000 });
      try { await c.connect(); return { c, puerto }; } catch (e) { ultimo = e; await c.end().catch(() => {}); if (e.code === '28P01') break; }
    }
    if (ultimo && ultimo.code === '28P01') {
      problema(`Esa contraseña de PostgreSQL no es correcta (intento ${intento} de 3). Recuerde: es la que escribió al instalar PostgreSQL.`);
      if (process.env.PGADMIN_PASSWORD !== undefined) break;
      clave = undefined; continue;
    }
    break;
  }
  if (ultimo && ultimo.code === '28P01') problema('No se pudo entrar a PostgreSQL con esa contraseña. Pida ayuda a su persona de apoyo (puede cambiar la contraseña de PostgreSQL desde pgAdmin).');
  else problema('No encuentro PostgreSQL encendido en esta computadora.\n  - Revise que lo instaló (Paso 2 de la guía).\n  - Reinicie la computadora y vuelva a intentarlo.\n  Detalle técnico: ' + (ultimo ? (ultimo.code || ultimo.message) : 'sin detalle'));
  process.exit(1);
}

(async () => {
  di('\n' + linea); di('  INSTALANDO ComboWeb App (puede tardar uno o dos minutos)'); di(linea);
  const { c, puerto } = await conectarComoAdministrador();
  ok(`Se conectó a PostgreSQL (puerto ${puerto}).`);
  try {
    const claveBD = crypto.randomBytes(18).toString('hex');
    const existeRol = (await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [USUARIO])).rowCount;
    await c.query(`${existeRol ? 'ALTER' : 'CREATE'} ROLE ${USUARIO} WITH LOGIN PASSWORD '${claveBD}'`);
    ok(existeRol ? 'El usuario del sistema ya existía; se actualizó.' : 'Se creó el usuario del sistema en PostgreSQL.');
    const existeBD = (await c.query('SELECT 1 FROM pg_database WHERE datname=$1', [BD])).rowCount;
    if (!existeBD) await c.query(`CREATE DATABASE ${BD} OWNER ${USUARIO}`); else await c.query(`ALTER DATABASE ${BD} OWNER TO ${USUARIO}`);
    ok(existeBD ? 'La base de datos ya existía (se conservan sus datos).' : 'Se creó la base de datos.');

    const rutaEnv = path.join(RAIZ, '.env'); let jwt = crypto.randomBytes(48).toString('hex');
    if (fs.existsSync(rutaEnv)) {
      const previo = fs.readFileSync(rutaEnv, 'utf8'), m = previo.match(/^JWT_SECRET=(.{32,})$/m); if (m) jwt = m[1].trim();
      fs.writeFileSync(rutaEnv + '.respaldo', previo); ok('Había una configuración anterior; se guardó una copia (.env.respaldo).');
    }
    fs.writeFileSync(rutaEnv, `# Configuración de ComboWeb App (creada automáticamente). NO la comparta con nadie.
PORT=3000
DATABASE_URL=postgres://${USUARIO}:${claveBD}@localhost:${puerto}/${BD}
DATABASE_SSL=false
JWT_SECRET=${jwt}
SEED_PASSWORD=${CLAVE_SISTEMA}
PUBLIC_URL=http://localhost:3000
# Modo de práctica: el pago NO cobra y los correos NO se envían (solo aparecen en la ventana negra).
PAYMENT_PROVIDER=simulado
MAIL_PROVIDER=consola
`);
    ok('Se escribió la configuración del sistema.');
  } finally { await c.end().catch(() => {}); }

  const paso = (script, etiqueta) => {
    const r = spawnSync(process.execPath, [path.join('scripts', script)], { cwd: RAIZ, encoding: 'utf8' });
    if (r.status !== 0) { problema(`No se pudo ${etiqueta}.\n${(r.stdout || '') + (r.stderr || '')}`); process.exit(1); }
    ok(etiqueta[0].toUpperCase() + etiqueta.slice(1) + '.');
  };
  paso('init-db.js', 'crear las tablas de la base de datos');
  paso('seed.js', 'cargar los productos, insumos, recetas y cuentas de práctica');

  di('\n' + linea); di('  LISTO. EL SISTEMA QUEDÓ INSTALADO.'); di(linea);
  di('\n  Para ENCENDERLO cada día:  doble clic en  iniciar.bat');
  di('\n  Cuentas de práctica (correo  /  contraseña):');
  for (const [rol, c] of [['Administración', 'admin@encombo.test'], ['Cocina', 'cocina@encombo.test'], ['Almacén', 'almacen@encombo.test'], ['Cliente', 'cliente@encombo.test']]) di(`    ${rol.padEnd(15)} ${c.padEnd(24)} ${CLAVE_SISTEMA}`);
  di('\n  Ya puede cerrar esta ventana.\n');
  rl.close();
})().catch((e) => { problema('Ocurrió un error inesperado: ' + e.message); process.exit(1); });
process.on('exit', () => { try { rl.close(); } catch (e) {  } });

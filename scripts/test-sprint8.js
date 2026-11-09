const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { Pool } = require('pg');
const app = require('../src/app');
const db = require('../src/db');
const svc = require('../src/services/pedidos');
const mail = require('../src/mail');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const server = app.listen(0);
const B = `http://localhost:${server.address().port}`;
async function call(m, p, body, tok, base = B) {
  const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = JSON.parse(await r.text()); } catch (e) {  }
  return { s: r.status, j };
}
const R = Date.now();
const q = async (sql, p) => (await db.query(sql, p)).rows;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (args, env = {}) => { try { return { code: 0, out: String(execFileSync('node', args, { env: { ...process.env, ...env }, stdio: 'pipe', cwd: ROOT })) }; } catch (e) { return { code: e.status, out: String(e.stdout) + String(e.stderr) }; } };
const hijos = [];
async function arrancar(env, puerto) {
  const h = spawn('node', ['src/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(puerto), AUTH_RATE_LIMIT: '100000', ...env } }); hijos.push(h);
  let salida = ''; h.stdout.on('data', (d) => { salida += d; }); h.stderr.on('data', (d) => { salida += d; });
  for (let i = 0; i < 100; i++) { if (/escuchando/.test(salida)) return { h, salida: () => salida, ok: true }; if (h.exitCode !== null) break; await sleep(100); }
  return { h, salida: () => salida, ok: false };
}

(async () => {
  const insumos0 = await q('SELECT * FROM insumos ORDER BY id');
  const movMax = (await q('SELECT coalesce(max(id),0) AS m FROM movimientos_inventario'))[0].m;
  const clientes = []; let tempDb = null, admPool = null;
  mail.reemplazar({ nombre: 'prueba', async enviar() {} });
  try {
    const login = async (c) => (await call('POST', '/api/auth/login', { correo: c, password: process.env.SEED_PASSWORD })).j.token;
    const admin = await login('admin@encombo.test'), almacen = await login('almacen@encombo.test'), cocina = await login('cocina@encombo.test');
    const reg = await call('POST', '/api/auth/register', { nombre: 'Cliente P8', correo: `p8${R}@prueba.test`, password: 'secreta123' });
    clientes.push(reg.j.usuario.id); const cli = reg.j.token;
    const harina = (await q("SELECT id FROM insumos WHERE nombre='Harina'"))[0].id;

    for (const [n, tok] of [['sin sesión', null], ['cliente', cli], ['cocina', cocina], ['almacén', almacen]]) {
      const r = await call('DELETE', '/api/admin/productos/1', undefined, tok); t(`eliminar producto: ${n} → ${tok ? 403 : 401}`, r.s === (tok ? 403 : 401), String(r.s));
    }
    let r = await call('DELETE', '/api/admin/productos/abc', undefined, admin); t('eliminar producto con id inválido → 400', r.s === 400);
    r = await call('DELETE', '/api/admin/productos/99999999', undefined, admin); t('eliminar producto inexistente → 404', r.s === 404);
    const nuevo = async (nombre) => {
      const p = (await call('POST', '/api/admin/productos', { nombre, descripcion: 'Prueba', precio: 20 }, admin)).j.producto;
      const rc = (await call('POST', '/api/recetas', { producto_id: p.id, rinde: 1, ingredientes: [{ insumo_id: harina, cantidad: 10 }] }, admin)).j.receta;
      return { p, rc };
    };
    const A = await nuevo(`Test8 Sin ventas ${R}`);
    t('preparación: producto con receta', !!A.p.id && !!A.rc.id, JSON.stringify(A));
    await call('PATCH', `/api/admin/productos/${A.p.id}/activo`, { activo: true }, admin);
    t('el producto activo aparece en el catálogo público', (await call('GET', '/api/catalogo')).j.productos.some((x) => x.id === A.p.id));
    r = await call('DELETE', `/api/admin/productos/${A.p.id}`, undefined, admin);
    t('eliminar un producto sin ventas (aunque esté activo) → eliminado', r.s === 200 && r.j.eliminado === true, JSON.stringify(r.j));
    t('…se borró el producto', (await q('SELECT 1 FROM productos WHERE id=$1', [A.p.id])).length === 0);
    t('…y también su receta y sus ingredientes', (await q('SELECT 1 FROM recetas WHERE id=$1', [A.rc.id])).length === 0 && (await q('SELECT 1 FROM receta_ingredientes WHERE receta_id=$1', [A.rc.id])).length === 0);
    t('…y ya no está en el catálogo ni en la lista del administrador', !(await call('GET', '/api/catalogo')).j.productos.some((x) => x.id === A.p.id) && !(await call('GET', '/api/admin/productos', undefined, admin)).j.productos.some((x) => x.id === A.p.id));
    t('…y el insumo de la receta sigue intacto', (await q('SELECT 1 FROM insumos WHERE id=$1', [harina])).length === 1);
    r = await call('DELETE', `/api/admin/productos/${A.p.id}`, undefined, admin); t('eliminarlo otra vez → 404', r.s === 404);
    const Bp = await nuevo(`Test8 Sin receta ${R}`); await call('DELETE', `/api/recetas/${Bp.rc.id}`, undefined, admin);
    r = await call('DELETE', `/api/admin/productos/${Bp.p.id}`, undefined, admin); t('eliminar un producto que no tiene receta', r.s === 200 && r.j.eliminado === true);
    const V = await nuevo(`Test8 Con ventas ${R}`);
    await call('PATCH', `/api/admin/productos/${V.p.id}/activo`, { activo: true }, admin);
    const cat = (await call('GET', '/api/catalogo')).j; const pres = cat.presentaciones.find((x) => x.nombre === 'Caja mediana').id;
    const dia = svc.addDays(svc.todayMX(), 25 + Math.floor(Math.random() * 30));
    const ck = await call('POST', '/api/pedidos/checkout', { items: [{ producto_id: V.p.id, cantidad: 1 }], presentacion_id: pres, fecha: dia, hora: '12:00', direccion: { cp: '91190', colonia: 'Las Flores', calle: 'Calle de Prueba', num_ext: '12' } }, cli);
    const pago = ck.s === 201 ? await call('POST', `/api/pagos/simulado/${ck.j.checkout_id}/aprobar`, undefined, cli) : ck;
    t('preparación: el producto se vende (pedido pagado)', pago.j.estado === 'pagado', JSON.stringify(pago.j));
    r = await call('DELETE', `/api/admin/productos/${V.p.id}`, undefined, admin);
    t('eliminar un producto con ventas → se desactiva, no se borra', r.s === 200 && r.j.archivado === true, JSON.stringify(r.j));
    const fila = (await q('SELECT activo FROM productos WHERE id=$1', [V.p.id]))[0];
    t('…el producto sigue en la base (inactivo) y su receta también', fila && fila.activo === false && (await q('SELECT 1 FROM recetas WHERE id=$1', [V.rc.id])).length === 1);
    t('…el historial del pedido se conserva', (await q('SELECT 1 FROM pedido_items WHERE producto_id=$1', [V.p.id])).length === 1);
    t('…ya no aparece en el catálogo público', !(await call('GET', '/api/catalogo')).j.productos.some((x) => x.id === V.p.id));
    r = await call('DELETE', `/api/admin/productos/${V.p.id}`, undefined, admin); t('repetir la eliminación sigue siendo seguro', r.s === 200 && r.j.archivado === true);
    t('"Desactivar producto" (PATCH) sigue funcionando', (await call('PATCH', `/api/admin/productos/${V.p.id}/activo`, { activo: true }, admin)).j.producto.activo === true);

    r = await call('GET', '/api/salud'); t('/api/salud en desarrollo: modo_demo = false', r.j.estado === 'ok' && r.j.modo_demo === false);
    const html = await (await fetch(B + '/')).text();
    t('la página ya no muestra el cartel de “Sitio de demostración”', !/id="demo"/.test(html) && !/Sitio de demostración/.test(html) && !fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8').includes('#demo') && !/\.demo\{/.test(fs.readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8')));
    const prodBase = { NODE_ENV: 'production', PUBLIC_URL: 'https://demo.example.com', TRUST_PROXY: '1', DATABASE_SSL: 'false', PAYMENT_PROVIDER: 'simulado', MAIL_PROVIDER: 'consola', MODO_DEMO: '' };
    let x = run(['-e', "require('./src/config')"], prodBase);
    t('producción con pago simulado SIN MODO_DEMO: se niega a arrancar y explica cómo', x.code !== 0 && /MODO_DEMO=true/.test(x.out), x.out.slice(0, 200));
    x = run(['-e', "require('./src/config')"], { ...prodBase, PAYMENT_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' });
    t('producción con correo en consola SIN MODO_DEMO: se niega a arrancar', x.code !== 0 && /MAIL_PROVIDER=consola/.test(x.out));
    x = run(['-e', "require('./src/config')"], { ...prodBase, MODO_DEMO: 'si' });
    t('MODO_DEMO solo se activa con el valor exacto "true"', x.code !== 0);
    x = run(['-e', "require('./src/config'); console.log('URL=' + process.env.PUBLIC_URL)"], { ...prodBase, MODO_DEMO: 'true', PUBLIC_URL: '', RENDER_EXTERNAL_URL: 'https://comboweb-app.onrender.com' });
    t('MODO_DEMO=true permite producción con pago/correo simulados y toma PUBLIC_URL de Render', x.code === 0 && /URL=https:\/\/comboweb-app\.onrender\.com/.test(x.out), x.out.slice(0, 200));
    x = run(['-e', "require('./src/config'); console.log('URL=' + process.env.PUBLIC_URL)"], { ...prodBase, MODO_DEMO: 'true', PUBLIC_URL: 'https://mio.example.com', RENDER_EXTERNAL_URL: 'https://otro.onrender.com' });
    t('un PUBLIC_URL definido a mano tiene prioridad', /URL=https:\/\/mio\.example\.com/.test(x.out));

    const puerto = 3900 + (R % 90);
    const S = await arrancar({ ...prodBase, MODO_DEMO: 'true' }, puerto);
    t('el servidor arranca en producción con MODO_DEMO=true', S.ok, S.salida());
    const U = `http://localhost:${puerto}`;
    r = await call('GET', '/api/salud', undefined, null, U); t('…/api/salud informa modo_demo = true', r.j.modo_demo === true);
    const reg2 = await call('POST', '/api/auth/register', { nombre: 'Persona Anónima', correo: `anon${R}@prueba.test`, password: 'secreta123' }, null, U); clientes.push(reg2.j.usuario && reg2.j.usuario.id);
    t('…cualquier persona puede crear su cuenta', reg2.s === 201 && reg2.j.usuario.rol === 'cliente');
    const dia2 = svc.addDays(svc.todayMX(), 40 + Math.floor(Math.random() * 30));
    const ck2 = await call('POST', '/api/pedidos/checkout', { items: [{ producto_id: cat.productos[0].id, cantidad: 1 }], presentacion_id: pres, fecha: dia2, hora: '11:00', direccion: { cp: '91190', colonia: 'Las Flores', calle: 'Calle de Prueba', num_ext: '12' } }, reg2.j.token, U);
    t('…y puede iniciar un pedido (la pasarela simulada devuelve su página de pago)', ck2.s === 201 && /pago-simulado\.html\?checkout=/.test(ck2.j.url || ''), JSON.stringify(ck2.j));
    const ap = await call('POST', `/api/pagos/simulado/${ck2.j.checkout_id}/aprobar`, undefined, reg2.j.token, U);
    t('…lo "paga" y el pedido queda registrado', ap.j.estado === 'pagado');
    const ped = await call('GET', '/api/pedidos', undefined, reg2.j.token, U); t('…lo ve en "Mis pedidos"', ped.s === 200 && ped.j.pedidos && ped.j.pedidos.length === 1);
    const hp = await fetch(U + '/pago-simulado.html'); t('…la página de pago simulado está publicada', hp.status === 200);
    t('…las rutas del personal siguen protegidas', (await call('GET', '/api/admin/usuarios', undefined, reg2.j.token, U)).s === 403 && (await call('GET', '/api/proveedores', undefined, null, U)).s === 401);
    const xr = await Promise.all(['/.env', '/package.json', '/src/config.js', '/render.yaml', '/scripts/preparar-nube.js'].map((p) => fetch(U + p).then(async (z) => ({ p, s: z.status, d: await z.text() }))));
    t('…los archivos internos no se publican (.env, código, render.yaml)', xr.every((z) => z.s !== 200 || !/JWT_SECRET|DATABASE_URL|require\(|services:/.test(z.d)), JSON.stringify(xr.map((z) => z.p + ':' + z.s)));
    const cab = await fetch(U + '/api/salud');
    t('…y mantiene las cabeceras de seguridad', !!cab.headers.get('x-content-type-options') && !cab.headers.get('x-powered-by'));
    S.h.kill('SIGTERM');

    x = run(['scripts/verificar-despliegue.js'], { ...prodBase, MODO_DEMO: 'true' });
    t('verificar con MODO_DEMO: pasa con aviso "MODO DEMOSTRACIÓN"', x.code === 0 && /⚠ MODO DEMOSTRACIÓN/.test(x.out) && /Listo para publicar/.test(x.out), x.out.slice(-400));
    x = run(['scripts/verificar-despliegue.js'], { ...prodBase, MODO_DEMO: '' });
    t('verificar sin MODO_DEMO: el pago simulado en producción sigue siendo un error', x.code === 1);

    const yaml = fs.readFileSync(path.join(ROOT, 'render.yaml'), 'utf8');
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    t('render.yaml: servicio web gratuito con comando de arranque existente en package.json', /type: web/.test(yaml) && /plan: free/.test(yaml) && /startCommand: npm run start:nube/.test(yaml) && !!pkg.scripts['start:nube']);
    t('render.yaml: base de datos externa (sin base gratuita de Render que caduca) y salud configuradas', !/databases:/.test(yaml) && /key: DATABASE_URL\s+sync: false/.test(yaml) && /healthCheckPath: \/api\/salud/.test(yaml));
    t('render.yaml: JWT_SECRET se genera solo y las claves del administrador no están escritas en el archivo', /key: JWT_SECRET\s+generateValue: true/.test(yaml) && /key: ADMIN_PASSWORD\s+sync: false/.test(yaml) && !/ADMIN_PASSWORD\s+value/.test(yaml));
    t('render.yaml: modo demostración y producción declarados', /key: MODO_DEMO\s+value: "true"/.test(yaml) && /key: NODE_ENV\s+value: production/.test(yaml));
    t('.gitignore no deja subir .env ni respaldos', /^\.env$/m.test(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')) && /respaldos/.test(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')));

    const urlBase = new URL(process.env.DATABASE_URL); const nombreTemp = `comboweb_t8_${R}`;
    admPool = new Pool({ connectionString: process.env.DATABASE_URL.replace(/\/[^/]*$/, '/postgres'), ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false });
    try { await admPool.query(`CREATE DATABASE ${nombreTemp}`); tempDb = nombreTemp; } catch (e) { console.log(`AVISO: no se pudo crear una base temporal (${e.message}); se omiten las pruebas de preparar-nube.`); }
    if (tempDb) {
      const urlT = process.env.DATABASE_URL.replace(/\/[^/]*$/, '/' + tempDb);
      const envT = { ...prodBase, MODO_DEMO: 'true', DATABASE_URL: urlT, ADMIN_EMAIL: `Dueño${R}@Prueba.Test`.replace('ñ', 'n'), ADMIN_PASSWORD: 'clave-de-la-nube-1', ADMIN_NAME: 'Dueña Demo' };
      const T = new Pool({ connectionString: urlT, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false });
      x = run(['scripts/preparar-nube.js'], envT);
      t('preparar-nube en una base vacía: crea tablas, datos de ejemplo y administrador', x.code === 0 && /Tablas listas/.test(x.out) && /Datos iniciales cargados/.test(x.out) && /Administrador creado/.test(x.out), x.out.slice(-300));
      const cuenta = async (sql) => (await T.query(sql)).rows[0].n;
      t('…hay 10 insumos, 6 productos con receta y 3 presentaciones', await cuenta('SELECT count(*)::int n FROM insumos') === 10 && await cuenta('SELECT count(*)::int n FROM productos') === 6 && await cuenta('SELECT count(*)::int n FROM recetas') === 6 && await cuenta('SELECT count(*)::int n FROM presentaciones') === 3);
      t('…NO se crean cuentas de prueba públicas (@encombo.test): solo el administrador', await cuenta('SELECT count(*)::int n FROM usuarios') === 1 && await cuenta("SELECT count(*)::int n FROM usuarios WHERE correo LIKE '%@encombo.test'") === 0 && await cuenta("SELECT count(*)::int n FROM usuarios WHERE rol='admin'") === 1);
      await T.query("DELETE FROM productos WHERE nombre='Cupcake'");
      await T.query("UPDATE insumos SET stock=1 WHERE nombre='Harina'");
      x = run(['scripts/preparar-nube.js'], envT);
      t('repetirlo (reinicio del servidor) es seguro: no vuelve a cargar los datos de ejemplo ni duplica nada', x.code === 0 && /ya tiene datos/.test(x.out) && /Ya hay un administrador/.test(x.out), x.out.slice(-300));
      t('…lo que borraste no reaparece y tus cambios se conservan', await cuenta("SELECT count(*)::int n FROM productos WHERE nombre='Cupcake'") === 0 && Number((await T.query("SELECT stock FROM insumos WHERE nombre='Harina'")).rows[0].stock) === 1 && await cuenta('SELECT count(*)::int n FROM usuarios') === 1);
      x = run(['scripts/preparar-nube.js'], { ...envT, ADMIN_EMAIL: 'otro@prueba.test', ADMIN_PASSWORD: 'otra-clave-1234' });
      t('…y una variable ADMIN_EMAIL distinta no crea un segundo administrador', await cuenta("SELECT count(*)::int n FROM usuarios WHERE rol='admin'") === 1);
      const S2 = await arrancar({ ...envT }, puerto + 1); const U2 = `http://localhost:${puerto + 1}`;
      const lg = await call('POST', '/api/auth/login', { correo: envT.ADMIN_EMAIL.toLowerCase(), password: 'clave-de-la-nube-1' }, null, U2);
      t('el administrador de la nube inicia sesión con la contraseña que definiste', S2.ok && lg.s === 200 && lg.j.usuario.rol === 'admin', S2.salida().slice(-200));
      t('…y las cuentas de prueba @encombo.test NO existen en la nube', (await call('POST', '/api/auth/login', { correo: 'admin@encombo.test', password: process.env.SEED_PASSWORD }, null, U2)).s === 401);
      S2.h.kill('SIGTERM');
      const antes = (await T.query("SELECT token_version FROM usuarios WHERE rol='admin'")).rows[0].token_version;
      x = run(['scripts/preparar-nube.js'], { ...envT, ADMIN_REINICIAR: 'true', ADMIN_PASSWORD: 'clave-restablecida-9' });
      const S3 = await arrancar({ ...envT, ADMIN_PASSWORD: 'clave-restablecida-9' }, puerto + 2); const U3 = `http://localhost:${puerto + 2}`;
      t('ADMIN_REINICIAR=true restablece la contraseña del administrador (y cierra sus sesiones)', x.code === 0 && /Contraseña restablecida/.test(x.out) && (await call('POST', '/api/auth/login', { correo: envT.ADMIN_EMAIL.toLowerCase(), password: 'clave-restablecida-9' }, null, U3)).s === 200 && (await call('POST', '/api/auth/login', { correo: envT.ADMIN_EMAIL.toLowerCase(), password: 'clave-de-la-nube-1' }, null, U3)).s === 401 && (await T.query("SELECT token_version FROM usuarios WHERE rol='admin'")).rows[0].token_version === antes + 1, x.out.slice(-200));
      S3.h.kill('SIGTERM');
      x = run(['scripts/preparar-nube.js'], { ...envT, ADMIN_PASSWORD: 'clave-restablecida-9' });
      t('…sin esa variable, un reinicio normal ya no toca la contraseña', x.code === 0 && /Ya hay un administrador/.test(x.out));
      await T.query('DELETE FROM usuarios');
      x = run(['scripts/preparar-nube.js'], { ...envT, ADMIN_EMAIL: '', ADMIN_PASSWORD: '' });
      t('sin ADMIN_EMAIL/ADMIN_PASSWORD y sin administrador: avisa claramente y no falla', x.code === 0 && /No hay administrador/.test(x.out));
      x = run(['scripts/preparar-nube.js'], { ...envT, ADMIN_EMAIL: 'x@prueba.test', ADMIN_PASSWORD: 'corta' });
      t('una contraseña corta no crea al administrador', x.code === 0 && /No hay administrador/.test(x.out) && await cuenta('SELECT count(*)::int n FROM usuarios') === 0);
      await T.end();
    }
  } catch (e) {
    fail++; console.log('FAIL error inesperado:', e && e.stack || e);
  } finally {
    try {
      for (const h of hijos) { try { h.kill('SIGKILL'); } catch (e) {  } }
      mail.reemplazar(null);
      if (tempDb && admPool) { await sleep(300); await admPool.query(`DROP DATABASE IF EXISTS ${tempDb} WITH (FORCE)`).catch((e) => console.log('Aviso: no se pudo borrar la base temporal:', e.message)); }
      if (admPool) await admPool.end().catch(() => {});
      const ids = clientes.filter(Boolean);
      await db.query('DELETE FROM checkouts WHERE cliente_id = ANY($1)', [ids]);
      await db.query('DELETE FROM movimientos_inventario WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ANY($1))', [ids]);
      await db.query('DELETE FROM pagos WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ANY($1))', [ids]);
      await db.query('DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ANY($1))', [ids]);
      await db.query('DELETE FROM pedido_estatus_historial WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ANY($1))', [ids]).catch(() => {});
      await db.query('DELETE FROM notificaciones WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ANY($1))', [ids]).catch(() => {});
      await db.query('DELETE FROM pedidos WHERE cliente_id = ANY($1)', [ids]);
      await db.query('DELETE FROM usuarios WHERE id = ANY($1)', [ids]);
      await db.query("DELETE FROM productos WHERE nombre LIKE 'Test8 %'");
      await db.query('DELETE FROM movimientos_inventario WHERE id > $1', [movMax]);
      for (const i of insumos0) await db.query('UPDATE insumos SET stock=$2,stock_minimo=$3,costo_unitario=$4,activo=$5 WHERE id=$1', [i.id, i.stock, i.stock_minimo, i.costo_unitario, i.activo]);
    } catch (e) { console.log('Aviso: limpieza incompleta:', e.message); }
    console.log(`\n${pass} correctas, ${fail} fallidas`);
    server.close(); await db.pool.end(); process.exit(fail ? 1 : 0);
  }
})();

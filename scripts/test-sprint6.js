process.env.AUTH_RATE_LIMIT = '100000';
const http = require('http');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const db = require('../src/db');
const svc = require('../src/services/pedidos');
const mail = require('../src/mail');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const server = app.listen(0);
const PORT = server.address().port, B = `http://localhost:${PORT}`;
async function call(m, p, body, tok, headers = {}) {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}), ...headers }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  let j = {}; let texto = ''; try { texto = await r.text(); j = JSON.parse(texto); } catch (e) {  }
  return { s: r.status, j, texto, h: r.headers };
}
const R = Date.now();
const q = async (sql, p) => (await db.query(sql, p)).rows;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const run = (args, env = {}) => { try { return { code: 0, out: String(execFileSync('node', args, { env: { ...process.env, ...env }, stdio: 'pipe', cwd: ROOT })) }; } catch (e) { return { code: e.status, out: String(e.stdout) + String(e.stderr) }; } };

function montaje(l) { const m = l.regexp.source.match(/^\^((?:\\\/[^\\?()]+)*)\\\/\?\(\?=\\\/\|\$\)$/); return m ? m[1].replace(/\\\//g, '/') : ''; }
function rutas() {
  const out = [];
  (function recorre(stack, prefijo) {
    for (const l of stack) {
      if (l.route) for (const m of Object.keys(l.route.methods)) { const ruta = prefijo + l.route.path; out.push([m.toUpperCase(), ruta.length > 1 && ruta.endsWith('/') ? ruta.slice(0, -1) : ruta]); }
      else if (l.name === 'router' && l.handle.stack) recorre(l.handle.stack, prefijo + montaje(l));
    }
  })(app._router.stack, '');
  return out;
}
const PUBLICAS = new Set(['GET /api/catalogo', 'GET /api/catalogo/codigo-postal/:cp', 'GET /api/pedidos/disponibilidad', 'POST /api/pedidos/cotizar', 'POST /api/auth/login', 'POST /api/auth/register', 'POST /api/auth/olvide', 'POST /api/auth/restablecer', 'GET /api/salud', 'POST /api/pagos/webhook/stripe']);
function clasifica(m, p) {
  if (PUBLICAS.has(`${m} ${p}`)) return { tipo: 'publica' };
  if (['/api/admin', '/api/recetas', '/api/reportes', '/api/notificaciones', '/api/proveedores', '/api/pedidos-proveedor', '/api/decisiones', '/api/warehouse'].some((x) => p.startsWith(x))) return { tipo: 'roles', roles: ['admin'] };
  if (p.startsWith('/api/inventario')) return { tipo: 'roles', roles: ['almacen', 'admin'] };
  if (p.startsWith('/api/cocina')) return { tipo: 'roles', roles: ['cocina', 'admin'] };
  if (p === '/api/pedidos/checkout' || p.startsWith('/api/pedidos/checkout/') || (m === 'GET' && p === '/api/pedidos') || p.startsWith('/api/pagos/simulado') || p.startsWith('/api/avisos')) return { tipo: 'roles', roles: ['cliente'] };
  if (['/api/pedidos/:id', '/api/auth/me', '/api/auth/cambiar-password'].includes(p)) return { tipo: 'sesion' };
  return null;
}
const concreta = (p) => p.replace('/checkout/:id', '/checkout/00000000-0000-4000-8000-000000000000').replace('/simulado/:id', '/simulado/00000000-0000-4000-8000-000000000000').replace(/:id/g, '999999');

(async () => {
  const insumos0 = await q('SELECT * FROM insumos ORDER BY id');
  const movMax = (await q('SELECT coalesce(max(id),0) AS m FROM movimientos_inventario'))[0].m;
  const clientes = [], hijos = [];
  mail.reemplazar({ nombre: 'prueba', async enviar() {} });
  try {
    const login = async (c, pw = process.env.SEED_PASSWORD) => call('POST', '/api/auth/login', { correo: c, password: pw });
    const admin = (await login('admin@encombo.test')).j.token, almacen = (await login('almacen@encombo.test')).j.token, cocina = (await login('cocina@encombo.test')).j.token;
    const reg = async (tag, nombre = 'Cliente S6') => { const r = await call('POST', '/api/auth/register', { nombre, correo: `${tag}${R}@prueba.test`, password: 'secreta123' }); clientes.push(r.j.usuario.id); return { token: r.j.token, id: r.j.usuario.id, correo: `${tag}${R}@prueba.test` }; };
    const C = await reg('c6'), Otro = await reg('o6');
    const dia = (k) => svc.addDays(svc.todayMX(), 10 + (R % 40) + k);

    const U = await reg('p6');
    let r = await call('POST', '/api/auth/cambiar-password', { actual: 'secreta123', nueva: 'otra-clave-123' }); t('cambiar contraseña sin sesión → 401', r.s === 401);
    r = await call('POST', '/api/auth/cambiar-password', { actual: 'secreta123', nueva: 'corta' }, U.token); t('contraseña nueva muy corta → 400', r.s === 400);
    r = await call('POST', '/api/auth/cambiar-password', { actual: 'secreta123', nueva: 'x'.repeat(73) }, U.token); t('contraseña nueva de más de 72 bytes → 400', r.s === 400);
    r = await call('POST', '/api/auth/cambiar-password', { actual: 'secreta123', nueva: 'secreta123' }, U.token); t('la nueva igual a la actual → 400', r.s === 400);
    r = await call('POST', '/api/auth/cambiar-password', { actual: 'equivocada', nueva: 'otra-clave-123' }, U.token); t('contraseña actual incorrecta → 400 (no 401: no cierra la sesión)', r.s === 400 && /actual/.test(r.j.error));
    r = await call('POST', '/api/auth/cambiar-password', { nueva: 'otra-clave-123' }, U.token); t('sin la contraseña actual → 400', r.s === 400);
    const sinVersion = jwt.sign({ id: U.id }, process.env.JWT_SECRET);
    t('un token anterior al Sprint 6 (sin versión) sigue valiendo mientras no cambie la contraseña', (await call('GET', '/api/auth/me', undefined, sinVersion)).s === 200);
    r = await call('POST', '/api/auth/cambiar-password', { actual: 'secreta123', nueva: 'otra-clave-123' }, U.token);
    t('cambio correcto: devuelve una sesión nueva', r.s === 200 && r.j.ok && r.j.token && r.j.token !== U.token);
    const tokNuevo = r.j.token;
    t('la sesión anterior deja de servir (401)', (await call('GET', '/api/auth/me', undefined, U.token)).s === 401);
    t('el token del formato anterior también se invalida', (await call('GET', '/api/auth/me', undefined, sinVersion)).s === 401);
    t('la sesión nueva sí funciona', (await call('GET', '/api/auth/me', undefined, tokNuevo)).s === 200);
    t('la contraseña vieja ya no entra', (await login(U.correo, 'secreta123')).s === 401);
    t('la contraseña nueva entra', (await login(U.correo, 'otra-clave-123')).s === 200);
    t('la sesión de otra persona no se ve afectada', (await call('GET', '/api/auth/me', undefined, Otro.token)).s === 200);
    t('la contraseña no se guarda en claro ni viaja en ninguna respuesta', !(await q('SELECT password_hash FROM usuarios WHERE id=$1', [U.id]))[0].password_hash.includes('otra-clave') && !JSON.stringify((await call('GET', '/api/admin/usuarios', undefined, admin)).j).includes('password'));
    r = await call('PATCH', `/api/admin/usuarios/${U.id}/password`, { password: 'restablecida-99' }, almacen); t('restablecer contraseña: el almacén no puede → 403', r.s === 403);
    r = await call('PATCH', `/api/admin/usuarios/${U.id}/password`, { password: 'corta' }, admin); t('restablecer con contraseña corta → 400', r.s === 400);
    r = await call('PATCH', '/api/admin/usuarios/abc/password', { password: 'restablecida-99' }, admin); t('restablecer con id inválido → 400', r.s === 400);
    r = await call('PATCH', '/api/admin/usuarios/999999/password', { password: 'restablecida-99' }, admin); t('restablecer a un usuario inexistente → 404', r.s === 404);
    r = await call('PATCH', `/api/admin/usuarios/${U.id}/password`, { password: 'restablecida-99' }, admin); t('el administrador restablece la contraseña', r.s === 200);
    t('…y se cierran todas las sesiones de ese usuario', (await call('GET', '/api/auth/me', undefined, tokNuevo)).s === 401);
    t('…y entra con la contraseña restablecida', (await login(U.correo, 'restablecida-99')).s === 200);

    const valido = C.token, partes = valido.split('.');
    const casos = [['firmado con otra llave', jwt.sign({ id: C.id, v: 0 }, 'otra-llave-que-no-es-la-del-servidor-123456')], ['sin firma (alg none)', `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ id: C.id, v: 0 })}.`],
      ['cuerpo alterado (otro id) con la firma original', `${partes[0]}.${b64({ id: 1, v: 0 })}.${partes[2]}`], ['expirado', jwt.sign({ id: C.id, v: 0, exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET)],
      ['de una versión distinta', jwt.sign({ id: C.id, v: 7 }, process.env.JWT_SECRET)], ['de un usuario que no existe', jwt.sign({ id: 999999, v: 0 }, process.env.JWT_SECRET)], ['basura', 'esto.no.es.un.token'], ['vacío', '']];
    for (const [n, tok] of casos) { r = await call('GET', '/api/auth/me', undefined, tok); t(`token ${n} → 401`, r.s === 401, r.s); }
    r = await call('GET', '/api/auth/me', undefined, undefined, { Authorization: 'Basic ' + Buffer.from('a:b').toString('base64') }); t('esquema de autorización distinto de Bearer → 401', r.s === 401);
    const del = await reg('d6'); await db.query('UPDATE usuarios SET activo=false WHERE id=$1', [del.id]);
    t('el token de un usuario dado de baja → 401', (await call('GET', '/api/auth/me', undefined, del.token)).s === 401);

    r = await call('GET', '/api/salud'); t('/api/salud responde ok sin sesión y sin detalles internos', r.s === 200 && r.j.estado === 'ok' && r.j.version && !/postgres|password|secret/i.test(r.texto));
    r = await call('GET', '/api/catalogo', undefined, undefined, { Origin: 'https://sitio-malicioso.example' });
    t('no hay CORS: ningún otro sitio puede leer la API desde el navegador', !r.h.get('access-control-allow-origin'));
    const h = r.h;
    t('cabeceras de seguridad: sin x-powered-by, nosniff, CSP "self", HSTS y anti-iframe', !h.get('x-powered-by') && h.get('x-content-type-options') === 'nosniff' && /default-src 'self'/.test(h.get('content-security-policy')) && /script-src 'self'/.test(h.get('content-security-policy')) && !!h.get('strict-transport-security') && !!h.get('x-frame-options'));
    const crudo = (p) => new Promise((ok) => http.get({ host: 'localhost', port: PORT, path: p }, (x) => { let d = ''; x.on('data', (c) => { d += c; }); x.on('end', () => ok({ s: x.statusCode, d })); }));
    for (const p of ['/.env', '/package.json', '/src/config.js', '/scripts/seed.js', '/db/schema.sql', '/node_modules/express/package.json', '/README.md', '/../.env', '/%2e%2e/.env', '/..%2f..%2f.env', '/public/../.env']) {
      const x = await crudo(p); t(`archivo interno no expuesto: ${p}`, x.s !== 200 || !/JWT_SECRET|DATABASE_URL|CREATE TABLE|require\(/.test(x.d), `${x.s}`);
    }
    t('el sitio público sí se sirve (index y scripts)', (await crudo('/')).s === 200 && (await crudo('/app.js')).s === 200);
    r = await call('POST', '/api/auth/login', 'x'.repeat(150000)); t('cuerpo de más de 100 KB → 413', r.s === 413);
    r = await call('POST', '/api/auth/login', '{json roto'); t('JSON roto → 400 sin detalles internos', r.s === 400 && !/at |Error:/.test(r.texto));
    r = await call('POST', '/api/auth/register', { nombre: { $ne: 1 }, correo: ['a@b.co'], password: { x: 1 } }); t('tipos inesperados (objetos/arreglos) → 400, no 500', r.s === 400);
    r = await call('POST', '/api/auth/login', { correo: { $gt: '' }, password: { $gt: '' } }); t('inyección tipo NoSQL en el login → 401', r.s === 401);
    const dup = await Promise.all([1, 2, 3].map(() => call('POST', '/api/auth/register', { nombre: 'Carrera', correo: `carrera${R}@prueba.test`, password: 'secreta123' })));
    const idsC = await q('SELECT id FROM usuarios WHERE correo=$1', [`carrera${R}@prueba.test`]); idsC.forEach((x) => clientes.push(x.id));
    t('3 registros simultáneos del mismo correo: uno se crea y dos se rechazan', dup.filter((x) => x.s === 201).length === 1 && dup.filter((x) => x.s === 409).length === 2 && idsC.length === 1);

    const todas = rutas();
    t(`se descubrieron las rutas del servidor (${todas.length})`, todas.length >= 40, String(todas.length));
    const sinClasificar = todas.filter(([m, p]) => !clasifica(m, p));
    t('toda ruta está clasificada (si agregas una nueva, esta prueba te obliga a decidir quién puede usarla)', sinClasificar.length === 0, sinClasificar.map((x) => x.join(' ')).join(', '));
    const roles = { cliente: C.token, cocina, almacen, admin };
    let fallos = [], revisadas = 0;
    for (const [m, p] of todas) {
      const c = clasifica(m, p); if (!c || c.tipo === 'publica') continue;
      const url = concreta(p), cuerpo = ['POST', 'PUT', 'PATCH'].includes(m) ? {} : undefined;
      const sin = await call(m, url, cuerpo); revisadas++;
      if (!(sin.s === 401 || (url.includes('/pagos/simulado') && sin.s === 404))) fallos.push(`${m} ${p} sin sesión → ${sin.s}`);
      for (const [rol, tok] of Object.entries(roles)) {
        const x = await call(m, url, cuerpo, tok); revisadas++;
        const permitido = c.tipo === 'sesion' || c.roles.includes(rol);
        if (permitido && (x.s === 401 || x.s === 403)) fallos.push(`${m} ${p} con ${rol} debería pasar → ${x.s}`);
        if (!permitido && x.s !== 403) fallos.push(`${m} ${p} con ${rol} debería ser 403 → ${x.s}`);
      }
    }
    t(`permisos: ${revisadas} combinaciones ruta × rol, todas correctas (sin sesión 401; rol no permitido 403; rol permitido pasa)`, fallos.length === 0, fallos.slice(0, 6).join(' | '));
    for (const [m, p] of todas.filter(([m, p]) => clasifica(m, p) && clasifica(m, p).tipo === 'publica' && !p.includes('webhook') && p !== '/api/auth/login')) {
      const x = await call(m, p, m === 'POST' ? {} : undefined); t(`ruta pública ${m} ${p}: responde sin sesión`, x.s !== 401 && x.s !== 403 && x.s < 500, String(x.s));
    }
    t('la tabla de insumos sigue intacta tras el barrido (ningún DELETE destructivo)', (await q('SELECT count(*)::int n FROM insumos'))[0].n === insumos0.length);

    const cat = (await call('GET', '/api/catalogo')).j; const P = (n) => cat.productos.find((p) => p.nombre === n).id; const PRES = undefined;
    const combo = (o = {}) => ({ items: [{ producto_id: P('Cupcake'), cantidad: 2 }], presentacion_id: PRES, fecha: dia(0), hora: '12:00', direccion: { cp: '91190', colonia: 'Las Flores', calle: 'Calle de Prueba', num_ext: '12' }, ...o });
    const t0 = Date.now();
    const cot = await Promise.all(Array.from({ length: 150 }, () => call('POST', '/api/pedidos/cotizar', combo())));
    t(`150 cotizaciones simultáneas sin un solo error (${Date.now() - t0} ms)`, cot.every((x) => x.s === 200 && x.j.ok));
    const comprar = async (i) => {
      const ck = await call('POST', '/api/pedidos/checkout', combo({ items: [{ producto_id: P('Galleta'), cantidad: 1 }], fecha: dia(1 + i), hora: '10:00' }), C.token);
      return ck.s === 201 ? call('POST', `/api/pagos/simulado/${ck.j.checkout_id}/aprobar`, undefined, C.token) : ck;
    };
    const harinaAntesCompras = Number((await q("SELECT stock FROM insumos WHERE nombre='Harina'"))[0].stock), cajaAntesCompras = Number((await q("SELECT stock FROM insumos WHERE nombre='Caja mediana'"))[0].stock);
    const compras = await Promise.all(Array.from({ length: 14 }, (_, i) => comprar(i)));
    t('14 compras simultáneas (14 fechas distintas) terminan todas en pedido pagado, sin bloqueos', compras.every((x) => x.j.estado === 'pagado'), JSON.stringify(compras.map((x) => x.s + ':' + (x.j.estado || x.j.error)).slice(0, 4)));
    const harinaDespues = Number((await q("SELECT stock FROM insumos WHERE nombre='Harina'"))[0].stock), cajaDespues = Number((await q("SELECT stock FROM insumos WHERE nombre='Caja mediana'"))[0].stock);
    t('…y el inventario cuadra exactamente (14 galletas = 420 g de harina y ya no se descuentan cajas)', Math.abs((harinaAntesCompras - harinaDespues) - 420) < 1e-6 && Math.abs(cajaAntesCompras - cajaDespues) < 1e-6, `${harinaAntesCompras - harinaDespues}`);
    const harina = (await q("SELECT id,stock FROM insumos WHERE nombre='Harina'"))[0];
    await Promise.all(Array.from({ length: 40 }, () => call('POST', `/api/inventario/${harina.id}/movimientos`, { tipo: 'entrada', cantidad: 1 }, almacen)));
    const h2 = Number((await q('SELECT stock FROM insumos WHERE id=$1', [harina.id]))[0].stock);
    t('40 movimientos de inventario simultáneos: se aplican los 40, ninguno se pierde', Math.abs(h2 - (Number(harina.stock) + 40)) < 1e-6, `${h2} vs ${Number(harina.stock) + 40}`);

    const ADM = `adm6${R}@prueba.test`; clientes.push(0);
    let x = run(['scripts/crear-admin.js'], { ADMIN_EMAIL: ADM, ADMIN_NAME: 'Admin Prueba', ADMIN_PASSWORD: 'clave-de-admin-1' });
    t('crear-admin: crea el administrador', x.code === 0 && /Administrador creado/.test(x.out));
    r = await login(ADM, 'clave-de-admin-1'); t('…y ese administrador inicia sesión con rol admin', r.s === 200 && r.j.usuario.rol === 'admin');
    const tokAdm = r.j.token;
    x = run(['scripts/crear-admin.js'], { ADMIN_EMAIL: ADM, ADMIN_NAME: 'Admin Prueba', ADMIN_PASSWORD: 'otra-clave-1234' });
    t('crear-admin: no pisa a un usuario existente sin --reiniciar', x.code === 1 && /Ya existe/.test(x.out) && (await login(ADM, 'clave-de-admin-1')).s === 200);
    x = run(['scripts/crear-admin.js', '--reiniciar'], { ADMIN_EMAIL: ADM, ADMIN_NAME: 'Admin Prueba', ADMIN_PASSWORD: 'otra-clave-1234' });
    t('crear-admin --reiniciar: cambia la contraseña y cierra sus sesiones', x.code === 0 && (await login(ADM, 'otra-clave-1234')).s === 200 && (await call('GET', '/api/auth/me', undefined, tokAdm)).s === 401);
    for (const [n, env] of [['correo inválido', { ADMIN_EMAIL: 'no-es-correo', ADMIN_PASSWORD: 'clave-larga-123' }], ['contraseña corta', { ADMIN_EMAIL: ADM, ADMIN_PASSWORD: 'corta' }], ['sin datos', {}]]) {
      x = run(['scripts/crear-admin.js'], { ADMIN_EMAIL: '', ADMIN_PASSWORD: '', ...env }); t(`crear-admin rechaza: ${n}`, x.code === 1 && /✖/.test(x.out));
    }
    const prod = { NODE_ENV: 'production', PAYMENT_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_test_falsa', STRIPE_WEBHOOK_SECRET: 'whsec_falsa', MAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_falsa', MAIL_FROM: 'a@b.co', PUBLIC_URL: 'https://demo.example.com', TRUST_PROXY: '1', DATABASE_SSL: 'false' };
    x = run(['scripts/verificar-despliegue.js'], prod);
    t('verificar: con configuración de producción completa pasa, con avisos', x.code === 0 && /✔ Conexión a la base de datos/.test(x.out) && /✔ El esquema/.test(x.out) && /⚠ Stripe está con llaves de PRUEBA/.test(x.out) && /Listo para publicar/.test(x.out), x.out);
    t('verificar: avisa de las cuentas de prueba activas', /⚠ Hay \d+ cuenta\(s\) de prueba activa/.test(x.out));
    x = run(['scripts/verificar-despliegue.js'], { ...prod, JWT_SECRET: 'a'.repeat(40) }); t('verificar: un JWT_SECRET simple es un error', x.code === 1 && /✖ JWT_SECRET demasiado simple/.test(x.out));
    x = run(['scripts/verificar-despliegue.js'], { ...prod, PAYMENT_PROVIDER: 'simulado' }); t('verificar: pago simulado en producción es un error', x.code === 1 && /✖ Configuración inválida/.test(x.out));
    x = run(['scripts/verificar-despliegue.js'], { ...prod, PUBLIC_URL: 'http://demo.example.com' }); t('verificar: PUBLIC_URL sin https en producción es un error', x.code === 1 && /✖ PUBLIC_URL no usa https/.test(x.out));
    x = run(['scripts/verificar-despliegue.js'], { ...prod, MAIL_PROVIDER: 'consola' }); t('verificar: correo simulado en producción es un error', x.code === 1 && /✖/.test(x.out));

    const puerto = 3300 + (R % 600);
    const hijo = spawn('node', ['src/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(puerto), AUTH_RATE_LIMIT: '', MAIL_PROVIDER: 'consola' } }); hijos.push(hijo);
    let salida = ''; hijo.stdout.on('data', (d) => { salida += d; }); hijo.stderr.on('data', (d) => { salida += d; });
    const listo = await (async () => { for (let i = 0; i < 80; i++) { if (/escuchando/.test(salida)) return true; await sleep(100); } return false; })();
    t('el servidor arranca con `node src/server.js`', listo, salida);
    const rs = await fetch(`http://localhost:${puerto}/api/salud`).then((x) => x.json()).catch(() => ({})); t('…y responde en /api/salud', rs.estado === 'ok');
    let primero429 = 0;
    for (let i = 1; i <= 30; i++) { const x2 = await fetch(`http://localhost:${puerto}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: 'victima@prueba.test', password: 'intento' + i }) }); if (x2.status === 429) { primero429 = i; t('límite de intentos: tras 20 intentos fallidos responde 429 con mensaje claro', i === 21 && /Demasiados intentos/.test((await x2.json()).error), `en el intento ${i}`); break; } }
    t('límite de intentos: se activó', primero429 > 0);
    const salio = new Promise((ok) => hijo.on('exit', (code) => ok(code)));
    hijo.kill('SIGTERM');
    const codigo = await Promise.race([salio, sleep(8000).then(() => 'tiempo agotado')]);
    t('apagado ordenado: SIGTERM cierra el servidor con código 0 y lo avisa', codigo === 0 && /cerrando/.test(salida), `${codigo} ${salida}`);
  } catch (e) {
    fail++; console.log('FAIL error inesperado:', e);
  } finally {
    try {
      for (const h of hijos) { try { h.kill('SIGKILL'); } catch (e) {  } }
      mail.reemplazar(null);
      const ids = clientes.filter(Boolean);
      await db.query("DELETE FROM usuarios WHERE correo = $1", [`adm6${R}@prueba.test`]).catch(() => {});
      await db.query('DELETE FROM checkouts WHERE cliente_id = ANY($1)', [ids]);
      await db.query('DELETE FROM movimientos_inventario WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ANY($1))', [ids]);
      await db.query('DELETE FROM pagos WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ANY($1))', [ids]);
      await db.query('DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ANY($1))', [ids]);
      await db.query('DELETE FROM pedidos WHERE cliente_id = ANY($1)', [ids]);
      await db.query('DELETE FROM usuarios WHERE id = ANY($1)', [ids]);
      await db.query('DELETE FROM movimientos_inventario WHERE id > $1', [movMax]);
      for (const i of insumos0) await db.query('UPDATE insumos SET stock=$2,stock_minimo=$3,costo_unitario=$4,activo=$5 WHERE id=$1', [i.id, i.stock, i.stock_minimo, i.costo_unitario, i.activo]);
    } catch (e) { console.log('Aviso: limpieza incompleta:', e.message); }
    console.log(`\n${pass} correctas, ${fail} fallidas`);
    server.close(); await db.pool.end(); process.exit(fail ? 1 : 0);
  }
})();

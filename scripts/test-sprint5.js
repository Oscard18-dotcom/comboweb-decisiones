const http = require('http');
const { execFileSync } = require('child_process');
const { SMTPServer } = require('smtp-server');
const { simpleParser } = require('mailparser');
const app = require('../src/app');
const db = require('../src/db');
const svc = require('../src/services/pedidos');
const notif = require('../src/services/notificaciones');
const mail = require('../src/mail');

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const server = app.listen(0);
const B = `http://localhost:${server.address().port}`;
async function call(m, p, body, tok) {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const tipo = r.headers.get('content-type') || '';
  let j = {}; let texto = ''; try { texto = Buffer.from(await r.arrayBuffer()).toString('utf8'); if (tipo.includes('json')) j = JSON.parse(texto); } catch (e) {  }
  return { s: r.status, j, texto, tipo, h: r.headers };
}
const R = Date.now();
const q = async (sql, p) => (await db.query(sql, p)).rows;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, e = 0.005) => Math.abs(a - b) < e;
async function esperar(fn, ms = 4000) { const s = Date.now(); while (Date.now() - s < ms) { const v = await fn(); if (v) return v; await sleep(40); } return null; }
const mondayOf = (iso) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

(async () => {
  const insumos0 = await q('SELECT * FROM insumos ORDER BY id');
  const movMax = (await q('SELECT coalesce(max(id),0) AS m FROM movimientos_inventario'))[0].m;
  const clientes = [];
  const servidores = [];
  const enviados = []; const modo = { falla: false, demora: 0 };
  const mock = { nombre: 'prueba', async enviar(m) { if (modo.demora) await sleep(modo.demora); if (modo.falla) throw new Error('SMTP caído'); enviados.push(m); } };
  mail.reemplazar(mock);
  try {
    const login = async (c) => (await call('POST', '/api/auth/login', { correo: c, password: process.env.SEED_PASSWORD })).j.token;
    const admin = await login('admin@encombo.test'), almacen = await login('almacen@encombo.test'), cocina = await login('cocina@encombo.test');
    const idCocina = (await q("SELECT id FROM usuarios WHERE correo='cocina@encombo.test'"))[0].id;
    const reg = async (nombre, tag) => { const r = await call('POST', '/api/auth/register', { nombre, correo: `${tag}${R}@prueba.test`, password: 'secreta123' }); clientes.push(r.j.usuario.id); return { token: r.j.token, id: r.j.usuario.id, correo: `${tag}${R}@prueba.test` }; };
    const A = await reg('Ana <b>López</b> & "Co"', 'a5'), Bc = await reg('Beto Ruiz', 'b5'), Rep = await reg('Cliente Reportes', 'r5');
    const D = svc.addDays(svc.todayMX(), 10 + Math.floor(Math.random() * 40));
    const cat = (await call('GET', '/api/catalogo')).j; const P = (n) => cat.productos.find((p) => p.nombre === n).id; const PRES = undefined;
    const comprar = async (cl, items, fecha, hora, dedicatoria) => {
      const ck = await call('POST', '/api/pedidos/checkout', { items, presentacion_id: PRES, fecha, hora, dedicatoria, direccion: { cp: '91190', colonia: 'Las Flores', calle: 'Calle de Prueba', num_ext: '12' } }, cl.token);
      const ap = await call('POST', `/api/pagos/simulado/${ck.j.checkout_id}/aprobar`, undefined, cl.token);
      return ap.j.pedido_id;
    };
    const drenar = async () => { for (let i = 0; i < 80; i++) { const n = (await q("SELECT count(*)::int n FROM notificaciones WHERE estado IN ('pendiente','enviando') AND cliente_id = ANY($1)", [clientes]))[0].n; if (!n) return; await notif.enviarPendientes(); await sleep(40); } };
    const patch = (id, estatus, tok = cocina) => call('PATCH', `/api/cocina/pedidos/${id}/estatus`, { estatus }, tok);
    const tablero = async (f, tok = cocina) => (await call('GET', `/api/cocina/pedidos?fecha=${f}`, undefined, tok)).j;

    let r = await call('GET', '/api/cocina/pedidos'); t('cocina: sin sesión → 401', r.s === 401);
    r = await call('GET', '/api/cocina/pedidos', undefined, A.token); t('cocina: un cliente → 403', r.s === 403);
    r = await call('GET', '/api/cocina/pedidos', undefined, almacen); t('cocina: el encargado de almacén → 403', r.s === 403);
    r = await call('GET', '/api/cocina/pedidos', undefined, cocina); t('cocina: el operador de cocina entra', r.s === 200);
    r = await call('GET', '/api/cocina/pedidos', undefined, admin); t('cocina: el administrador entra', r.s === 200);
    for (const [n, tok] of [['almacén', almacen], ['cocina', cocina], ['cliente', A.token]]) { r = await call('GET', '/api/reportes/dashboard', undefined, tok); t(`reportes: ${n} → 403`, r.s === 403); }
    r = await call('GET', '/api/reportes/dashboard'); t('reportes: sin sesión → 401', r.s === 401);
    r = await call('GET', '/api/notificaciones', undefined, cocina); t('notificaciones: cocina → 403', r.s === 403);

    const o1 = await comprar(A, [{ producto_id: P('Cupcake'), cantidad: 6 }, { producto_id: P('Café latte'), cantidad: 2 }], D, '14:00', 'Feliz cumpleaños');
    const o2 = await comprar(Bc, [{ producto_id: P('Galleta'), cantidad: 4 }], D, '09:00');
    const o3 = await comprar(A, [{ producto_id: P('Brownie'), cantidad: 2 }], D, '12:00');
    const base = (await q('SELECT presentacion_id FROM pedidos WHERE id=$1', [o1]))[0];
    const viejo = (await q("INSERT INTO pedidos(cliente_id,presentacion_id,fecha_entrega,hora_entrega,total,estatus) VALUES($1,$2,$3,'08:00',10,'Pendiente') RETURNING id", [Bc.id, base.presentacion_id, svc.addDays(D, -3)]))[0].id;
    const viejoEnt = (await q("INSERT INTO pedidos(cliente_id,presentacion_id,fecha_entrega,hora_entrega,total,estatus) VALUES($1,$2,$3,'08:00',10,'Entregado') RETURNING id", [Bc.id, base.presentacion_id, svc.addDays(D, -3)]))[0].id;
    const futuro = (await q("INSERT INTO pedidos(cliente_id,presentacion_id,fecha_entrega,hora_entrega,total,estatus) VALUES($1,$2,$3,'08:00',10,'Pendiente') RETURNING id", [Bc.id, base.presentacion_id, svc.addDays(D, 1)]))[0].id;
    const tb = await tablero(D);
    t('el tablero lista en orden cronológico (los atrasados primero)', tb.pedidos.map((p) => p.id).join() === [viejo, o2, o3, o1].join(), tb.pedidos.map((p) => p.id + '@' + p.fecha + ' ' + p.hora).join(' | '));
    t('marca como atrasado el pedido de un día anterior sin entregar', tb.pedidos[0].atrasado === true && tb.pedidos[1].atrasado === false);
    t('no muestra los ya entregados de días anteriores ni los de otros días', !tb.pedidos.some((p) => p.id === viejoEnt || p.id === futuro));
    t('el resumen cuenta pedidos por estatus', tb.resumen.Pendiente === 4 && tb.resumen['En preparación'] === 0 && tb.resumen.Entregado === 0);
    const f1 = tb.pedidos.find((p) => p.id === o1);
    t('ficha técnica: folio, cliente, presentación, dedicatoria, hora y piezas', /^EC-\d{4,}$/.test(f1.folio) && f1.cliente.startsWith('Ana') && f1.presentacion == null && f1.dedicatoria === 'Feliz cumpleaños' && f1.hora === '14:00' && f1.items.length === 2);
    const ingr = Object.fromEntries(f1.ingredientes.map((i) => [i.nombre, i.cantidad]));
    t('ficha técnica: ingredientes exactos según las recetas', ingr.Harina === 240 && ingr['Azúcar'] === 180 && ingr.Mantequilla === 120 && ingr['Café molido'] === 36 && ingr.Leche === 400 && !('Caja mediana' in ingr), JSON.stringify(ingr));
    t('la cocina no ve precios ni totales', !('total' in f1) && !('precio' in f1));
    r = await call('GET', '/api/cocina/pedidos?fecha=2026-13-45', undefined, cocina); t('fecha inválida → 400', r.s === 400);
    r = await call('GET', `/api/cocina/pedidos/${o2}`, undefined, cocina); t('ficha individual de un pedido', r.s === 200 && r.j.pedido.id === o2 && r.j.pedido.ingredientes.length === 3);
    r = await call('GET', '/api/cocina/pedidos/999999', undefined, cocina); t('ficha de un pedido inexistente → 404', r.s === 404);

    r = await patch(o2, 'Listo para entrega'); t('saltar de Pendiente a Listo → 409 y no cambia', r.s === 409 && /En preparación/.test(r.j.error) && (await q('SELECT estatus FROM pedidos WHERE id=$1', [o2]))[0].estatus === 'Pendiente', r.j.error);
    r = await patch(o2, 'Entregado'); t('saltar de Pendiente a Entregado → 409', r.s === 409);
    r = await patch(o2, 'Pendiente'); t('regresar a Pendiente → 409', r.s === 409);
    r = await patch(o2, 'Cancelado'); t('estatus inexistente → 400', r.s === 400);
    r = await call('PATCH', `/api/cocina/pedidos/${o2}/estatus`, {}, cocina); t('sin estatus → 400', r.s === 400);
    r = await patch(999999, 'En preparación'); t('estatus de un pedido inexistente → 404', r.s === 404);
    r = await patch(o2, 'En preparación', A.token); t('un cliente no puede cambiar estatus → 403', r.s === 403);
    r = await patch(o2, 'En preparación'); t('Pendiente → En preparación', r.s === 200 && r.j.sin_cambio === false && r.j.pedido.estatus === 'En preparación');
    r = await patch(o2, 'En preparación'); t('repetir el mismo estatus (doble clic) no hace nada', r.s === 200 && r.j.sin_cambio === true);
    t('el historial no se duplica con el doble clic', (await q('SELECT count(*)::int n FROM pedido_estatus_historial WHERE pedido_id=$1', [o2]))[0].n === 2);
    r = await patch(o2, 'Listo para entrega'); t('En preparación → Listo para entrega', r.s === 200 && r.j.sin_cambio === false);
    r = await patch(o2, 'En preparación'); t('regresar un estatus → 409', r.s === 409 && /Listo para entrega/.test(r.j.error) && /Entregado/.test(r.j.error));
    r = await patch(o2, 'Entregado'); t('Listo → Entregado', r.s === 200 && r.j.sin_cambio === false);
    r = await patch(o2, 'Listo para entrega'); t('un pedido Entregado ya no cambia → 409', r.s === 409 && /ya no puede cambiar/.test(r.j.error));
    const hist = await q('SELECT h.estatus,h.usuario_id,h.creado_en FROM pedido_estatus_historial h WHERE pedido_id=$1 ORDER BY id', [o2]);
    t('historial: 4 estatus en orden, con quién y cuándo', hist.map((x) => x.estatus).join() === 'Pendiente,En preparación,Listo para entrega,Entregado' && hist.slice(1).every((x) => x.usuario_id === idCocina) && hist.every((x, i) => i === 0 || x.creado_en >= hist[i - 1].creado_en));
    r = await patch(o3, 'En preparación', admin); t('el administrador también puede cambiar el estatus', r.s === 200 && (await q('SELECT usuario_id FROM pedido_estatus_historial WHERE pedido_id=$1 AND estatus=$2', [o3, 'En preparación']))[0].usuario_id !== idCocina);
    const [p1, p2] = await Promise.all([patch(o1, 'En preparación'), patch(o1, 'En preparación', admin)]);
    t('dos personas pulsando a la vez: solo una hace el cambio', [p1.j.sin_cambio, p2.j.sin_cambio].sort().join() === 'false,true' && (await q('SELECT count(*)::int n FROM pedido_estatus_historial WHERE pedido_id=$1', [o1]))[0].n === 2);
    t('…y el cliente recibe un solo aviso', (await q("SELECT count(*)::int n FROM notificaciones WHERE pedido_id=$1 AND plantilla='En preparación'", [o1]))[0].n === 1);
    r = await call('GET', `/api/pedidos/${o2}`, undefined, Bc.token);
    t('seguimiento del cliente: estatus actual y línea de tiempo con fechas', r.j.pedido.estatus === 'Entregado' && r.j.pedido.historial.length === 4 && r.j.pedido.historial.every((h) => h.creado_en));
    r = await call('GET', '/api/pedidos', undefined, Bc.token); t('Mis pedidos también trae el historial', r.j.pedidos.find((x) => x.id === o2).historial.length === 4);
    const tb2 = await tablero(D); t('el tablero refleja los estatus nuevos', tb2.resumen.Entregado === 1 && tb2.resumen['En preparación'] === 2 && tb2.resumen.Pendiente === 1, JSON.stringify(tb2.resumen));

    await drenar();
    const aB = enviados.filter((m) => m.a === Bc.correo);
    const asuntos = aB.map((m) => m.asunto);
    const f2 = `EC-${String(o2).padStart(4, '0')}`;
    t('el cliente recibe un correo por cada cambio, una sola vez y en orden', JSON.stringify(asuntos) === JSON.stringify([`Pedido ${f2} confirmado`, `Tu pedido ${f2} está en preparación`, `Tu pedido ${f2} está listo para entrega`, `Tu pedido ${f2} fue entregado`]), JSON.stringify(asuntos));
    const m1 = aB.find((m) => /en preparación/.test(m.asunto));
    t('el correo trae nombre, folio, fecha y hora de entrega', /Beto Ruiz/.test(m1.texto) && m1.texto.includes(f2) && m1.texto.includes(D) && m1.texto.includes('09:00'));
    const mA = enviados.find((m) => m.a === A.correo);
    t('el nombre del cliente se escapa en el HTML (no se inyecta código)', mA.html.includes('&lt;b&gt;L') && !mA.html.includes('<b>L') && mA.texto.includes('<b>López</b>') && !/[<>]/.test(mA.asunto));
    t('cada notificación quedó marcada como enviada', (await q("SELECT count(*)::int n FROM notificaciones WHERE cliente_id=$1 AND estado<>'enviada'", [Bc.id]))[0].n === 0);

    modo.falla = true;
    r = await patch(o3, 'Listo para entrega', admin);
    t('si el correo falla, el cambio de estatus SÍ se hace (200)', r.s === 200 && (await q('SELECT estatus FROM pedidos WHERE id=$1', [o3]))[0].estatus === 'Listo para entrega');
    const nf = await esperar(async () => (await q("SELECT * FROM notificaciones WHERE pedido_id=$1 AND plantilla='Listo para entrega' AND estado='error'", [o3]))[0]);
    t('la notificación queda en "error" con el motivo y la hora del próximo intento', nf && nf.intentos === 1 && /SMTP caído/.test(nf.ultimo_error) && new Date(nf.proximo_intento) > new Date());
    await notif.enviarPendientes();
    t('no se reintenta antes de tiempo', (await q('SELECT intentos FROM notificaciones WHERE id=$1', [nf.id]))[0].intentos === 1);
    modo.falla = false; await db.query("UPDATE notificaciones SET proximo_intento = now() - interval '1 minute' WHERE id=$1", [nf.id]);
    const antes = enviados.length; await notif.enviarPendientes();
    const nf2 = (await q('SELECT * FROM notificaciones WHERE id=$1', [nf.id]))[0];
    t('al volver el servicio de correo, el reintento lo envía', nf2.estado === 'enviada' && nf2.intentos === 2 && nf2.enviada_en && enviados.length === antes + 1);

    modo.falla = true;
    const o4 = await comprar(Bc, [{ producto_id: P('Galleta'), cantidad: 1 }], D, '16:00');
    const nid = (await esperar(async () => (await q("SELECT id FROM notificaciones WHERE pedido_id=$1 AND estado='error'", [o4]))[0])).id;
    for (let i = 0; i < 4; i++) { await db.query("UPDATE notificaciones SET proximo_intento = now() - interval '1 minute' WHERE id=$1", [nid]); await notif.enviarPendientes(); }
    const nfin = (await q('SELECT estado,intentos FROM notificaciones WHERE id=$1', [nid]))[0];
    t('tras 5 intentos fallidos queda "fallida" y deja de reintentarse', nfin.estado === 'fallida' && nfin.intentos === 5);
    await db.query("UPDATE notificaciones SET proximo_intento = now() - interval '1 minute' WHERE id=$1", [nid]); await notif.enviarPendientes();
    t('una fallida no se vuelve a intentar sola', (await q('SELECT intentos FROM notificaciones WHERE id=$1', [nid]))[0].intentos === 5);
    r = await call('GET', '/api/notificaciones?estado=fallida', undefined, admin); t('el administrador ve las fallidas', r.s === 200 && r.j.notificaciones.some((x) => x.id === nid && x.ultimo_error && x.folio));
    modo.falla = false;
    r = await call('POST', `/api/notificaciones/${nid}/reintentar`, undefined, admin); t('el administrador puede reintentarla y se envía', r.s === 200 && r.j.notificacion.estado === 'enviada');
    r = await call('POST', `/api/notificaciones/${nid}/reintentar`, undefined, admin); t('reintentar una ya enviada → 409', r.s === 409);
    r = await call('POST', '/api/notificaciones/abc/reintentar', undefined, admin); t('reintentar con identificador inválido → 400', r.s === 400);

    enviados.length = 0; modo.demora = 40;
    for (let i = 0; i < 6; i++) await db.query("INSERT INTO notificaciones(pedido_id,cliente_id,plantilla,destinatario,asunto,cuerpo_texto,cuerpo_html) VALUES($1,$2,$3,$4,$5,'x','x')", [o2, Bc.id, 'conc-' + i, `conc${i}@prueba.test`, 'Concurrencia ' + i]);
    await Promise.all([notif.enviarPendientes(), notif.enviarPendientes(), notif.enviarPendientes()]);
    modo.demora = 0;
    const cnt = {}; for (const m of enviados) cnt[m.asunto] = (cnt[m.asunto] || 0) + 1;
    t('3 procesos enviando a la vez: cada correo sale exactamente una vez', Object.keys(cnt).length === 6 && Object.values(cnt).every((n) => n === 1), JSON.stringify(cnt));
    const x1 = (await q("SELECT id FROM notificaciones WHERE plantilla='conc-0'"))[0].id, x2 = (await q("SELECT id FROM notificaciones WHERE plantilla='conc-1'"))[0].id;
    await db.query("UPDATE notificaciones SET estado='enviando', intentos=1, reclamado_en = now() - interval '10 minutes' WHERE id=$1", [x1]);
    await db.query("UPDATE notificaciones SET estado='enviando', intentos=1, reclamado_en = now() - interval '1 minute' WHERE id=$1", [x2]);
    enviados.length = 0; await notif.enviarPendientes();
    t('rescata un envío atascado (más de 5 min) pero respeta uno en curso', enviados.length === 1 && enviados[0].asunto === 'Concurrencia 0' && (await q('SELECT estado FROM notificaciones WHERE id=$1', [x2]))[0].estado === 'enviando');

    const arranca = (env) => { try { execFileSync('node', ['-e', "require('./src/config')"], { env: { ...process.env, ...env }, stdio: 'pipe' }); return true; } catch (e) { return String(e.stderr); } };
    t('producción con correo simulado: el servidor se niega a arrancar', /producción/.test(arranca({ NODE_ENV: 'production', MAIL_PROVIDER: 'consola', PAYMENT_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' })));
    t('smtp sin servidor configurado: se niega a arrancar', /SMTP_HOST/.test(arranca({ MAIL_PROVIDER: 'smtp', SMTP_HOST: '', MAIL_FROM: '' })));
    t('resend sin llave: se niega a arrancar', /RESEND_API_KEY/.test(arranca({ MAIL_PROVIDER: 'resend', RESEND_API_KEY: '', MAIL_FROM: 'a@b.c' })));
    t('proveedor de correo desconocido: se niega a arrancar', /MAIL_PROVIDER/.test(arranca({ MAIL_PROVIDER: 'palomas' })));
    t('configuración smtp completa: arranca', arranca({ MAIL_PROVIDER: 'smtp', SMTP_HOST: 'localhost', MAIL_FROM: 'a@b.c' }) === true);

    const recibidos = [];
    const smtp = new SMTPServer({ authOptional: false, allowInsecureAuth: true, disabledCommands: ['STARTTLS'],
      onAuth(auth, s, cb) { auth.username === 'usuario' && auth.password === 'clave-buena' ? cb(null, { user: 1 }) : cb(new Error('Credenciales inválidas')); },
      onData(stream, s, cb) { simpleParser(stream).then((m) => { recibidos.push(m); cb(); }).catch(cb); } });
    await new Promise((ok) => smtp.listen(0, '127.0.0.1', ok)); servidores.push(smtp);
    mail.reemplazar(null);
    Object.assign(process.env, { MAIL_PROVIDER: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.server.address().port), SMTP_USER: 'usuario', SMTP_PASS: 'clave-mala', MAIL_FROM: 'EN COMBO <avisos@encombo.test>' });
    const o5 = await comprar(A, [{ producto_id: P('Galleta'), cantidad: 1 }], D, '17:00');
    const nA = await esperar(async () => (await q("SELECT * FROM notificaciones WHERE pedido_id=$1 AND estado='error'", [o5]))[0]);
    t('SMTP con contraseña incorrecta: la notificación queda en error (sin romper el pedido)', nA && /(auth|credenciales|invalid)/i.test(nA.ultimo_error) && (await q('SELECT estatus FROM pedidos WHERE id=$1', [o5]))[0].estatus === 'Pendiente', nA && nA.ultimo_error);
    process.env.SMTP_PASS = 'clave-buena';
    await db.query("UPDATE notificaciones SET proximo_intento = now() - interval '1 minute' WHERE id=$1", [nA.id]); await notif.enviarPendientes();
    const mr = await esperar(async () => recibidos[0]);
    t('SMTP real: el servidor recibe el correo con remitente, destinatario y asunto (con acentos)', mr && mr.to.value[0].address === A.correo && mr.from.value[0].address === 'avisos@encombo.test' && mr.subject === `Pedido EC-${String(o5).padStart(4, '0')} confirmado`);
    t('SMTP real: trae texto y HTML escapado', /Hola Ana/.test(mr.text) && mr.html.includes('&lt;b&gt;') && /Entrega:/.test(mr.text));
    const pCocina = await patch(o5, 'En preparación'); await drenar();
    t('SMTP real: un cambio de estatus llega por correo', pCocina.s === 200 && recibidos.some((m) => /en preparación/.test(m.subject)));
    delete process.env.SMTP_USER; delete process.env.SMTP_PASS;

    const pet = []; let codigo = 200;
    const web = http.createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { pet.push({ auth: req.headers.authorization, ct: req.headers['content-type'], cuerpo: JSON.parse(b) }); res.statusCode = codigo; res.end(codigo === 200 ? '{"id":"1"}' : '{"error":"dominio no verificado"}'); }); });
    await new Promise((ok) => web.listen(0, '127.0.0.1', ok)); servidores.push(web);
    Object.assign(process.env, { MAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_prueba', MAIL_API_URL: `http://127.0.0.1:${web.address().port}/emails` });
    codigo = 422; await patch(o5, 'Listo para entrega');
    const nR = await esperar(async () => (await q("SELECT * FROM notificaciones WHERE pedido_id=$1 AND plantilla='Listo para entrega' AND estado='error'", [o5]))[0]);
    t('Resend con error 422: queda en error con el motivo', nR && /422/.test(nR.ultimo_error) && /dominio/.test(nR.ultimo_error));
    codigo = 200; await db.query("UPDATE notificaciones SET proximo_intento = now() - interval '1 minute' WHERE id=$1", [nR.id]); await notif.enviarPendientes();
    const ult = pet[pet.length - 1];
    t('Resend: manda la llave, el JSON y el destinatario correctos', ult.auth === 'Bearer re_prueba' && /json/.test(ult.ct) && ult.cuerpo.to[0] === A.correo && /listo para entrega/.test(ult.cuerpo.subject) && ult.cuerpo.from.includes('avisos@encombo.test') && ult.cuerpo.html && ult.cuerpo.text);
    delete process.env.MAIL_API_URL; delete process.env.RESEND_API_KEY; process.env.MAIL_PROVIDER = 'consola'; mail.reemplazar(mock);

    const hoy = svc.todayMX();
    const oHoy = (await q("INSERT INTO pedidos(cliente_id,presentacion_id,fecha_entrega,hora_entrega,total,estatus) VALUES($1,$2,$3,'10:00',123.45,'Pendiente') RETURNING id", [Rep.id, base.presentacion_id, hoy]))[0].id;
    const chk = (await call('POST', '/api/pedidos/checkout', { items: [{ producto_id: P('Galleta'), cantidad: 1 }], presentacion_id: PRES, fecha: svc.addDays(D, 2), hora: '10:00', direccion: { cp: '91190', colonia: 'Las Flores', calle: 'Calle de Prueba', num_ext: '12' } }, Rep.token)).j.checkout_id;
    await svc.confirmarPago(chk, { proveedor: 'simulado', referencia: 'sim_rev_' + R, monto: 1 });
    r = await call('GET', '/api/reportes/dashboard', undefined, admin); const dsh = r.j;
    const sq = async (sql, p) => (await q(sql, p))[0];
    t('dashboard: ventas y pedidos de hoy coinciden con la base', near(dsh.ventas_hoy, Number((await sq("SELECT coalesce(sum(total),0) s FROM pedidos WHERE (creado_en AT TIME ZONE 'America/Mexico_City')::date=$1", [hoy])).s)) && dsh.pedidos_hoy === (await sq("SELECT count(*)::int n FROM pedidos WHERE (creado_en AT TIME ZONE 'America/Mexico_City')::date=$1", [hoy])).n && dsh.ventas_hoy >= 123.45);
    const est = Object.fromEntries((await q('SELECT estatus,count(*)::int n FROM pedidos GROUP BY 1')).map((x) => [x.estatus, x.n]));
    t('dashboard: pedidos por estatus (incluye ceros)', ['Pendiente', 'En preparación', 'Listo para entrega', 'Entregado'].every((e) => dsh.por_estatus[e] === (est[e] || 0)));
    t('dashboard: entregas pendientes de hoy', dsh.entregas_pendientes_hoy === (await sq("SELECT count(*)::int n FROM pedidos WHERE fecha_entrega=$1 AND estatus<>'Entregado'", [hoy])).n && dsh.entregas_pendientes_hoy >= 1);
    t('dashboard: insumos en reorden', dsh.insumos_en_reorden === (await sq('SELECT count(*)::int n FROM insumos WHERE activo AND stock<=stock_minimo')).n);
    t('dashboard: próximas entregas ordenadas, sin entregados, máximo 5', dsh.proximas_entregas.length <= 5 && dsh.proximas_entregas.every((x) => x.estatus !== 'Entregado') && dsh.proximas_entregas.every((x, i, a) => i === 0 || (a[i - 1].fecha + a[i - 1].hora) <= (x.fecha + x.hora)));
    t('dashboard: serie de 7 días terminando hoy, con ceros y la venta de hoy', dsh.ventas_7_dias.length === 7 && dsh.ventas_7_dias[6].fecha === hoy && dsh.ventas_7_dias[0].fecha === svc.addDays(hoy, -6) && near(dsh.ventas_7_dias[6].ventas, dsh.ventas_hoy) && dsh.ventas_7_dias[0].ventas === 0);
    t('dashboard: avisos con error', dsh.notificaciones.fallidas === (await sq("SELECT count(*)::int n FROM notificaciones WHERE estado='fallida'")).n);
    t('dashboard: pagos en revisión (cobrados pero sin pedido) con cliente y referencia', dsh.pagos_en_revision >= 1 && dsh.pagos_revision[0].cliente === 'Cliente Reportes' && dsh.pagos_revision[0].referencia === 'sim_rev_' + R);

    const m0 = new Date(); m0.setUTCDate(1); m0.setUTCMonth(m0.getUTCMonth() - 3);
    const M1 = m0.toISOString().slice(0, 10), mN = new Date(m0); mN.setUTCMonth(mN.getUTCMonth() + 1);
    const M2 = mN.toISOString().slice(0, 10), d2 = svc.addDays(M1, 1), d3 = svc.addDays(M1, 8);
    const harina = (await q("SELECT id FROM insumos WHERE nombre='Harina'"))[0].id;
    const ped = async (fechaHora, total, estatus, piezas) => {
      const id = (await q("INSERT INTO pedidos(cliente_id,presentacion_id,fecha_entrega,hora_entrega,total,estatus,creado_en) VALUES($1,$2,$3,'10:00',$4,$5,$6::timestamptz) RETURNING id", [Rep.id, base.presentacion_id, svc.addDays(M1, 20), total, estatus, fechaHora]))[0].id;
      await db.query('INSERT INTO pedido_items(pedido_id,producto_id,cantidad,precio_unitario) VALUES($1,$2,$3,25)', [id, P('Cupcake'), piezas]);
      await db.query("INSERT INTO movimientos_inventario(insumo_id,tipo,cantidad,pedido_id) VALUES($1,'salida',100,$2)", [harina, id]);
      return id;
    };
    await ped(`${M1} 12:00-06`, 100, 'Entregado', 4);
    await ped(`${d2} 23:30-06`, 250.5, 'Pendiente', 10);
    await ped(`${d3} 00:15-06`, 80, 'Listo para entrega', 3);
    await ped(`${M2} 09:00-06`, 300, 'Entregado', 12);
    r = await call('GET', `/api/reportes/ventas?desde=${M1}&hasta=${M2}&agrupar=dia`, undefined, admin); const vd = r.j;
    t('ventas por día: cuatro días, y la venta de las 23:30 cuenta en su día (hora de México)', r.s === 200 && vd.periodos.map((x) => x.periodo).join() === [M1, d2, d3, M2].join() && near(vd.periodos[1].ventas, 250.5), JSON.stringify(vd.periodos.map((x) => [x.periodo, x.ventas])));
    t('costo de insumos = lo descontado × costo unitario (100 g × $0.022 = $2.20 por pedido)', vd.periodos.every((x) => near(x.costo, 2.2)) && near(vd.totales.costo, 8.8));
    t('utilidad bruta = ventas − costo, y totales correctos', near(vd.totales.ventas, 730.5) && near(vd.totales.utilidad, 721.7) && vd.totales.pedidos === 4 && near(vd.totales.margen_pct, 98.8, 0.05) && vd.periodos.every((x) => near(x.utilidad, x.ventas - x.costo)), JSON.stringify(vd.totales));
    r = await call('GET', `/api/reportes/ventas?desde=${M1}&hasta=${M2}&agrupar=mes`, undefined, admin);
    t('ventas por mes', r.j.periodos.length === 2 && r.j.periodos[0].periodo === M1 && near(r.j.periodos[0].ventas, 430.5) && r.j.periodos[0].pedidos === 3 && r.j.periodos[1].periodo === M2 && near(r.j.periodos[1].ventas, 300));
    r = await call('GET', `/api/reportes/ventas?desde=${M1}&hasta=${M2}&agrupar=semana`, undefined, admin);
    const esperadas = {}; for (const [f, v] of [[M1, 100], [d2, 250.5], [d3, 80], [M2, 300]]) { const k = mondayOf(f); esperadas[k] = (esperadas[k] || 0) + v; }
    t('ventas por semana (la semana empieza en lunes)', r.j.periodos.length === Object.keys(esperadas).length && r.j.periodos.every((x) => near(x.ventas, esperadas[x.periodo] ?? -1)), JSON.stringify(r.j.periodos));
    t('productos más vendidos', vd.top_productos[0].nombre === 'Cupcake' && vd.top_productos[0].piezas === 29 && near(vd.top_productos[0].ventas, 725));
    r = await call('GET', `/api/reportes/ventas?desde=${svc.addDays(M1, -20)}&hasta=${svc.addDays(M1, -10)}`, undefined, admin); t('un rango sin ventas: lista vacía y totales en cero', r.s === 200 && r.j.periodos.length === 0 && r.j.totales.ventas === 0 && r.j.totales.margen_pct === 0);
    r = await call('GET', '/api/reportes/ventas', undefined, admin); t('sin parámetros: los últimos 30 días', r.s === 200 && r.j.hasta === hoy && r.j.desde === svc.addDays(hoy, -29));
    for (const [n, qs] of [['desde posterior a hasta', 'desde=2026-05-02&hasta=2026-05-01'], ['fecha mal escrita', 'desde=ayer'], ['más de un año', `desde=${svc.addDays(hoy, -400)}&hasta=${hoy}`], ['agrupar por algo desconocido', 'agrupar=año'], ['intento de inyección SQL', "agrupar=day';DROP TABLE pedidos;--"]]) {
      r = await call('GET', `/api/reportes/ventas?${qs}`, undefined, admin); t(`ventas rechaza: ${n}`, r.s === 400, r.s);
    }
    t('la tabla de pedidos sigue intacta tras el intento de inyección', (await sq('SELECT count(*)::int n FROM pedidos')).n >= 5);
    r = await call('GET', `/api/reportes/estatus?desde=${M1}&hasta=${M2}`, undefined, admin);
    t('pedidos por estatus (con ceros) y total', r.j.estatus.find((x) => x.estatus === 'Entregado').pedidos === 2 && r.j.estatus.find((x) => x.estatus === 'Pendiente').pedidos === 1 && r.j.estatus.find((x) => x.estatus === 'En preparación').pedidos === 0 && r.j.total === 4);
    const inv = (await call('POST', '/api/inventario', { nombre: `=Test5 ${R},"x"`, unidad: 'g', stock: 10, stock_minimo: 20, costo_unitario: 2 }, almacen)).j.insumo;
    r = await call('GET', '/api/reportes/existencias', undefined, admin);
    const valorSql = (await q('SELECT stock,costo_unitario FROM insumos WHERE activo')).reduce((a, x) => a + Number(x.stock) * Number(x.costo_unitario), 0);
    t('existencias: valor del inventario y cuántos están en reorden', near(r.j.totales.valor, valorSql, 0.01) && r.j.totales.en_reorden === (await sq('SELECT count(*)::int n FROM insumos WHERE activo AND stock<=stock_minimo')).n && r.j.insumos.find((x) => x.nombre.includes('Test5')).estado === 'Reorden');
    r = await call('GET', `/api/reportes/ventas?desde=${M1}&hasta=${M2}&formato=csv`, undefined, admin);
    const lineas = r.texto.split('\r\n').filter(Boolean);
    t('CSV de ventas: tipo, descarga, BOM y encabezado', /text\/csv/.test(r.tipo) && /attachment; filename="ventas-/.test(r.h.get('content-disposition')) && r.texto.charCodeAt(0) === 0xFEFF && lineas[0].replace('\uFEFF', '') === 'Periodo,Pedidos,Ventas,Costo de insumos,Utilidad bruta');
    t('CSV de ventas: filas con 2 decimales y renglón TOTAL', lineas.length === 6 && lineas[2] === `${d2},1,250.50,2.20,248.30` && lineas[5] === 'TOTAL,4,730.50,8.80,721.70', lineas.join(' | '));
    r = await call('GET', '/api/reportes/existencias?formato=csv', undefined, admin);
    t('CSV: un nombre que empieza con "=" no se ejecuta como fórmula y las comas/comillas se escapan', r.texto.includes(`"'=Test5 ${R},""x"""`), r.texto.split('\r\n').find((l) => l.includes('Test5')));
    r = await call('GET', `/api/reportes/estatus?desde=${M1}&hasta=${M2}&formato=csv`, undefined, admin); t('CSV de pedidos por estatus', /text\/csv/.test(r.tipo) && r.texto.includes('Entregado,2') && r.texto.includes('TOTAL,4'));
  } catch (e) {
    fail++; console.log('FAIL error inesperado:', e);
  } finally {
    try {
      mail.reemplazar(null);
      for (const s of servidores) await new Promise((ok) => (s.close ? s.close(() => ok()) : ok()));
      const ids = clientes.length ? clientes : [0];
      await db.query('DELETE FROM checkouts WHERE cliente_id = ANY($1)', [ids]);
      await db.query('DELETE FROM movimientos_inventario WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ANY($1))', [ids]);
      await db.query('DELETE FROM pagos WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ANY($1))', [ids]);
      await db.query('DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ANY($1))', [ids]);
      await db.query('DELETE FROM pedidos WHERE cliente_id = ANY($1)', [ids]);
      await db.query('DELETE FROM usuarios WHERE id = ANY($1)', [ids]);
      await db.query('DELETE FROM movimientos_inventario WHERE id > $1', [movMax]);
      await db.query("DELETE FROM insumos WHERE nombre LIKE '%Test5 %'");
      for (const i of insumos0) await db.query('UPDATE insumos SET stock=$2,stock_minimo=$3,costo_unitario=$4,activo=$5 WHERE id=$1', [i.id, i.stock, i.stock_minimo, i.costo_unitario, i.activo]);
    } catch (e) { console.log('Aviso: limpieza incompleta:', e.message); }
    console.log(`\n${pass} correctas, ${fail} fallidas`);
    server.close(); await db.pool.end(); process.exit(fail ? 1 : 0);
  }
})();

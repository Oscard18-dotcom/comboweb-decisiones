const http = require('http');
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
  let j = {}; try { j = JSON.parse(await r.text()); } catch (e) {  }
  return { s: r.status, j };
}
const R = Date.now();
const q = async (sql, p) => (await db.query(sql, p)).rows;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stockDe = async (id) => Number((await q('SELECT stock FROM insumos WHERE id=$1', [id]))[0].stock);

(async () => {
  const insumos0 = await q('SELECT * FROM insumos ORDER BY id');
  const movMax = (await q('SELECT coalesce(max(id),0) AS m FROM movimientos_inventario'))[0].m;
  const enviados = []; const modo = { falla: false };
  mail.reemplazar({ nombre: 'prueba', async enviar(m) { if (modo.falla) throw new Error('SMTP caído'); enviados.push(m); } });
  const smtps = []; let cliente = null;
  try {
    const login = async (c) => (await call('POST', '/api/auth/login', { correo: c, password: process.env.SEED_PASSWORD })).j.token;
    const admin = await login('admin@encombo.test'), almacen = await login('almacen@encombo.test'), cocina = await login('cocina@encombo.test');
    const reg = await call('POST', '/api/auth/register', { nombre: 'Cliente P7', correo: `p7${R}@prueba.test`, password: 'secreta123' });
    cliente = reg.j.usuario.id; const tcli = reg.j.token;
    const harina = (await q("SELECT id FROM insumos WHERE nombre='Harina'"))[0].id;
    const azucar = (await q("SELECT id FROM insumos WHERE nombre='Azúcar'"))[0].id;
    const leche = (await q("SELECT id FROM insumos WHERE nombre='Leche'"))[0].id;
    const cacao = (await q("SELECT id FROM insumos WHERE nombre='Cacao'"))[0].id;

    for (const [n, tok] of [['sin sesión', null], ['cliente', tcli], ['cocina', cocina], ['almacén', almacen]]) {
      const esperado = tok ? 403 : 401;
      for (const [m, p] of [['GET', '/api/proveedores'], ['POST', '/api/proveedores'], ['DELETE', '/api/proveedores/1'], ['GET', '/api/pedidos-proveedor'], ['POST', '/api/pedidos-proveedor'], ['POST', '/api/pedidos-proveedor/1/recibir'], ['GET', '/api/pedidos-proveedor/sugerencias']]) {
        const r = await call(m, p, m === 'GET' ? undefined : {}, tok);
        t(`${n}: ${m} ${p} → ${esperado}`, r.s === esperado, String(r.s));
      }
    }

    const nom = `Harinera Test7 ${R}`;
    let r = await call('POST', '/api/proveedores', { nombre: nom, correo: `Ventas${R}@Harinera.TEST`, contacto: 'Doña Lupe', telefono: '228 123 4567', notas: 'Entrega los martes', insumos: [harina, azucar] }, admin);
    t('alta de proveedor → 201', r.s === 201 && r.j.proveedor.nombre === nom);
    const P = r.j.proveedor;
    t('el correo se guarda en minúsculas', P.correo === `ventas${R}@harinera.test`);
    t('guarda los insumos que surte', P.insumos.length === 2 && P.insumos.some((x) => x.id === harina));
    r = await call('POST', '/api/proveedores', { nombre: nom.toUpperCase(), correo: 'otro@x.com' }, admin);
    t('nombre duplicado (sin importar mayúsculas) → 409', r.s === 409);
    for (const [n, b] of [['sin nombre', { correo: 'a@b.co' }], ['nombre de 1 letra', { nombre: 'A', correo: 'a@b.co' }], ['correo inválido', { nombre: 'Prov X', correo: 'malcorreo' }], ['sin correo', { nombre: 'Prov X' }],
      ['teléfono con letras', { nombre: 'Prov X', correo: 'a@b.co', telefono: 'abc' }], ['insumo inexistente', { nombre: 'Prov X', correo: 'a@b.co', insumos: [99999999] }], ['insumos no es lista', { nombre: 'Prov X', correo: 'a@b.co', insumos: 'x' }],
      ['notas demasiado largas', { nombre: 'Prov X', correo: 'a@b.co', notas: 'x'.repeat(301) }]]) {
      r = await call('POST', '/api/proveedores', b, admin); t(`alta rechaza: ${n}`, r.s === 400, String(r.s));
    }
    t('el rechazo de insumo inexistente no dejó proveedor a medias', (await q("SELECT 1 FROM proveedores WHERE nombre='Prov X'")).length === 0);
    r = await call('GET', '/api/proveedores', undefined, admin);
    t('lista incluye al proveedor', r.s === 200 && r.j.proveedores.some((x) => x.id === P.id));

    r = await call('PUT', `/api/proveedores/${P.id}`, { telefono: '55 5555 5555', insumos: [leche] }, admin);
    t('editar teléfono e insumos', r.s === 200 && r.j.proveedor.telefono === '55 5555 5555' && r.j.proveedor.insumos.length === 1 && r.j.proveedor.insumos[0].id === leche);
    t('editar no borra los campos que no se enviaron', r.j.proveedor.contacto === 'Doña Lupe' && r.j.proveedor.notas === 'Entrega los martes');
    r = await call('PUT', `/api/proveedores/${P.id}`, { contacto: '', insumos: [] }, admin);
    t('se puede vaciar el contacto y la lista de insumos', r.s === 200 && r.j.proveedor.contacto === null && r.j.proveedor.insumos.length === 0);
    r = await call('PUT', '/api/proveedores/99999999', { nombre: 'Algo' }, admin); t('editar inexistente → 404', r.s === 404);
    r = await call('PUT', `/api/proveedores/${P.id}`, { correo: 'mal' }, admin); t('editar con correo inválido → 400', r.s === 400);

    const insTest = (await call('POST', '/api/inventario', { nombre: `Vainilla Test7 ${R}`, unidad: 'ml', stock: 10, stock_minimo: 100, costo_unitario: 1 }, admin)).j.insumo;
    r = await call('GET', '/api/pedidos-proveedor/sugerencias', undefined, admin);
    const sug = r.j.sugerencias.find((x) => x.id === insTest.id);
    t('sugerencias incluyen insumos en reorden', r.s === 200 && !!sug);
    t('cantidad sugerida = mínimo×2 − stock', sug && sug.sugerido === 190, JSON.stringify(sug));
    t('sugerencias no incluyen insumos con stock suficiente', !r.j.sugerencias.some((x) => x.id === harina) || (await stockDe(harina)) <= Number(insumos0.find((i) => i.id === harina).stock_minimo));
    await call('PUT', `/api/proveedores/${P.id}`, { insumos: [harina] }, admin);
    r = await call('GET', `/api/pedidos-proveedor/sugerencias?proveedor_id=${P.id}`, undefined, admin);
    t('con lista de insumos, solo sugiere los que surte el proveedor', r.s === 200 && !r.j.sugerencias.some((x) => x.id === insTest.id));
    r = await call('GET', '/api/pedidos-proveedor/sugerencias?proveedor_id=abc', undefined, admin); t('sugerencias con proveedor inválido → 400', r.s === 400);

    const hoy = svc.todayMX(), manana = svc.addDays(hoy, 1);
    const stock0 = { h: await stockDe(harina), a: await stockDe(azucar), v: await stockDe(insTest.id) };
    const base = { proveedor_id: P.id, items: [{ insumo_id: harina, cantidad: 100 }] };
    for (const [n, b] of [['sin proveedor', { items: base.items }], ['proveedor inexistente → 404', { ...base, proveedor_id: 99999999 }, 404], ['sin insumos', { proveedor_id: P.id, items: [] }], ['items no es lista', { proveedor_id: P.id, items: 'x' }],
      ['cantidad cero', { ...base, items: [{ insumo_id: harina, cantidad: 0 }] }], ['cantidad negativa', { ...base, items: [{ insumo_id: harina, cantidad: -5 }] }], ['cantidad con 5 decimales', { ...base, items: [{ insumo_id: harina, cantidad: 0.00001 }] }],
      ['cantidad texto', { ...base, items: [{ insumo_id: harina, cantidad: 'mucho' }] }], ['cantidad infinita', { ...base, items: [{ insumo_id: harina, cantidad: 1e400 }] }], ['insumo repetido', { ...base, items: [{ insumo_id: harina, cantidad: 1 }, { insumo_id: harina, cantidad: 2 }] }],
      ['insumo inexistente', { ...base, items: [{ insumo_id: 99999999, cantidad: 1 }] }], ['más de 30 insumos', { ...base, items: Array.from({ length: 31 }, (_, i) => ({ insumo_id: i + 1, cantidad: 1 })) }],
      ['nota muy larga', { ...base, nota: 'x'.repeat(301) }], ['fecha en el pasado', { ...base, fecha_requerida: svc.addDays(hoy, -1) }], ['fecha mal formada', { ...base, fecha_requerida: '25/12/2030' }],
      ['suma_stock_en inválido', { ...base, suma_stock_en: 'nunca' }]]) {
      r = await call('POST', '/api/pedidos-proveedor', b, admin);
      const exp = n.includes('404') ? 404 : 400;
      t(`pedido rechaza: ${n}`, r.s === exp, String(r.s) + ' ' + JSON.stringify(r.j));
    }
    t('los pedidos rechazados no dejaron nada ni sumaron stock', (await q('SELECT 1 FROM pedidos_proveedor WHERE proveedor_id=$1', [P.id])).length === 0 && (await stockDe(harina)) === stock0.h && enviados.length === 0);

    r = await call('POST', '/api/pedidos-proveedor', { proveedor_id: P.id, nota: 'Entregar <b>en cocina</b> & "rápido"', fecha_requerida: manana, suma_stock_en: 'recepcion', items: [{ insumo_id: harina, cantidad: 2500.5 }, { insumo_id: azucar, cantidad: 1000 }] }, admin);
    t('crear pedido → 201', r.s === 201 && r.j.pedido.estado === 'enviado' && /^PP-\d{4}$/.test(r.j.pedido.folio), JSON.stringify(r.j));
    const P1 = r.j.pedido;
    t('al crear con "al recibir" NO se suma el stock todavía', (await stockDe(harina)) === stock0.h && P1.stock_aplicado === false);
    const m1 = await esperar(() => enviados.find((m) => m.asunto.includes(P1.folio)));
    t('se manda un correo al proveedor', !!m1 && m1.a === P.correo, JSON.stringify(enviados.map((e) => e.a)));
    t('el asunto lleva el folio y el nombre de la empresa', m1 && m1.asunto === `Pedido ${P1.folio} de EN COMBO`);
    t('el correo lista cada insumo con su cantidad y unidad', m1 && /Harina: 2,500\.5 g/.test(m1.texto) && /Azúcar: 1,000 g/.test(m1.texto), m1 && m1.texto);
    t('el correo trae la fecha requerida y la nota', m1 && m1.texto.includes(manana) && m1.texto.includes('Entregar <b>en cocina</b>'));
    t('el HTML del correo escapa lo que escribe el usuario', m1 && !m1.html.includes('<b>en cocina</b>') && m1.html.includes('&lt;b&gt;en cocina&lt;/b&gt;'));
    t('las respuestas del proveedor llegan al administrador (reply-to)', m1 && m1.responderA === 'admin@encombo.test');
    t('el correo queda registrado como enviado', (await q("SELECT estado FROM notificaciones WHERE pedido_proveedor_id=$1 AND plantilla='pedido'", [P1.id]))[0].estado === 'enviada');
    t('la notificación pertenece solo al pedido a proveedor', (await q('SELECT pedido_id,cliente_id FROM notificaciones WHERE pedido_proveedor_id=$1', [P1.id]))[0].pedido_id === null);

    r = await call('POST', `/api/pedidos-proveedor/${P1.id}/recibir`, {}, admin);
    t('marcar como recibido → 200', r.s === 200 && r.j.pedido.estado === 'recibido' && r.j.pedido.stock_aplicado === true && !!r.j.pedido.recibido_en);
    t('el stock se suma automáticamente al recibir', (await stockDe(harina)) === stock0.h + 2500.5 && (await stockDe(azucar)) === stock0.a + 1000, `${await stockDe(harina)}`);
    const movs = await q('SELECT tipo,cantidad,nota,usuario_id FROM movimientos_inventario WHERE pedido_proveedor_id=$1 ORDER BY insumo_id', [P1.id]);
    t('queda un movimiento de entrada por insumo, con el folio en la nota', movs.length === 2 && movs.every((m) => m.tipo === 'entrada' && m.nota.includes(P1.folio) && m.usuario_id));
    r = await call('POST', `/api/pedidos-proveedor/${P1.id}/recibir`, {}, admin);
    t('recibir otra vez no duplica el stock (idempotente)', r.s === 200 && (await stockDe(harina)) === stock0.h + 2500.5);
    r = await call('POST', `/api/pedidos-proveedor/${P1.id}/cancelar`, {}, admin); t('no se puede cancelar un pedido ya recibido → 409', r.s === 409);
    r = await call('GET', `/api/inventario/${harina}/movimientos`, undefined, admin);
    t('el historial del insumo muestra el pedido a proveedor', r.s === 200 && r.j.movimientos.some((m) => m.pedido_proveedor_id === P1.id));

    r = await call('POST', '/api/pedidos-proveedor', { proveedor_id: P.id, suma_stock_en: 'recepcion', items: [{ insumo_id: harina, cantidad: 300 }] }, admin);
    const P2 = r.j.pedido; const antes = await stockDe(harina);
    const rs = await Promise.all(Array.from({ length: 8 }, () => call('POST', `/api/pedidos-proveedor/${P2.id}/recibir`, {}, admin)));
    t('8 recepciones simultáneas: todas responden bien', rs.every((x) => x.s === 200), rs.map((x) => x.s).join());
    t('8 recepciones simultáneas: el stock se suma UNA sola vez', (await stockDe(harina)) === antes + 300);
    t('8 recepciones simultáneas: un solo movimiento', (await q('SELECT 1 FROM movimientos_inventario WHERE pedido_proveedor_id=$1', [P2.id])).length === 1);

    const antesV = await stockDe(insTest.id);
    r = await call('POST', '/api/pedidos-proveedor', { proveedor_id: P.id, items: [{ insumo_id: insTest.id, cantidad: 190 }] }, admin);
    const P3 = r.j.pedido;
    t('por defecto el stock se suma en cuanto se envía el pedido', r.s === 201 && P3.stock_aplicado === true && P3.suma_stock_en === 'envio' && (await stockDe(insTest.id)) === antesV + 190);
    r = await call('GET', '/api/inventario/alertas', undefined, admin);
    t('la alerta de reorden desaparece sola al subir el stock', !r.j.alertas.some((x) => x.id === insTest.id));
    r = await call('POST', `/api/pedidos-proveedor/${P3.id}/cancelar`, {}, admin);
    t('no se cancela un pedido cuyo stock ya se sumó → 409', r.s === 409 && /corrige/i.test(r.j.error));
    r = await call('POST', `/api/pedidos-proveedor/${P3.id}/recibir`, {}, admin);
    t('al recibir un pedido ya sumado, no se vuelve a sumar', r.s === 200 && r.j.pedido.estado === 'recibido' && (await stockDe(insTest.id)) === antesV + 190);

    enviados.length = 0;
    r = await call('POST', '/api/pedidos-proveedor', { proveedor_id: P.id, suma_stock_en: 'recepcion', items: [{ insumo_id: azucar, cantidad: 50 }] }, admin);
    const P4 = r.j.pedido; await esperar(() => enviados.length >= 1);
    r = await call('POST', `/api/pedidos-proveedor/${P4.id}/cancelar`, {}, admin);
    t('cancelar un pedido sin stock sumado', r.s === 200 && r.j.pedido.estado === 'cancelado');
    const mc = await esperar(() => enviados.find((m) => m.asunto.includes('Cancelación')));
    t('se avisa al proveedor de la cancelación', !!mc && mc.a === P.correo && mc.asunto.includes(P4.folio));
    r = await call('POST', `/api/pedidos-proveedor/${P4.id}/recibir`, {}, admin); t('un pedido cancelado no se puede recibir → 409', r.s === 409);
    const a1 = await stockDe(azucar); await call('POST', `/api/pedidos-proveedor/${P4.id}/cancelar`, {}, admin);
    t('cancelar dos veces no manda dos correos', (await q('SELECT 1 FROM notificaciones WHERE pedido_proveedor_id=$1', [P4.id])).length === 2 && (await stockDe(azucar)) === a1);

    r = await call('POST', '/api/pedidos-proveedor', { proveedor_id: P.id, suma_stock_en: 'recepcion', items: [{ insumo_id: leche, cantidad: 5 }] }, admin);
    const P5 = r.j.pedido;
    r = await call('DELETE', `/api/proveedores/${P.id}`, undefined, admin);
    t('no se elimina un proveedor con pedidos enviados sin recibir → 409', r.s === 409);
    await call('POST', `/api/pedidos-proveedor/${P5.id}/recibir`, {}, admin);
    r = await call('DELETE', `/api/proveedores/${P.id}`, undefined, admin);
    t('un proveedor con historial se archiva (no se borra)', r.s === 200 && r.j.archivado === true);
    t('el proveedor archivado ya no sale en la lista normal', !(await call('GET', '/api/proveedores', undefined, admin)).j.proveedores.some((x) => x.id === P.id));
    t('con ?inactivos=1 sí sale', (await call('GET', '/api/proveedores?inactivos=1', undefined, admin)).j.proveedores.some((x) => x.id === P.id && x.activo === false));
    r = await call('POST', '/api/pedidos-proveedor', base, admin); t('no se le puede pedir a un proveedor archivado → 409', r.s === 409);
    r = await call('PUT', `/api/proveedores/${P.id}`, { activo: true }, admin); t('se puede reactivar', r.s === 200 && r.j.proveedor.activo === true);
    t('el historial de pedidos sigue intacto', (await call('GET', '/api/pedidos-proveedor', undefined, admin)).j.pedidos.filter((x) => x.proveedor_id === P.id).length === 5);
    r = await call('GET', '/api/pedidos-proveedor?estado=cancelado', undefined, admin);
    t('filtro por estado', r.j.pedidos.length >= 1 && r.j.pedidos.every((x) => x.estado === 'cancelado'));
    r = await call('GET', `/api/pedidos-proveedor/${P1.id}`, undefined, admin); t('detalle del pedido con sus renglones', r.s === 200 && r.j.pedido.items.length === 2 && r.j.pedido.proveedor === nom);
    r = await call('GET', '/api/pedidos-proveedor/99999999', undefined, admin); t('detalle inexistente → 404', r.s === 404);
    r = await call('GET', '/api/pedidos-proveedor/abc', undefined, admin); t('detalle con id inválido → 400', r.s === 400);

    const PB = (await call('POST', '/api/proveedores', { nombre: `Borrable Test7 ${R}`, correo: 'b@b.co', insumos: [cacao] }, admin)).j.proveedor;
    r = await call('DELETE', `/api/proveedores/${PB.id}`, undefined, admin);
    t('un proveedor sin pedidos se elimina de verdad', r.s === 200 && r.j.eliminado === true && (await q('SELECT 1 FROM proveedores WHERE id=$1', [PB.id])).length === 0 && (await q('SELECT 1 FROM proveedor_insumos WHERE proveedor_id=$1', [PB.id])).length === 0);
    r = await call('DELETE', `/api/proveedores/${PB.id}`, undefined, admin); t('eliminar uno que ya no existe → 404', r.s === 404);

    const InsB = (await call('POST', '/api/inventario', { nombre: `Borrable Insumo Test7 ${R}`, unidad: 'g' }, admin)).j.insumo;
    const PC = (await call('POST', '/api/proveedores', { nombre: `Lista Test7 ${R}`, correo: 'c@c.co', insumos: [InsB.id] }, admin)).j.proveedor;
    r = await call('DELETE', `/api/inventario/${InsB.id}`, undefined, admin);
    t('eliminar un insumo que estaba en la lista de un proveedor funciona', r.s === 200 && r.j.eliminado === true);
    const InsC = (await call('POST', '/api/inventario', { nombre: `Pedido Insumo Test7 ${R}`, unidad: 'g' }, admin)).j.insumo;
    await call('POST', '/api/pedidos-proveedor', { proveedor_id: PC.id, items: [{ insumo_id: InsC.id, cantidad: 3 }] }, admin);
    r = await call('DELETE', `/api/inventario/${InsC.id}`, undefined, admin);
    t('un insumo que ya fue pedido se archiva (no rompe el historial)', r.s === 200 && r.j.archivado === true);

    r = await call('POST', '/api/pedidos-proveedor', { proveedor_id: PC.id, suma_stock_en: 'recepcion', items: [{ insumo_id: cacao, cantidad: 10 }] }, admin);
    const P6 = r.j.pedido; r = await call('GET', '/api/reportes/dashboard', undefined, admin);
    t('el dashboard cuenta los pedidos a proveedor por recibir', r.s === 200 && r.j.pedidos_proveedor_por_recibir >= 1);

    modo.falla = true; enviados.length = 0;
    r = await call('POST', '/api/pedidos-proveedor', { proveedor_id: PC.id, suma_stock_en: 'recepcion', items: [{ insumo_id: cacao, cantidad: 7 }] }, admin);
    t('si el correo falla, el pedido se crea igual', r.s === 201);
    const P7 = r.j.pedido; await sleep(300);
    let n = (await q("SELECT id,estado,intentos FROM notificaciones WHERE pedido_proveedor_id=$1 AND plantilla='pedido'", [P7.id]))[0];
    t('queda marcado con error para reintentar', n.estado === 'error' && enviados.length === 0, JSON.stringify(n));
    t('el pedido muestra el estado del correo', (await call('GET', `/api/pedidos-proveedor/${P7.id}`, undefined, admin)).j.pedido.correo_estado === 'error');
    modo.falla = false;
    r = await call('POST', `/api/notificaciones/${n.id}/reintentar`, {}, admin);
    t('el administrador puede reintentar el envío', r.s === 200 && r.j.notificacion.estado === 'enviada' && enviados.length === 1);
    r = await call('GET', '/api/notificaciones', undefined, admin);
    t('la lista de avisos muestra el folio PP-', r.j.notificaciones.some((x) => x.folio === P7.folio));

    const antesC = await stockDe(cacao); enviados.length = 0;
    const rr = await Promise.all(Array.from({ length: 12 }, () => call('POST', '/api/pedidos-proveedor', { proveedor_id: PC.id, items: [{ insumo_id: cacao, cantidad: 2 }] }, admin)));
    t('12 pedidos simultáneos: todos se crean', rr.every((x) => x.s === 201), rr.map((x) => x.s).join());
    t('12 pedidos simultáneos: el stock suma exacto (24)', (await stockDe(cacao)) === antesC + 24);
    await esperar(() => enviados.length >= 12, 6000);
    t('12 pedidos simultáneos: 12 correos, ni uno repetido', enviados.length === 12 && new Set(enviados.map((m) => m.asunto)).size === 12);

    const recibidos = [];
    const srv = new SMTPServer({ authOptional: true, disabledCommands: ['STARTTLS'], onData(stream, sess, cb) { simpleParser(stream).then((m) => { recibidos.push(m); cb(); }, cb); } });
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok)); smtps.push(srv);
    mail.reemplazar(null);
    const env0 = { ...process.env };
    process.env.MAIL_PROVIDER = 'smtp'; process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = String(srv.server.address().port); process.env.MAIL_FROM = 'EN COMBO <avisos@encombo.test>';
    r = await call('POST', '/api/pedidos-proveedor', { proveedor_id: PC.id, suma_stock_en: 'recepcion', items: [{ insumo_id: cacao, cantidad: 4 }] }, admin);
    const mr = await esperar(() => recibidos[0]);
    t('SMTP real: el correo llega al proveedor', !!mr && mr.to.value[0].address === 'c@c.co');
    t('SMTP real: trae Reply-To del administrador', mr && mr.replyTo && mr.replyTo.value[0].address === 'admin@encombo.test');
    t('SMTP real: el cuerpo lista el insumo y la cantidad', mr && /Cacao: 4 g/.test(mr.text) && /Cacao/.test(mr.html));
    const cuerpos = [];
    const api = http.createServer((rq, rs) => { let d = ''; rq.on('data', (c) => d += c); rq.on('end', () => { cuerpos.push(JSON.parse(d)); rs.end('{}'); }); });
    await new Promise((ok) => api.listen(0, '127.0.0.1', ok));
    process.env.MAIL_PROVIDER = 'resend'; process.env.RESEND_API_KEY = 're_prueba'; process.env.MAIL_API_URL = `http://127.0.0.1:${api.address().port}`;
    await call('POST', '/api/pedidos-proveedor', { proveedor_id: PC.id, suma_stock_en: 'recepcion', items: [{ insumo_id: cacao, cantidad: 1 }] }, admin);
    const cr = await esperar(() => cuerpos[0]);
    t('Resend: se manda reply_to del administrador', !!cr && cr.reply_to === 'admin@encombo.test' && cr.to[0] === 'c@c.co');
    api.close(); Object.assign(process.env, env0); delete process.env.MAIL_API_URL;
    mail.reemplazar({ nombre: 'prueba', async enviar(m) { enviados.push(m); } });
    t('la bandeja separa pedidos de clientes y de proveedores (restricción de la base)', await db.query("INSERT INTO notificaciones(plantilla,destinatario,asunto,cuerpo_texto,cuerpo_html) VALUES('x','a@b.co','x','x','x')").then(() => false, () => true));
  } catch (e) {
    fail++; console.log('FAIL excepción inesperada:', e && e.stack || e);
  } finally {
    try {
      mail.reemplazar(null);
      await db.query("DELETE FROM notificaciones WHERE pedido_proveedor_id IN (SELECT pp.id FROM pedidos_proveedor pp JOIN proveedores p ON p.id=pp.proveedor_id WHERE p.nombre LIKE '%Test7 %')");
      await db.query("DELETE FROM movimientos_inventario WHERE pedido_proveedor_id IN (SELECT pp.id FROM pedidos_proveedor pp JOIN proveedores p ON p.id=pp.proveedor_id WHERE p.nombre LIKE '%Test7 %')");
      await db.query("DELETE FROM pedidos_proveedor WHERE proveedor_id IN (SELECT id FROM proveedores WHERE nombre LIKE '%Test7 %')");
      await db.query("DELETE FROM proveedores WHERE nombre LIKE '%Test7 %'");
      await db.query('DELETE FROM movimientos_inventario WHERE id > $1', [movMax]);
      await db.query("DELETE FROM movimientos_inventario WHERE insumo_id IN (SELECT id FROM insumos WHERE nombre LIKE '%Test7 %')");
      await db.query("DELETE FROM proveedor_insumos WHERE insumo_id IN (SELECT id FROM insumos WHERE nombre LIKE '%Test7 %')");
      await db.query("DELETE FROM insumos WHERE nombre LIKE '%Test7 %'");
      if (cliente) await db.query('DELETE FROM usuarios WHERE id=$1', [cliente]);
      for (const i of insumos0) await db.query('UPDATE insumos SET stock=$2,stock_minimo=$3,costo_unitario=$4,activo=$5 WHERE id=$1', [i.id, i.stock, i.stock_minimo, i.costo_unitario, i.activo]);
    } catch (e) { console.log('Aviso: limpieza incompleta:', e.message); }
    for (const s of smtps) s.close();
    console.log(`\n${pass} correctas, ${fail} fallidas`);
    server.close(); await db.pool.end(); process.exit(fail ? 1 : 0);
  }
})();
async function esperar(fn, ms = 4000) { const s = Date.now(); while (Date.now() - s < ms) { const v = await fn(); if (v) return v; await sleep(40); } return null; }

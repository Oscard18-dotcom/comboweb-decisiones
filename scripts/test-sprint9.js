const fs = require('fs');
const path = require('path');
const app = require('../src/app');
const db = require('../src/db');
const svc = require('../src/services/pedidos');
const dir = require('../src/services/direccion');
const mail = require('../src/mail');

const ROOT = path.join(__dirname, '..');
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

(async () => {
  const insumos0 = await q('SELECT * FROM insumos ORDER BY id');
  const movMax = (await q('SELECT coalesce(max(id),0) AS m FROM movimientos_inventario'))[0].m;
  const clientes = [];
  mail.reemplazar({ nombre: 'prueba', async enviar() {} });
  try {
    const login = async (c) => (await call('POST', '/api/auth/login', { correo: c, password: process.env.SEED_PASSWORD })).j.token;
    const admin = await login('admin@encombo.test'), cocina = await login('cocina@encombo.test');
    const mk = async (n) => { const r = await call('POST', '/api/auth/register', { nombre: 'Cliente P9' + n, correo: `p9${n}${R}@prueba.test`, password: 'secreta123' }); clientes.push(r.j.usuario.id); return r.j.token; };
    const cli = await mk('a'), otro = await mk('b');
    const cat = (await call('GET', '/api/catalogo')).j, gal = cat.productos.find((p) => p.nombre === 'Galleta').id, pres = cat.presentaciones.find((x) => x.nombre === 'Caja mediana').id;
    const base = 30 + Math.floor(Math.random() * 40); let k = 0;
    const dia = () => svc.addDays(svc.todayMX(), base + (k++));
    const DIR = { cp: '91190', colonia: 'Las Flores', calle: 'Calle de Prueba', num_ext: '12', num_int: '3', referencias: 'Portón negro' };
    const body = (o = {}) => ({ items: [{ producto_id: gal, cantidad: 1 }], presentacion_id: pres, fecha: dia(), hora: '12:00', direccion: DIR, ...o });

    const cat91 = require('../src/data/cp-veracruz.json'), cps = Object.keys(cat91);
    t('catálogo SEPOMEX de Veracruz: más de 2 000 códigos, todos con municipio y colonias', cps.length > 2000 && cps.every((c) => /^\d{5}$/.test(c) && cat91[c].m && cat91[c].a.length > 0));
    let r = await call('GET', '/api/catalogo/codigo-postal/91190');
    t('código postal 91190 (público, sin sesión) → Xalapa con 5 colonias', r.s === 200 && r.j.codigo_postal.municipio === 'Xalapa' && r.j.codigo_postal.colonias.length === 5 && r.j.codigo_postal.colonias.includes('Las Flores'), JSON.stringify(r.j));
    r = await call('GET', '/api/catalogo/codigo-postal/91000'); t('código postal con una sola colonia → 1 colonia', r.s === 200 && r.j.codigo_postal.colonias.length === 1);
    r = await call('GET', '/api/catalogo/codigo-postal/91500'); t('Coatepec también está en el catálogo', r.j.codigo_postal && r.j.codigo_postal.municipio === 'Coatepec');
    r = await call('GET', '/api/catalogo/codigo-postal/06000'); t('código fuera del catálogo → 200 con codigo_postal null', r.s === 200 && r.j.codigo_postal === null);
    for (const x of ['abc', '1234', '123456', '9119O']) { r = await call('GET', '/api/catalogo/codigo-postal/' + x); t(`código postal inválido “${x}” → 400`, r.s === 400); }

    r = await call('POST', '/api/pedidos/cotizar', { items: [{ producto_id: gal, cantidad: 1 }], presentacion_id: pres, fecha: dia(), hora: '12:00' });
    t('cotizar NO exige dirección (se pide hasta pagar)', r.j.ok === true, JSON.stringify(r.j.errores));
    r = await call('POST', '/api/pedidos/checkout', body({ direccion: undefined }), cli); t('pagar sin dirección → 422', r.s === 422 && /direcci/i.test(r.j.error), JSON.stringify(r.j));
    for (const [nombre, d] of [['sin código postal', { ...DIR, cp: '' }], ['código de 4 dígitos', { ...DIR, cp: '9119' }], ['código con letras', { ...DIR, cp: '9119a' }], ['código como número JSON', { ...DIR, cp: 91190 }],
      ['sin colonia', { ...DIR, colonia: '' }], ['colonia que no es de ese código postal', { ...DIR, colonia: 'Centro' }], ['sin calle', { ...DIR, calle: '' }], ['calle de 1 letra', { ...DIR, calle: 'A' }],
      ['calle de 101 caracteres', { ...DIR, calle: 'x'.repeat(101) }], ['sin número exterior', { ...DIR, num_ext: '' }], ['número exterior de 21 caracteres', { ...DIR, num_ext: '1'.repeat(21) }],
      ['número interior largo', { ...DIR, num_int: '1'.repeat(21) }], ['referencias de 201 caracteres', { ...DIR, referencias: 'r'.repeat(201) }], ['dirección como texto', 'Calle 5'], ['dirección como lista', [DIR]]]) {
      r = await call('POST', '/api/pedidos/checkout', body({ direccion: d }), cli);
      t(`dirección inválida (${nombre}) → 422`, r.s === 422 && r.j.errores.some((e) => /^direccion/.test(e.campo)), `${r.s} ${JSON.stringify(r.j.errores || r.j)}`);
    }
    t('ninguno de esos intentos creó un checkout', (await q('SELECT count(*)::int n FROM checkouts WHERE cliente_id=$1', [clientes[0]]))[0].n === 0);
    r = await call('POST', '/api/pedidos/checkout', body({ direccion: { ...DIR, cp: '06000', colonia: 'Roma' } }), cli);
    t('código fuera del catálogo sin municipio → 422 (pide municipio)', r.s === 422 && r.j.errores.some((e) => e.campo === 'direccion.municipio'));
    r = await call('POST', '/api/pedidos/checkout', body({ direccion: { ...DIR, cp: '91190', colonia: 'Roma', municipio: 'Otro lugar' } }), cli);
    t('código del catálogo: el municipio que envíe el cliente se ignora y la colonia se valida', r.s === 422);
    r = await call('POST', '/api/pedidos/checkout', body()); t('pagar sin sesión sigue siendo 401', r.s === 401);

    const compra = async (o, tok = cli) => { const c = await call('POST', '/api/pedidos/checkout', body(o), tok); if (c.s !== 201) return { c }; const a = await call('POST', `/api/pagos/simulado/${c.j.checkout_id}/aprobar`, undefined, tok); return { c, a, id: a.j.pedido_id }; };
    let P = await compra({ direccion: { ...DIR, colonia: 'las flores', referencias: 'Portón\u0007 negro\n  frente al parque' } });
    t('checkout con dirección válida → 201 y pago aprobado → pedido', P.c.s === 201 && P.a.j.estado === 'pagado' && !!P.id, JSON.stringify(P.c.j));
    const idPrimero = P.id;
    const fila = (await q('SELECT * FROM pedidos WHERE id=$1', [P.id]))[0];
    t('la dirección se guarda en el pedido (colonia normalizada, municipio y estado puestos por el servidor)', fila.dir_cp === '91190' && fila.dir_colonia === 'Las Flores' && fila.dir_calle === 'Calle de Prueba' && fila.dir_num_ext === '12' && fila.dir_num_int === '3' && fila.dir_municipio === 'Xalapa' && fila.dir_estado === 'Veracruz', JSON.stringify(fila));
    t('las referencias se limpian (sin caracteres de control ni espacios dobles)', fila.dir_referencias === 'Portón negro frente al parque', JSON.stringify(fila.dir_referencias));
    r = await call('GET', '/api/pedidos/' + P.id, undefined, cli);
    t('comprobante del cliente incluye la dirección completa', r.s === 200 && r.j.pedido.entrega.direccion.colonia === 'Las Flores' && /Calle de Prueba 12 int\. 3, Col\. Las Flores, C\.P\. 91190, Xalapa, Veracruz/.test(r.j.pedido.entrega.direccion.texto), JSON.stringify(r.j.pedido.entrega));
    r = await call('GET', '/api/pedidos/' + P.id, undefined, otro); t('otro cliente NO puede ver esa dirección → 404', r.s === 404);
    r = await call('GET', '/api/pedidos', undefined, cli); t('“Mis pedidos” trae la dirección', r.j.pedidos.find((x) => x.id === P.id).direccion.texto.includes('Las Flores'));
    t('“Mis pedidos” no expone las columnas internas dir_*', !Object.keys(r.j.pedidos[0]).some((x) => x.startsWith('dir_')));
    const hoy = svc.todayMX();
    for (const [rol, tok] of [['cocina', cocina], ['administración', admin]]) {
      r = await call('GET', `/api/cocina/pedidos?fecha=${(await q('SELECT fecha_entrega::text AS f FROM pedidos WHERE id=$1', [P.id]))[0].f}`, undefined, tok);
      const p = (r.j.pedidos || []).find((x) => x.id === P.id);
      t(`tablero de ${rol}: el pedido trae calle, colonia, C.P., municipio y referencias`, !!p && p.direccion.calle === 'Calle de Prueba' && p.direccion.colonia === 'Las Flores' && p.direccion.cp === '91190' && p.direccion.municipio === 'Xalapa' && p.direccion.referencias === 'Portón negro frente al parque', JSON.stringify(p && p.direccion));
      r = await call('GET', `/api/cocina/pedidos/${P.id}`, undefined, tok); t(`ficha de ${rol}: trae la dirección`, r.s === 200 && r.j.pedido.direccion && r.j.pedido.direccion.texto.includes('Calle de Prueba 12'));
    }
    const noti = (await q("SELECT cuerpo_texto,cuerpo_html FROM notificaciones WHERE pedido_id=$1 AND plantilla='confirmacion'", [P.id]))[0];
    t('el correo de confirmación incluye la dirección (texto y HTML)', !!noti && /Dirección: Calle de Prueba 12 int\. 3, Col\. Las Flores, C\.P\. 91190, Xalapa, Veracruz/.test(noti.cuerpo_texto) && /<b>Dirección:<\/b> Calle de Prueba 12 int\. 3/.test(noti.cuerpo_html));
    P = await compra({ direccion: { ...DIR, calle: '<img src=x onerror=alert(1)>', referencias: '<script>x</script>' } });
    const n2 = (await q("SELECT cuerpo_html FROM notificaciones WHERE pedido_id=$1 AND plantilla='confirmacion'", [P.id]))[0];
    t('HTML escrito en la calle se guarda como texto y se escapa en el correo', !!n2 && !/<img src=x/.test(n2.cuerpo_html) && /&lt;img/.test(n2.cuerpo_html));
    P = await compra({ direccion: { cp: '06000', colonia: 'Centro (a mano)', municipio: 'Ciudad de México', calle: 'Reforma', num_ext: 'S/N' } });
    const f3 = (await q('SELECT dir_colonia,dir_municipio,dir_estado,dir_num_int FROM pedidos WHERE id=$1', [P.id]))[0];
    t('código fuera del catálogo con colonia y municipio escritos a mano → pedido válido', P.c.s === 201 && !!P.id && f3.dir_colonia === 'Centro (a mano)' && f3.dir_municipio === 'Ciudad de México' && f3.dir_estado === null && f3.dir_num_int === null, JSON.stringify(P.c.j));
    P = await compra({ direccion: { cp: '91000', colonia: 'xalapa enriquez centro', calle: 'Enríquez', num_ext: 'S/N' } });
    t('la colonia se acepta sin acentos ni mayúsculas y se guarda como en el catálogo', !!P.id && (await q('SELECT dir_colonia FROM pedidos WHERE id=$1', [P.id]))[0].dir_colonia === 'Xalapa Enríquez Centro');

    let av = await call('GET', '/api/avisos', undefined, otro);
    t('un cliente sin pedidos tiene su bandeja vacía', av.s === 200 && av.j.avisos.length === 0 && av.j.no_leidas === 0);
    av = await call('GET', '/api/avisos', undefined, cli);
    const conf = av.j.avisos.find((a) => a.pedido_id === idPrimero);
    t('al pagar, el cliente recibe su aviso de confirmación en la bandeja (sin depender del correo)', !!conf && /confirmado/.test(conf.titulo) && /Recibimos tu pago/.test(conf.mensaje) && conf.leida === false && /^EC-\d{4}$/.test(conf.folio), JSON.stringify(av.j.avisos[0]));
    const antes = av.j.no_leidas;
    t('el contador de no leídas coincide con la lista', antes === av.j.avisos.filter((a) => !a.leida).length && (await call('GET', '/api/avisos/contador', undefined, cli)).j.no_leidas === antes);
    for (const est of ['En preparación', 'Listo para entrega', 'Entregado']) {
      r = await call('PATCH', `/api/cocina/pedidos/${idPrimero}/estatus`, { estatus: est }, est === 'Listo para entrega' ? admin : cocina);
      t(`cocina/administración cambia a “${est}”`, r.s === 200);
    }
    av = await call('GET', '/api/avisos', undefined, cli);
    const delPedido = av.j.avisos.filter((a) => a.pedido_id === idPrimero);
    t('cada cambio de estatus genera su notificación (confirmación + 3 cambios)', delPedido.length === 4 && ['en preparación', 'listo para entrega', 'fue entregado'].every((x) => delPedido.some((a) => a.titulo.toLowerCase().includes(x))), JSON.stringify(delPedido.map((a) => a.titulo)));
    t('las notificaciones vienen de la más nueva a la más vieja', /entregado/.test(delPedido[0].titulo));
    t('el contador subió con las 3 nuevas', (await call('GET', '/api/avisos/contador', undefined, cli)).j.no_leidas === antes + 3);
    t('otro cliente no ve los avisos de este pedido', !(await call('GET', '/api/avisos', undefined, otro)).j.avisos.some((a) => a.pedido_id === idPrimero));
    r = await call('POST', `/api/avisos/${conf.id}/leida`, undefined, otro); t('otro cliente no puede marcar mi aviso como leído → 404', r.s === 404);
    r = await call('POST', `/api/avisos/${conf.id}/leida`, undefined, cli); t('marcar un aviso como leído', r.s === 200 && (await call('GET', '/api/avisos/contador', undefined, cli)).j.no_leidas === antes + 2);
    r = await call('POST', `/api/avisos/${conf.id}/leida`, undefined, cli); t('marcarlo otra vez no falla ni cambia el contador', r.s === 200 && (await call('GET', '/api/avisos/contador', undefined, cli)).j.no_leidas === antes + 2);
    r = await call('POST', '/api/avisos/abc/leida', undefined, cli); t('id inválido → 400', r.s === 400);
    r = await call('POST', '/api/avisos/99999999/leida', undefined, cli); t('aviso inexistente → 404', r.s === 404);
    r = await call('POST', '/api/avisos/leer-todas', undefined, cli); t('marcar todas como leídas deja el contador en cero', r.s === 200 && (await call('GET', '/api/avisos/contador', undefined, cli)).j.no_leidas === 0);
    t('“leer todas” no toca los avisos de otro cliente', (await call('GET', '/api/avisos/contador', undefined, otro)).j.no_leidas === 0);
    for (const [n, tok] of [['sin sesión', null], ['administrador', admin], ['cocina', cocina]]) { r = await call('GET', '/api/avisos', undefined, tok); t(`bandeja de cliente: ${n} → ${tok ? 403 : 401}`, r.s === (tok ? 403 : 401)); }
    t('el correo sigue encolado además de la notificación en pantalla', (await q("SELECT count(*)::int n FROM notificaciones WHERE pedido_id=$1", [idPrimero]))[0].n === 4);

    const viejo = (await q(`INSERT INTO pedidos(cliente_id,presentacion_id,fecha_entrega,hora_entrega,total,estatus) VALUES($1,$2,$3,'17:00',45,'Pendiente') RETURNING id`, [clientes[0], pres, svc.addDays(hoy, 3)]))[0].id;
    await q("INSERT INTO pedido_estatus_historial(pedido_id,estatus) VALUES($1,'Pendiente')", [viejo]);
    r = await call('GET', '/api/pedidos/' + viejo, undefined, cli); t('pedido anterior sin dirección: el comprobante abre y la dirección es null', r.s === 200 && r.j.pedido.entrega.direccion === null);
    r = await call('GET', '/api/cocina/pedidos/' + viejo, undefined, cocina); t('pedido anterior sin dirección: la ficha de cocina abre y la dirección es null', r.s === 200 && r.j.pedido.direccion === null);
    r = await call('GET', '/api/pedidos', undefined, cli); t('“Mis pedidos” con un pedido sin dirección no falla', r.s === 200 && r.j.pedidos.find((x) => x.id === viejo).direccion === null);

    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8'), css = fs.readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8'), appjs = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
    t('la página ya no trae el cartel “Sitio de demostración”', !/Sitio de demostración/.test(html) && !/id="demo"/.test(html) && !appjs.includes('#demo'));
    t('el formulario pide la dirección después de la fecha y hora (paso 5)', appjs.indexOf("'4. Fecha y hora de entrega'") < appjs.indexOf("'5. Dirección de entrega'"));
    t('la hoja de estilos no tiene modo oscuro automático (se conserva el diseño claro)', !/prefers-color-scheme/.test(css));
  } catch (e) {
    fail++; console.log('FAIL error inesperado:', e && e.stack || e);
  } finally {
    try {
      mail.reemplazar(null);
      const ids = clientes.filter(Boolean);
      await db.query('DELETE FROM checkouts WHERE cliente_id = ANY($1)', [ids]);
      await db.query('DELETE FROM movimientos_inventario WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ANY($1))', [ids]);
      await db.query('DELETE FROM pagos WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ANY($1))', [ids]);
      await db.query('DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ANY($1))', [ids]);
      await db.query('DELETE FROM pedido_estatus_historial WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ANY($1))', [ids]).catch(() => {});
      await db.query('DELETE FROM notificaciones WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ANY($1))', [ids]).catch(() => {});
      await db.query('DELETE FROM pedidos WHERE cliente_id = ANY($1)', [ids]);
      await db.query('DELETE FROM usuarios WHERE id = ANY($1)', [ids]);
      await db.query('DELETE FROM movimientos_inventario WHERE id > $1', [movMax]);
      for (const i of insumos0) await db.query('UPDATE insumos SET stock=$2,stock_minimo=$3,costo_unitario=$4,activo=$5 WHERE id=$1', [i.id, i.stock, i.stock_minimo, i.costo_unitario, i.activo]);
    } catch (e) { console.log('Aviso: limpieza incompleta:', e.message); }
    server.close();
    console.log(`\n${pass} correctas, ${fail} fallidas`);
    await db.pool.end();
    process.exit(fail ? 1 : 0);
  }
})();

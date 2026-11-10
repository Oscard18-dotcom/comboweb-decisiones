const { execFileSync } = require('child_process');
const app = require('../src/app');
const db = require('../src/db');
const svc = require('../src/services/pedidos');
const pagos = require('../src/payments');
const stripeLib = require('stripe');

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const server = app.listen(0);
const B = `http://localhost:${server.address().port}`;
async function call(m, p, body, tok) {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch (e) {  }
  return { s: r.status, j };
}
const R = Date.now();
const SECRET = 'whsec_prueba_local_123';
const q = async (sql, p) => (await db.query(sql, p)).rows;
const stock = async (n) => Number((await q('SELECT stock FROM insumos WHERE nombre=$1', [n]))[0].stock);
const hay = (r, codigo) => (r.j.errores || []).some((e) => e.codigo === codigo);

(async () => {
  const stock0 = await q('SELECT id,stock FROM insumos');
  const clientes = [];
  try {
    const base = svc.addDays(svc.todayMX(), 10 + Math.floor(Math.random() * 60));
    const dia = (k) => svc.addDays(base, k);
    const reg = async (n) => { const r = await call('POST', '/api/auth/register', { nombre: 'Cliente ' + n, correo: `c${n}${R}@prueba.test`, password: 'secreta123' }); clientes.push(r.j.usuario.id); return r.j.token; };
    const tA = await reg('A'), tB = await reg('B');
    const admin = (await call('POST', '/api/auth/login', { correo: 'admin@encombo.test', password: process.env.SEED_PASSWORD })).j.token;
    const cat = (await call('GET', '/api/catalogo')).j;
    const P = (n) => cat.productos.find((p) => p.nombre === n).id;
    const PRES = cat.presentaciones.find((p) => p.nombre === 'Caja mediana').id;
    const combo = (o = {}) => ({ items: [{ producto_id: P('Cupcake'), cantidad: 6 }, { producto_id: P('Café latte'), cantidad: 2 }], presentacion_id: PRES, fecha: dia(0), hora: '12:00', dedicatoria: 'Feliz cumpleaños, Ana', direccion: { cp: '91190', colonia: 'Las Flores', calle: 'Calle de Prueba', num_ext: '12' }, ...o });
    const nuevoCheckout = async (tok, o) => { const r = await call('POST', '/api/pedidos/checkout', combo(o), tok); return r; };
    const aprobar = (id, tok) => call('POST', `/api/pagos/simulado/${id}/aprobar`, undefined, tok);

    let r = await call('GET', `/api/pedidos/disponibilidad?fecha=${dia(0)}`);
    t('disponibilidad: 10 horarios, todos libres', r.s === 200 && r.j.horarios.length === 10 && r.j.horarios.every((h) => h.disponible));
    r = await call('GET', '/api/pedidos/disponibilidad?fecha=2026-13-45'); t('disponibilidad: fecha inválida → 400', r.s === 400);
    r = await call('POST', '/api/pedidos/cotizar', { ...combo(), items: [{ producto_id: P('Cupcake'), cantidad: 6, precio: 1, precio_unitario: 1 }, { producto_id: P('Café latte'), cantidad: 2 }], total: 1 });
    t('cotizar: total correcto ($265) e ignora precios enviados por el cliente', r.s === 200 && r.j.ok && r.j.detalle.total === 265, JSON.stringify(r.j).slice(0, 200));
    r = await call('POST', '/api/pedidos/cotizar', { ...combo(), items: [{ producto_id: P('Cupcake'), cantidad: 6 }, { producto_id: P('Cupcake'), cantidad: 4 }] });
    t('cotizar: productos repetidos se suman', r.j.detalle.lineas.length === 1 && r.j.detalle.lineas[0].cantidad === 10);

    const malos = [
      ['sin productos', { items: [] }, 'sin_productos'], ['cantidad 0', { items: [{ producto_id: P('Cupcake'), cantidad: 0 }] }, 'item_invalido'],
      ['cantidad decimal', { items: [{ producto_id: P('Cupcake'), cantidad: 1.5 }] }, 'item_invalido'], ['más de 50 piezas', { items: [{ producto_id: P('Galleta'), cantidad: 51 }] }, 'cantidad_excedida'],
      ['producto inexistente', { items: [{ producto_id: 999999, cantidad: 1 }] }, 'producto_no_disponible'], ['fecha de hoy (sin anticipación)', { fecha: svc.todayMX() }, 'fecha_pasada'],
      ['fecha pasada', { fecha: '2020-01-01' }, 'fecha_pasada'], ['fecha mal formada', { fecha: '2026-02-30' }, 'fecha_invalida'], ['fecha muy lejana', { fecha: svc.addDays(svc.todayMX(), 200) }, 'fecha_lejana'],
      ['hora fuera de horario', { hora: '03:00' }, 'hora_invalida'], ['dedicatoria de 121 caracteres', { dedicatoria: 'x'.repeat(121) }, 'dedicatoria_larga'],
      ['presentación inexistente', { presentacion_id: 999999 }, 'presentacion_no_disponible'],
    ];
    for (const [nombre, o, codigo] of malos) { r = await call('POST', '/api/pedidos/cotizar', combo(o)); t(`cotizar rechaza: ${nombre}`, r.s === 200 && !r.j.ok && hay(r, codigo), JSON.stringify(r.j.errores)); }
    r = await call('POST', '/api/pedidos/cotizar', combo({ dedicatoria: '' })); t('dedicatoria vacía es válida (opcional)', r.j.ok && r.j.detalle.dedicatoria === null);

    const inact = (await q("INSERT INTO productos(nombre,precio,activo) VALUES($1,10,false) RETURNING id", ['Inactivo test ' + R]))[0].id;
    const sinRec = (await q("INSERT INTO productos(nombre,precio,activo) VALUES($1,10,true) RETURNING id", ['SinReceta test ' + R]))[0].id;
    r = await call('POST', '/api/pedidos/cotizar', combo({ items: [{ producto_id: inact, cantidad: 1 }] })); t('producto inactivo no se puede pedir', hay(r, 'producto_no_disponible'));
    r = await call('POST', '/api/pedidos/cotizar', combo({ items: [{ producto_id: sinRec, cantidad: 1 }] })); t('producto activo sin receta no se puede pedir', hay(r, 'producto_sin_receta'));

    await db.query("UPDATE insumos SET stock=30 WHERE nombre='Café molido'");
    r = await call('POST', '/api/pedidos/cotizar', combo());
    t('stock insuficiente: avisa qué insumo falta (ext. 8.a)', !r.j.ok && hay(r, 'stock_insuficiente') && r.j.errores[0].insumos.includes('Café molido') && r.j.detalle.total === 265);
    r = await call('POST', '/api/pedidos/cotizar', combo({ items: [{ producto_id: P('Café latte'), cantidad: 1 }] })); t('con stock justo (18 g de 30) sí se puede', r.j.ok);
    await db.query("UPDATE insumos SET stock=(SELECT stock FROM insumos WHERE nombre='Café molido') WHERE false");
    for (const s of stock0) await db.query('UPDATE insumos SET stock=$2 WHERE id=$1', [s.id, s.stock]);

    r = await call('POST', '/api/pedidos/checkout', combo()); t('checkout sin sesión → 401', r.s === 401);
    r = await call('POST', '/api/pedidos/checkout', combo(), admin); t('checkout con rol admin → 403 (solo clientes compran)', r.s === 403);
    r = await call('POST', '/api/pedidos/checkout', combo({ hora: '03:00' }), tA); t('checkout con datos inválidos → 422 con mensaje', r.s === 422 && r.j.error);

    const antes = {}; for (const n of ['Harina', 'Azúcar', 'Mantequilla', 'Café molido', 'Leche', 'Caja mediana']) antes[n] = await stock(n);
    r = await nuevoCheckout(tA);
    t('checkout creado con enlace de pago', r.s === 201 && r.j.checkout_id && r.j.url.includes('pago-simulado'));
    const ck1 = r.j.checkout_id;
    t('antes de pagar NO existe pedido ni se toca el inventario', (await q('SELECT count(*)::int n FROM pedidos WHERE cliente_id=$1', [clientes[0]]))[0].n === 0 && (await stock('Harina')) === antes.Harina);
    r = await call('POST', `/api/pagos/simulado/${ck1}/aprobar`, undefined, tB); t('otro cliente no puede aprobar mi pago → 404', r.s === 404);
    r = await call('GET', `/api/pedidos/checkout/${ck1}`, undefined, tB); t('otro cliente no ve mi checkout → 404', r.s === 404);
    r = await aprobar(ck1, tA); t('pago aprobado → pedido creado', r.s === 200 && r.j.estado === 'pagado' && r.j.pedido_id);
    const pid1 = r.j.pedido_id;
    t('inventario descontado exactamente', (await stock('Harina')) === antes.Harina - 240 && (await stock('Azúcar')) === antes['Azúcar'] - 180 && (await stock('Mantequilla')) === antes.Mantequilla - 120
      && (await stock('Café molido')) === antes['Café molido'] - 36 && (await stock('Leche')) === antes.Leche - 400 && (await stock('Caja mediana')) === antes['Caja mediana'] - 1);
    t('se registran 6 movimientos de salida ligados al pedido', (await q('SELECT count(*)::int n FROM movimientos_inventario WHERE pedido_id=$1 AND tipo=\'salida\'', [pid1]))[0].n === 6);
    r = await call('GET', `/api/pedidos/${pid1}`, undefined, tA); const ped = r.j.pedido;
    t('comprobante: folio, estatus Pendiente, total, entrega y dedicatoria', ped && /^EC-\d{4,}$/.test(ped.folio) && ped.estatus === 'Pendiente' && ped.total === 265 && ped.entrega.hora === '12:00' && ped.entrega.fecha === dia(0) && ped.dedicatoria === 'Feliz cumpleaños, Ana');
    t('comprobante: desglose y pago aprobado', ped.items.length === 2 && ped.presentacion.precio === 45 && ped.pago.estado === 'aprobado' && !('cliente_id' in ped));
    r = await aprobar(ck1, tA); t('aprobar dos veces NO duplica el pedido (idempotente)', r.j.pedido_id === pid1 && (await q('SELECT count(*)::int n FROM pedidos WHERE cliente_id=$1', [clientes[0]]))[0].n === 1 && (await stock('Harina')) === antes.Harina - 240);
    r = await call('GET', `/api/pedidos/checkout/${ck1}`, undefined, tA); t('estado del checkout = pagado', r.j.checkout.estado === 'pagado' && r.j.checkout.pedido_id === pid1);
    r = await call('GET', `/api/pedidos/${pid1}`, undefined, tB); t('otro cliente no ve el pedido → 404', r.s === 404);
    r = await call('GET', `/api/pedidos/${pid1}`, undefined, admin); t('administración sí ve el pedido', r.s === 200);
    r = await call('GET', '/api/pedidos', undefined, tA); t('mis pedidos: solo los propios', r.j.pedidos.length === 1 && r.j.pedidos[0].id === pid1);
    r = await call('GET', '/api/pedidos', undefined, tB); t('mis pedidos de B: vacío', r.j.pedidos.length === 0);

    r = await call('POST', '/api/pedidos/cotizar', combo({ items: [{ producto_id: P('Galleta'), cantidad: 2 }] }));
    t('1 pedido en el horario: aún hay lugar (capacidad 2)', r.j.ok);
    r = await nuevoCheckout(tB, { items: [{ producto_id: P('Galleta'), cantidad: 2 }] }); const ck2 = r.j.checkout_id;
    r = await aprobar(ck2, tB); t('segundo pedido en el mismo horario se acepta', r.j.estado === 'pagado');
    r = await call('POST', '/api/pedidos/cotizar', combo({ items: [{ producto_id: P('Galleta'), cantidad: 2 }] }));
    t('horario lleno: avisa y sugiere alternativas (ext. 10.a)', !r.j.ok && hay(r, 'horario_ocupado') && r.j.errores.find((e) => e.codigo === 'horario_ocupado').alternativas.length === 9 && !r.j.errores.find((e) => e.codigo === 'horario_ocupado').alternativas.includes('12:00'));
    r = await nuevoCheckout(tA, { items: [{ producto_id: P('Galleta'), cantidad: 2 }] }); t('checkout en horario lleno → 422', r.s === 422);
    r = await call('GET', `/api/pedidos/disponibilidad?fecha=${dia(0)}`); t('disponibilidad refleja 12:00 ocupado', r.j.horarios.find((h) => h.hora === '12:00').disponible === false && r.j.horarios.find((h) => h.hora === '13:00').disponible === true);

    const antesR = await stock('Harina');
    r = await nuevoCheckout(tA, { fecha: dia(1) }); const ck3 = r.j.checkout_id;
    r = await call('POST', `/api/pagos/simulado/${ck3}/rechazar`, undefined, tA); t('pago rechazado', r.j.estado === 'rechazado');
    r = await aprobar(ck3, tA); t('un pago rechazado ya no se puede aprobar', r.j.estado === 'rechazado' && !r.j.pedido_id);
    t('rechazo: sin pedido y sin tocar inventario', (await stock('Harina')) === antesR && (await q('SELECT count(*)::int n FROM pedidos WHERE fecha_entrega=$1', [dia(1)]))[0].n === 0);

    for (const s of stock0) await db.query('UPDATE insumos SET stock=$2 WHERE id=$1', [s.id, s.stock]);
    await db.query("UPDATE insumos SET stock=36 WHERE nombre='Café molido'");
    const latte2 = [{ producto_id: P('Café latte'), cantidad: 2 }];
    const a = (await nuevoCheckout(tA, { items: latte2, fecha: dia(2) })).j.checkout_id, b = (await nuevoCheckout(tB, { items: latte2, fecha: dia(3) })).j.checkout_id;
    const [ra, rb] = await Promise.all([aprobar(a, tA), aprobar(b, tB)]);
    const est = [ra.j.estado, rb.j.estado].sort();
    t('pagos simultáneos por el último stock: uno pagado y otro a revisión', est[0] === 'pagado' && est[1] === 'revision', JSON.stringify(est));
    t('el stock nunca queda negativo', (await stock('Café molido')) === 0);
    t('el pago en revisión no crea pedido', (await q('SELECT count(*)::int n FROM pedidos WHERE fecha_entrega = ANY($1)', [[dia(2), dia(3)]]))[0].n === 1);

    for (const s of stock0) await db.query('UPDATE insumos SET stock=$2 WHERE id=$1', [s.id, s.stock]);
    const gal = [{ producto_id: P('Galleta'), cantidad: 1 }];
    const ids3 = []; for (let i = 0; i < 3; i++) ids3.push((await nuevoCheckout(tA, { items: gal, fecha: dia(4), hora: '15:00' })).j.checkout_id);
    const res3 = await Promise.all(ids3.map((id) => aprobar(id, tA)));
    const e3 = res3.map((x) => x.j.estado).sort();
    t('3 pagos simultáneos en un horario de capacidad 2: 2 pagados y 1 a revisión', e3.join() === 'pagado,pagado,revision', e3.join());
    t('el horario queda con exactamente 2 pedidos', (await q('SELECT count(*)::int n FROM pedidos WHERE fecha_entrega=$1 AND hora_entrega=$2', [dia(4), '15:00']))[0].n === 2);

    process.env.PAYMENT_PROVIDER = 'stripe'; process.env.STRIPE_SECRET_KEY = 'sk_test_falsa'; process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    pagos.reemplazar({ nombre: 'stripe', crearSesion: async ({ checkoutId }) => ({ url: 'https://checkout.stripe.test/' + checkoutId, referencia: 'cs_test_' + checkoutId }) });
    r = await aprobar(ck1, tA); t('endpoints simulados responden 404 cuando el proveedor es Stripe', r.s === 404);
    const evento = (type, obj) => JSON.stringify({ id: 'evt_' + Math.random().toString(36).slice(2), object: 'event', type, data: { object: obj } });
    const hook = async (payload, firma) => { const x = await fetch(B + '/api/pagos/webhook/stripe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': firma }, body: payload }); return x.status; };
    const firmar = (payload) => stripeLib.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    const sesion = (id, o = {}) => ({ id: 'cs_test_' + id, object: 'checkout.session', client_reference_id: id, payment_status: 'paid', amount_total: 26500, currency: 'mxn', ...o });

    const w1 = (await nuevoCheckout(tA, { fecha: dia(5) })); t('checkout con Stripe devuelve la URL de la pasarela', w1.s === 201 && w1.j.url.startsWith('https://checkout.stripe.test/'));
    const id1 = w1.j.checkout_id, pl1 = evento('checkout.session.completed', sesion(id1));
    t('webhook con firma inválida → 400', (await hook(pl1, 't=1,v1=firmafalsa')) === 400);
    t('webhook sin firma → 400', (await hook(pl1, '')) === 400);
    t('webhook alterado después de firmar → 400', (await hook(pl1.replace('26500', '100'), firmar(pl1))) === 400);
    t('sin firma válida no se crea pedido', (await q('SELECT estado FROM checkouts WHERE id=$1', [id1]))[0].estado === 'creado');
    t('webhook válido (pagado) → 200', (await hook(pl1, firmar(pl1))) === 200);
    const ck = (await q('SELECT estado,pedido_id,referencia FROM checkouts WHERE id=$1', [id1]))[0];
    t('webhook válido crea el pedido', ck.estado === 'pagado' && ck.pedido_id && ck.referencia === 'cs_test_' + id1);
    const stDespues = await stock('Harina');
    t('Stripe reenvía el mismo evento → no duplica pedido ni descuento', (await hook(pl1, firmar(pl1))) === 200 && (await q('SELECT count(*)::int n FROM pagos WHERE referencia=$1', ['cs_test_' + id1]))[0].n === 1 && (await stock('Harina')) === stDespues);

    const id2 = (await nuevoCheckout(tA, { fecha: dia(6) })).j.checkout_id, pl2 = evento('checkout.session.completed', sesion(id2, { amount_total: 100 }));
    t('monto distinto al cobrado → 200 pero va a revisión y NO crea pedido', (await hook(pl2, firmar(pl2))) === 200 && (await q('SELECT estado,pedido_id FROM checkouts WHERE id=$1', [id2]))[0].estado === 'revision' && !(await q('SELECT pedido_id FROM checkouts WHERE id=$1', [id2]))[0].pedido_id);
    const id3 = (await nuevoCheckout(tA, { fecha: dia(7) })).j.checkout_id, pl3 = evento('checkout.session.completed', sesion(id3, { currency: 'usd' }));
    t('moneda distinta de MXN → revisión', (await hook(pl3, firmar(pl3))) === 200 && (await q('SELECT estado FROM checkouts WHERE id=$1', [id3]))[0].estado === 'revision');
    const id4 = (await nuevoCheckout(tA, { fecha: dia(8) })).j.checkout_id, pl4 = evento('checkout.session.completed', sesion(id4, { payment_status: 'unpaid' }));
    t('sesión completada pero sin pagar (p. ej. OXXO pendiente) → no crea pedido', (await hook(pl4, firmar(pl4))) === 200 && (await q('SELECT estado FROM checkouts WHERE id=$1', [id4]))[0].estado === 'creado');
    const pl4b = evento('checkout.session.async_payment_succeeded', sesion(id4));
    t('pago diferido confirmado después → crea el pedido', (await hook(pl4b, firmar(pl4b))) === 200 && (await q('SELECT estado FROM checkouts WHERE id=$1', [id4]))[0].estado === 'pagado');
    const id5 = (await nuevoCheckout(tA, { fecha: dia(9) })).j.checkout_id, pl5 = evento('checkout.session.expired', sesion(id5, { payment_status: 'unpaid' }));
    t('sesión expirada → checkout expirado', (await hook(pl5, firmar(pl5))) === 200 && (await q('SELECT estado FROM checkouts WHERE id=$1', [id5]))[0].estado === 'expirado');
    const pl6 = evento('checkout.session.completed', sesion('no-es-uuid'));
    t('evento con referencia no válida se ignora sin error', (await hook(pl6, firmar(pl6))) === 200);
    const pl7 = evento('charge.refunded', { id: 'ch_1' });
    t('eventos que no usamos → 200', (await hook(pl7, firmar(pl7))) === 200);

    process.env.PAYMENT_PROVIDER = 'simulado'; pagos.reemplazar(null);
    const tk = (await nuevoCheckout(tA, { fecha: dia(10) })).j.checkout_id;
    process.env.NODE_ENV = 'production';
    r = await aprobar(tk, tA); t('en producción el pago simulado NO existe (404)', r.s === 404);
    delete process.env.NODE_ENV;
    let rechazo = false;
    try { execFileSync('node', ['-e', "require('./src/config')"], { env: { ...process.env, NODE_ENV: 'production', PAYMENT_PROVIDER: 'simulado' }, stdio: 'pipe' }); } catch (e) { rechazo = /producción/.test(String(e.stderr)); }
    t('el servidor se niega a arrancar en producción con pago simulado', rechazo);
  } catch (e) {
    fail++; console.log('FAIL error inesperado:', e);
  } finally {
    try {
      const ids = clientes.length ? clientes : [0];
      await db.query('DELETE FROM checkouts WHERE cliente_id = ANY($1)', [ids]);
      await db.query('DELETE FROM movimientos_inventario WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ANY($1))', [ids]);
      await db.query('DELETE FROM pagos WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ANY($1))', [ids]);
      await db.query('DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = ANY($1))', [ids]);
      await db.query('DELETE FROM pedidos WHERE cliente_id = ANY($1)', [ids]);
      await db.query('DELETE FROM usuarios WHERE id = ANY($1)', [ids]);
      await db.query("DELETE FROM productos WHERE nombre LIKE 'Inactivo test %' OR nombre LIKE 'SinReceta test %'");
      for (const s of stock0) await db.query('UPDATE insumos SET stock=$2 WHERE id=$1', [s.id, s.stock]);
    } catch (e) { console.log('Aviso: limpieza incompleta:', e.message); }
    console.log(`\n${pass} correctas, ${fail} fallidas`);
    server.close(); await db.pool.end(); process.exit(fail ? 1 : 0);
  }
})();

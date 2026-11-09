const app = require('../src/app');
const db = require('../src/db');
const svc = require('../src/services/pedidos');

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
const q = async (sql, p) => (await db.query(sql, p)).rows;
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

(async () => {
  const insumos0 = await q('SELECT * FROM insumos ORDER BY id');
  const movMax = (await q('SELECT coalesce(max(id),0) AS m FROM movimientos_inventario'))[0].m;
  const clientes = [];
  try {
    const login = async (c) => (await call('POST', '/api/auth/login', { correo: c, password: process.env.SEED_PASSWORD })).j.token;
    const admin = await login('admin@encombo.test'), almacen = await login('almacen@encombo.test'), cocina = await login('cocina@encombo.test');
    const rc = await call('POST', '/api/auth/register', { nombre: 'Cliente Sprint4', correo: `s4${R}@prueba.test`, password: 'secreta123' });
    const cliente = rc.j.token; clientes.push(rc.j.usuario.id);
    const base = svc.addDays(svc.todayMX(), 10 + Math.floor(Math.random() * 60)); const dia = (k) => svc.addDays(base, k);
    const lista = async () => (await call('GET', '/api/inventario?inactivos=1', undefined, almacen)).j.insumos;
    const porNombre = async (n) => (await lista()).find((i) => i.nombre === n);

    let r = await call('GET', '/api/inventario'); t('inventario sin sesión → 401', r.s === 401);
    r = await call('GET', '/api/inventario', undefined, cliente); t('cliente en inventario → 403', r.s === 403);
    r = await call('GET', '/api/inventario', undefined, cocina); t('cocina en inventario → 403', r.s === 403);
    r = await call('GET', '/api/inventario', undefined, almacen); t('encargado de almacén ve el inventario', r.s === 200 && r.j.insumos.length >= 10);
    r = await call('GET', '/api/inventario', undefined, admin); t('administrador ve el inventario', r.s === 200);
    const harina = await porNombre('Harina');
    t('cada insumo trae estado de reorden y uso en recetas', typeof harina.en_reorden === 'boolean' && harina.en_uso >= 3);

    const malos = [['nombre muy corto', { nombre: 'x', unidad: 'g' }], ['sin unidad', { nombre: 'Test4 A', unidad: '' }], ['stock negativo', { nombre: 'Test4 A', unidad: 'g', stock: -1 }],
      ['stock no numérico', { nombre: 'Test4 A', unidad: 'g', stock: 'abc' }], ['mínimo negativo', { nombre: 'Test4 A', unidad: 'g', stock_minimo: -5 }], ['costo negativo', { nombre: 'Test4 A', unidad: 'g', costo_unitario: -1 }],
      ['5 decimales', { nombre: 'Test4 A', unidad: 'g', stock: 1.23456 }]];
    for (const [n, b] of malos) { r = await call('POST', '/api/inventario', b, almacen); t(`crear insumo rechaza: ${n}`, r.s === 400, r.s); }
    const NOM = `Test4 Insumo ${R}`;
    r = await call('POST', '/api/inventario', { nombre: NOM, unidad: 'g', stock: 100, stock_minimo: 20, costo_unitario: 0.5 }, almacen);
    t('crear insumo', r.s === 201 && r.j.insumo.stock === 100 && r.j.insumo.stock_minimo === 20 && r.j.insumo.en_reorden === false); const id = r.j.insumo.id;
    r = await call('GET', `/api/inventario/${id}/movimientos`, undefined, almacen);
    t('el stock inicial queda en el historial como entrada', r.j.movimientos.length === 1 && r.j.movimientos[0].tipo === 'entrada' && r.j.movimientos[0].cantidad === 100);
    r = await call('POST', '/api/inventario', { nombre: NOM, unidad: 'g' }, almacen); t('nombre duplicado → 409', r.s === 409);
    r = await call('PUT', `/api/inventario/${id}`, { stock: 5 }, almacen); t('el stock NO se edita directamente (solo con movimientos)', r.s === 400);
    r = await call('PUT', `/api/inventario/${id}`, { stock_minimo: 30, costo_unitario: 0.75 }, almacen); t('editar mínimo y costo', r.s === 200 && r.j.insumo.stock_minimo === 30 && r.j.insumo.costo_unitario === 0.75 && r.j.insumo.stock === 100);
    r = await call('PUT', `/api/inventario/${id}`, { nombre: 'Harina' }, almacen); t('renombrar a un nombre existente → 409', r.s === 409);
    r = await call('PUT', `/api/inventario/${id}`, { stock_minimo: -1 }, almacen); t('mínimo inválido → 400', r.s === 400);
    r = await call('PUT', '/api/inventario/999999', { stock_minimo: 1 }, almacen); t('editar insumo inexistente → 404', r.s === 404);

    const mov = (body, tok = almacen) => call('POST', `/api/inventario/${id}/movimientos`, body, tok);
    r = await mov({ tipo: 'entrada', cantidad: 50, nota: 'Compra proveedor' }); t('entrada suma al stock', r.s === 201 && r.j.insumo.stock === 150 && r.j.movimiento.tipo === 'entrada');
    r = await mov({ tipo: 'salida', cantidad: 30, nota: 'Merma' }); t('salida resta al stock', r.s === 201 && r.j.insumo.stock === 120);
    r = await mov({ tipo: 'salida', cantidad: 1000 }); t('salida mayor al stock → 409 y el stock no cambia', r.s === 409 && (await porNombre(NOM)).stock === 120, JSON.stringify(r.j));
    for (const [n, b] of [['cantidad 0', { tipo: 'entrada', cantidad: 0 }], ['cantidad negativa', { tipo: 'entrada', cantidad: -5 }], ['cantidad no numérica', { tipo: 'salida', cantidad: 'x' }],
      ['5 decimales', { tipo: 'entrada', cantidad: 0.00001 }], ['tipo desconocido', { tipo: 'otro', cantidad: 1 }], ['nota larga', { tipo: 'entrada', cantidad: 1, nota: 'x'.repeat(201) }], ['ajuste negativo', { tipo: 'ajuste', cantidad: -3 }]]) {
      r = await mov(b); t(`movimiento rechaza: ${n}`, r.s === 400, r.s);
    }
    t('los movimientos rechazados no cambian el stock', (await porNombre(NOM)).stock === 120);
    r = await mov({ tipo: 'ajuste', cantidad: 100, nota: 'Conteo físico' }); t('ajuste fija el stock real', r.s === 201 && r.j.insumo.stock === 100 && r.j.movimiento.cantidad === -20);
    r = await mov({ tipo: 'entrada', cantidad: 0.1 }); r = await mov({ tipo: 'entrada', cantidad: 0.2 }); t('decimales exactos (0.1 + 0.2 = 0.3)', (await porNombre(NOM)).stock === 100.3);
    r = await mov({ tipo: 'ajuste', cantidad: 100 }, admin); t('el administrador también registra movimientos', r.s === 201 && r.j.insumo.stock === 100);
    r = await call('GET', `/api/inventario/${id}/movimientos`, undefined, almacen);
    t('historial: más reciente primero, con tipo, nota y quién lo hizo', r.j.movimientos.length === 7 && r.j.movimientos[0].tipo === 'ajuste' && r.j.movimientos.some((m) => m.nota === 'Merma' && m.usuario === 'Almacén EN COMBO'));
    r = await call('POST', '/api/inventario/999999/movimientos', { tipo: 'entrada', cantidad: 1 }, almacen); t('movimiento a insumo inexistente → 404', r.s === 404);
    r = await call('POST', `/api/inventario/${id}/movimientos`, { tipo: 'entrada', cantidad: 1 }, cliente); t('cliente no puede registrar movimientos → 403', r.s === 403);

    await mov({ tipo: 'ajuste', cantidad: 30 });
    r = await call('GET', '/api/inventario/alertas', undefined, admin); let a = r.j.alertas.find((x) => x.id === id);
    t('stock igual al mínimo → genera alerta con stock, mínimo y sugerido', a && a.stock === 30 && a.stock_minimo === 30 && a.sugerido_reponer === 30);
    await mov({ tipo: 'salida', cantidad: 10 });
    r = await call('GET', '/api/inventario/alertas', undefined, almacen); a = r.j.alertas.find((x) => x.id === id); t('stock por debajo del mínimo → sigue la alerta (almacén también la ve)', a && a.stock === 20 && a.sugerido_reponer === 40);
    await mov({ tipo: 'entrada', cantidad: 20 });
    r = await call('GET', '/api/inventario/alertas', undefined, admin); t('al reponer sobre el mínimo la alerta se retira sola', !r.j.alertas.some((x) => x.id === id));

    r = await call('DELETE', `/api/inventario/${harina.id}`, undefined, almacen); t('eliminar insumo usado en recetas → 409 y dice en cuáles', r.s === 409 && /Cupcake/.test(r.j.error) && /Brownie/.test(r.j.error), r.j.error);
    const caja = await porNombre('Caja mediana'); r = await call('DELETE', `/api/inventario/${caja.id}`, undefined, almacen); t('eliminar un insumo usado en una presentación → 409', r.s === 409 && /presentación/.test(r.j.error));
    r = await call('PUT', `/api/inventario/${harina.id}`, { activo: false }, almacen); t('archivar un insumo usado en recetas → 409', r.s === 409);
    r = await call('PUT', `/api/inventario/${harina.id}`, { unidad: 'kg' }, almacen); t('cambiar la unidad de un insumo usado en recetas → 409', r.s === 409);
    r = await call('POST', '/api/inventario', { nombre: `Test4 Nuevo ${R}`, unidad: 'pza' }, almacen); const idN = r.j.insumo.id;
    r = await call('DELETE', `/api/inventario/${idN}`, undefined, almacen); t('insumo nuevo sin historial se elimina de verdad', r.s === 200 && r.j.eliminado === true && !(await lista()).some((i) => i.id === idN));
    r = await call('DELETE', `/api/inventario/${id}`, undefined, almacen); t('insumo con historial se archiva (no se pierde el historial)', r.s === 200 && r.j.archivado === true);
    t('el archivado sale de la lista normal y aparece con ?inactivos=1', !(await call('GET', '/api/inventario', undefined, almacen)).j.insumos.some((i) => i.id === id) && (await lista()).some((i) => i.id === id && i.activo === false));
    r = await mov({ tipo: 'entrada', cantidad: 1 }); t('no se registran movimientos en un insumo archivado → 409', r.s === 409);
    r = await call('PUT', `/api/inventario/${id}`, { activo: true }, almacen); t('se puede reactivar', r.s === 200 && r.j.insumo.activo === true);

    await mov({ tipo: 'ajuste', cantidad: 50 });
    const salidas = await Promise.all(Array.from({ length: 10 }, () => mov({ tipo: 'salida', cantidad: 10 })));
    t('10 salidas simultáneas de 10 sobre stock 50: 5 se aceptan y 5 se rechazan', salidas.filter((x) => x.s === 201).length === 5 && salidas.filter((x) => x.s === 409).length === 5);
    t('el stock queda en 0 (nunca negativo)', (await porNombre(NOM)).stock === 0);
    await Promise.all(Array.from({ length: 10 }, () => mov({ tipo: 'entrada', cantidad: 5 })));
    t('10 entradas simultáneas de 5 suman exactamente 50 (sin pérdidas)', (await porNombre(NOM)).stock === 50);

    const cat = (await call('GET', '/api/catalogo')).j; const P = (n) => cat.productos.find((p) => p.nombre === n).id; const PRES = cat.presentaciones.find((p) => p.nombre === 'Caja mediana').id;
    const comprar = async (items, fecha) => {
      const ck = await call('POST', '/api/pedidos/checkout', { items, presentacion_id: PRES, fecha, hora: '12:00', direccion: { cp: '91190', colonia: 'Las Flores', calle: 'Calle de Prueba', num_ext: '12' } }, cliente);
      if (ck.s !== 201) return ck;
      return call('POST', `/api/pagos/simulado/${ck.j.checkout_id}/aprobar`, undefined, cliente);
    };
    const cafe = await porNombre('Café molido'); await call('POST', `/api/inventario/${cafe.id}/movimientos`, { tipo: 'ajuste', cantidad: cafe.stock_minimo + 10 }, almacen);
    r = await comprar([{ producto_id: P('Café americano'), cantidad: 1 }], dia(0));
    t('un pedido descuenta el café y deja el insumo bajo su mínimo', r.j.estado === 'pagado' && (await porNombre('Café molido')).stock === cafe.stock_minimo - 8);
    r = await call('GET', '/api/inventario/alertas', undefined, admin); t('…y por eso aparece en las alertas de reorden', r.j.alertas.some((x) => x.nombre === 'Café molido'));
    r = await call('GET', `/api/inventario/${cafe.id}/movimientos`, undefined, almacen); t('el movimiento del pedido queda en el historial ligado al pedido', r.j.movimientos[0].tipo === 'salida' && r.j.movimientos[0].pedido_id);
    await call('POST', `/api/inventario/${cafe.id}/movimientos`, { tipo: 'entrada', cantidad: 500, nota: 'Compra' }, almacen);
    r = await call('GET', '/api/inventario/alertas', undefined, admin); t('al comprar café la alerta se retira', !r.j.alertas.some((x) => x.nombre === 'Café molido'));

    r = await call('GET', '/api/recetas', undefined, almacen); t('almacén no ve recetas ni costos → 403', r.s === 403);
    r = await call('GET', '/api/recetas', undefined, cliente); t('cliente en recetas → 403', r.s === 403);
    r = await call('GET', '/api/recetas'); t('recetas sin sesión → 401', r.s === 401);
    r = await call('GET', '/api/recetas', undefined, admin); const cup = r.j.recetas.find((x) => x.producto === 'Cupcake');
    t('lista las 6 recetas iniciales', r.s === 200 && r.j.recetas.length >= 6);
    t('costeo del Cupcake: ingredientes, costo y margen correctos', cup && cup.rinde === 1 && cup.ingredientes.length === 3 && cup.costo_total === 4.46 && cup.costo_pieza === 4.46 && near(cup.margen_pct, 82.2, 0.05), JSON.stringify(cup && [cup.costo_total, cup.margen_pct]));

    const mk = async (nombre, precio) => (await call('POST', '/api/admin/productos', { nombre, descripcion: 'Producto de prueba', precio }, admin)).j.producto.id;
    const pPan = await mk(`Prod4 Pan ${R}`, 40), pFrac = await mk(`Prod4 Fracción ${R}`, 20);
    const ins = (n) => harina && n; const az = await porNombre('Azúcar'), mant = await porNombre('Mantequilla');
    const rec = (producto_id, rinde, ingredientes) => call('POST', '/api/recetas', { producto_id, rinde, ingredientes }, admin);
    const ING = [{ insumo_id: harina.id, cantidad: 480 }, { insumo_id: az.id, cantidad: 360 }, { insumo_id: mant.id, cantidad: 240 }];
    r = await rec(pPan, 12, ING); const R1 = r.j.receta;
    t('crear receta con rinde 12: costo total y por pieza', r.s === 201 && R1.costo_total === 53.52 && R1.costo_pieza === 4.46 && R1.ingredientes.length === 3 && near(R1.margen_pct, 88.9, 0.1), JSON.stringify(R1 || r.j));
    const duo = (o) => ({ insumo_id: harina.id, cantidad: 1, ...o });
    const maloR = [['rinde 0', 0, ING], ['rinde decimal', 1.5, ING], ['rinde 1001', 1001, ING], ['sin ingredientes', 1, []], ['ingrediente repetido', 1, [duo(), duo()]], ['cantidad 0', 1, [duo({ cantidad: 0 })]],
      ['cantidad negativa', 1, [duo({ cantidad: -1 })]], ['cantidad no numérica', 1, [duo({ cantidad: 'x' })]], ['4 decimales', 1, [duo({ cantidad: 0.0001 })]], ['insumo inexistente', 1, [duo({ insumo_id: 999999 })]]];
    for (const [n, rinde, ing] of maloR) { r = await rec(pFrac, rinde, ing); t(`receta rechaza: ${n}`, r.s === 400, `${r.s} ${r.j.error}`); }
    const archivado = (await call('POST', '/api/inventario', { nombre: `Test4 Archivado ${R}`, unidad: 'g' }, almacen)).j.insumo; await call('DELETE', `/api/inventario/${archivado.id}`, undefined, almacen);
    r = await rec(pFrac, 1, [duo({ insumo_id: archivado.id })]); t('receta con un insumo archivado o borrado → 400', r.s === 400);
    r = await rec(999999, 1, ING); t('receta para un producto inexistente → 404', r.s === 404);
    r = await call('POST', '/api/recetas', { rinde: 1, ingredientes: ING }, admin); t('receta sin producto → 400', r.s === 400);
    r = await rec(pPan, 12, ING); t('segunda receta para el mismo producto → 409', r.s === 409);
    t('las recetas rechazadas no dejaron nada guardado', (await q('SELECT count(*)::int n FROM recetas WHERE producto_id=$1', [pFrac]))[0].n === 0);

    r = await call('PUT', `/api/recetas/${R1.id}`, { rinde: 6, ingredientes: [{ insumo_id: harina.id, cantidad: 300 }, { insumo_id: az.id, cantidad: 100 }] }, admin);
    t('editar receta reemplaza ingredientes y recalcula costos', r.s === 200 && r.j.receta.rinde === 6 && r.j.receta.ingredientes.length === 2 && r.j.receta.costo_total === 9.2 && r.j.receta.costo_pieza === 1.53, JSON.stringify(r.j.receta && [r.j.receta.costo_total, r.j.receta.costo_pieza]));
    r = await call('PUT', `/api/recetas/${R1.id}`, { rinde: 6, ingredientes: [{ insumo_id: harina.id, cantidad: 999 }, { insumo_id: 999999, cantidad: 1 }] }, admin);
    const intacta = (await call('GET', `/api/recetas/${R1.id}`, undefined, admin)).j.receta;
    t('edición con error: operación denegada y la receta anterior queda intacta', r.s === 400 && intacta.ingredientes.length === 2 && intacta.ingredientes.find((i) => i.insumo_id === harina.id).cantidad === 300);
    r = await call('PUT', '/api/recetas/999999', { rinde: 1, ingredientes: ING }, admin); t('editar receta inexistente → 404', r.s === 404);
    await call('PUT', `/api/recetas/${R1.id}`, { rinde: 12, ingredientes: ING }, admin);

    const costoAntes = (await call('GET', `/api/recetas/${R1.id}`, undefined, admin)).j.receta.costo_total;
    await call('PUT', `/api/inventario/${mant.id}`, { costo_unitario: mant.costo_unitario + 1 }, almacen);
    const costoDesp = (await call('GET', `/api/recetas/${R1.id}`, undefined, admin)).j.receta.costo_total;
    t('si sube el costo de un insumo, el costo de la receta se actualiza (+240 g × $1)', near(costoDesp - costoAntes, 240, 0.01), `${costoAntes} → ${costoDesp}`);
    await call('PUT', `/api/inventario/${mant.id}`, { costo_unitario: mant.costo_unitario }, almacen);

    r = await call('PATCH', `/api/admin/productos/${pPan}/activo`, { activo: true }, admin); t('con receta ya se puede activar el producto', r.s === 200 && r.j.producto.activo === true);
    t('el producto activo aparece en el catálogo público', (await call('GET', '/api/catalogo')).j.productos.some((p) => p.id === pPan));
    const antes = { h: (await porNombre('Harina')).stock, a: (await porNombre('Azúcar')).stock, m: (await porNombre('Mantequilla')).stock };
    r = await comprar([{ producto_id: pPan, cantidad: 3 }], dia(1));
    t('pedido de 3 piezas (receta de 12): descuenta 120 g de harina, 90 g de azúcar y 60 g de mantequilla',
      r.j.estado === 'pagado' && near(antes.h - (await porNombre('Harina')).stock, 120) && near(antes.a - (await porNombre('Azúcar')).stock, 90) && near(antes.m - (await porNombre('Mantequilla')).stock, 60));

    r = await rec(pFrac, 7, [{ insumo_id: harina.id, cantidad: 100 }]); t('crear receta de rinde 7', r.s === 201);
    await call('PATCH', `/api/admin/productos/${pFrac}/activo`, { activo: true }, admin);
    let h0 = (await porNombre('Harina')).stock; r = await comprar([{ producto_id: pFrac, cantidad: 1 }], dia(2));
    t('1 pieza de rinde 7 descuenta 14.2858 g (redondeo hacia arriba, no hacia abajo)', r.j.estado === 'pagado' && near(h0 - (await porNombre('Harina')).stock, 14.2858, 1e-6));
    h0 = (await porNombre('Harina')).stock; r = await comprar([{ producto_id: pFrac, cantidad: 3 }], dia(3));
    t('3 piezas descuentan 42.8572 g', r.j.estado === 'pagado' && near(h0 - (await porNombre('Harina')).stock, 42.8572, 1e-6));

    r = await call('DELETE', `/api/recetas/${R1.id}`, undefined, admin); t('no se borra la receta de un producto activo → 409', r.s === 409);
    await call('PATCH', `/api/admin/productos/${pPan}/activo`, { activo: false }, admin);
    r = await call('DELETE', `/api/recetas/${R1.id}`, undefined, admin); t('con el producto desactivado sí se borra la receta', r.s === 200 && r.j.eliminada === true);
    r = await call('PATCH', `/api/admin/productos/${pPan}/activo`, { activo: true }, admin); t('sin receta el producto ya no se puede activar → 409', r.s === 409);
    r = await call('GET', `/api/recetas/${R1.id}`, undefined, admin); t('la receta borrada ya no existe → 404', r.s === 404);
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
      await db.query("DELETE FROM productos WHERE nombre LIKE 'Prod4 %'");
      await db.query('DELETE FROM movimientos_inventario WHERE id > $1', [movMax]);
      await db.query("DELETE FROM movimientos_inventario WHERE insumo_id IN (SELECT id FROM insumos WHERE nombre LIKE 'Test4 %')");
      await db.query("DELETE FROM insumos WHERE nombre LIKE 'Test4 %'");
      for (const i of insumos0) await db.query('UPDATE insumos SET nombre=$2,unidad=$3,stock=$4,stock_minimo=$5,costo_unitario=$6,activo=$7 WHERE id=$1', [i.id, i.nombre, i.unidad, i.stock, i.stock_minimo, i.costo_unitario, i.activo]);
    } catch (e) { console.log('Aviso: limpieza incompleta:', e.message); }
    console.log(`\n${pass} correctas, ${fail} fallidas`);
    server.close(); await db.pool.end(); process.exit(fail ? 1 : 0);
  }
})();

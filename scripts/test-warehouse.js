const app = require('../src/app');
const db = require('../src/db');
const svc = require('../src/services/pedidos');
const mail = require('../src/mail');
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const server = app.listen(0);
const B = `http://localhost:${server.address().port}`;
async function call(m, p, body, tok) {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const texto = await r.text(); let j = {}; try { j = JSON.parse(texto); } catch (e) {  }
  return { s: r.status, j, texto };
}
const q = async (sql, p) => (await db.query(sql, p)).rows;
const R = Date.now();

(async () => {
  const insumos0 = await q('SELECT id,stock FROM insumos');
  const movMax = (await q('SELECT coalesce(max(id),0) AS m FROM movimientos_inventario'))[0].m;
  const clientes = [];
  mail.reemplazar({ nombre: 'prueba', async enviar() {} });
  try {
    const login = async (c) => (await call('POST', '/api/auth/login', { correo: c, password: process.env.SEED_PASSWORD })).j.token;
    const admin = await login('admin@encombo.test'), cocina = await login('cocina@encombo.test'), almacen = await login('almacen@encombo.test');
    const rc = await call('POST', '/api/auth/register', { nombre: 'Cliente DW', correo: `dw${R}@prueba.test`, password: 'secreta123' }); clientes.push(rc.j.usuario.id); const cli = rc.j.token;

    for (const [n, tok] of [['sin sesión', undefined], ['cliente', cli], ['cocina', cocina], ['almacén', almacen]]) {
      const a = await call('GET', '/api/warehouse/resumen', undefined, tok), b = await call('POST', '/api/warehouse/cargar', { demo: true }, tok), c = await call('GET', '/api/warehouse/exportar', undefined, tok), d = await call('DELETE', '/api/warehouse/demo', undefined, tok);
      const esp = tok ? 403 : 401; t(`${n}: resumen/cargar/exportar/borrar demo → ${esp}`, [a, b, c, d].every((x) => x.s === esp), [a.s, b.s, c.s, d.s].join());
    }

    const cat = (await call('GET', '/api/catalogo')).j, gal = cat.productos.find((p) => p.nombre === 'Galleta'), pres = cat.presentaciones.find((x) => x.nombre === 'Caja mediana');
    const fecha = svc.addDays(svc.todayMX(), 20 + Math.floor(Math.random() * 60));
    const DIR = { cp: '91190', colonia: 'Las Flores', calle: 'Calle DW', num_ext: '1' };
    const ck = await call('POST', '/api/pedidos/checkout', { items: [{ producto_id: gal.id, cantidad: 3 }], presentacion_id: pres.id, fecha, hora: '12:00', direccion: DIR }, cli);
    const ap = await call('POST', `/api/pagos/simulado/${ck.j.checkout_id}/aprobar`, undefined, cli);
    t('se creó un pedido real para el ETL', ck.s === 201 && ap.j.pedido_id > 0, ck.texto.slice(0, 160));
    let r = await call('POST', '/api/warehouse/cargar', { demo: false }, admin);
    t('cargar (solo pedidos reales) → 200', r.s === 200 && r.j.ok && r.j.pedidos >= 1, r.texto);
    let f = await q("SELECT f.*, d.fecha::text AS fecha, p.nombre FROM dw.fact_ventas f JOIN dw.dim_fecha d USING(fecha_key) JOIN dw.dim_producto p USING(producto_key) WHERE f.pedido_id=$1", [ap.j.pedido_id]);
    t('el hecho tiene fecha, producto, cantidad e ingreso correctos', f.length === 1 && f[0].fecha === fecha && f[0].nombre === 'Galleta' && f[0].cantidad === 3 && Math.abs(Number(f[0].ingreso) - 3 * Number(gal.precio)) < 0.01 && f[0].origen === 'pedido', JSON.stringify(f));
    const zona = await q('SELECT z.* FROM dw.fact_ventas f JOIN dw.dim_zona z USING(zona_key) WHERE f.pedido_id=$1', [ap.j.pedido_id]);
    t('la dimensión de zona toma el código postal y la colonia del pedido', zona[0] && zona[0].cp === '91190' && zona[0].colonia === 'Las Flores');
    await call('POST', '/api/warehouse/cargar', { demo: false }, admin);
    t('cargar dos veces no duplica los hechos (idempotente)', (await q('SELECT count(*)::int AS n FROM dw.fact_ventas WHERE pedido_id=$1', [ap.j.pedido_id]))[0].n === 1);
    const sinHuerfanos = await q(`SELECT (SELECT count(*) FROM dw.fact_ventas f LEFT JOIN dw.dim_fecha d USING(fecha_key) WHERE d.fecha_key IS NULL)::int AS a,
      (SELECT count(*) FROM dw.fact_ventas f LEFT JOIN dw.dim_producto d USING(producto_key) WHERE d.producto_key IS NULL)::int AS b,
      (SELECT count(*) FROM dw.fact_ventas f LEFT JOIN dw.dim_zona d USING(zona_key) WHERE d.zona_key IS NULL)::int AS c`);
    t('integridad: ningún hecho sin su dimensión', sinHuerfanos[0].a === 0 && sinHuerfanos[0].b === 0 && sinHuerfanos[0].c === 0);

    r = await call('POST', '/api/warehouse/cargar', { demo: true }, admin);
    t('cargar con demostración → cientos de filas', r.s === 200 && r.j.demo > 500, r.texto);
    const antes = (await q("SELECT count(*)::int AS n, sum(ingreso)::float AS i FROM dw.fact_ventas WHERE origen='demo'"))[0];
    await call('POST', '/api/warehouse/cargar', { demo: true }, admin);
    const despues = (await q("SELECT count(*)::int AS n, sum(ingreso)::float AS i FROM dw.fact_ventas WHERE origen='demo'"))[0];
    t('la demostración es repetible (mismos datos al recargar, sin duplicar)', antes.n === despues.n && Math.abs(antes.i - despues.i) < 0.01);
    const meses = (await q("SELECT count(DISTINCT d.anio*100+d.mes)::int AS n FROM dw.fact_ventas f JOIN dw.dim_fecha d USING(fecha_key) WHERE f.origen='demo'"))[0].n;
    t('la demostración cubre 12 o 13 meses', meses >= 12 && meses <= 13, meses);
    r = await call('GET', '/api/warehouse/resumen', undefined, admin);
    const rs = r.j;
    t('resumen: KPIs coherentes (ingreso > 0, utilidad ≤ ingreso, margen entre 0 y 1)', r.s === 200 && rs.kpis.ingreso > 0 && rs.kpis.utilidad <= rs.kpis.ingreso && rs.kpis.margen > 0 && rs.kpis.margen <= 1, JSON.stringify(rs.kpis));
    t('resumen: la suma por mes, por zona y por día de la semana coincide con el total', [rs.meses, rs.zonas, rs.dias].every((g) => Math.abs(g.reduce((a, x) => a + x.ingreso, 0) - rs.kpis.ingreso) < 1), '');
    t('resumen: 7 días, temporadas y productos presentes', rs.dias.length === 7 && rs.temporadas.length >= 4 && rs.productos.length >= 1 && rs.productos.length <= 10);
    t('resumen: diciembre rinde más por día que enero (estacionalidad de la demo)', (() => { const d = rs.meses.find((m) => /diciembre/.test(m.etiqueta)), e = rs.meses.find((m) => /^enero/.test(m.etiqueta)); return d && e && d.ingreso > e.ingreso; })());
    const sol = (await call('GET', '/api/warehouse/resumen?origen=pedido', undefined, admin)).j, dem = (await call('GET', '/api/warehouse/resumen?origen=demo', undefined, admin)).j, raro = await call('GET', '/api/warehouse/resumen?origen=x%27%3Bdrop', undefined, admin);
    t('filtro por origen: pedidos reales vs demostración', sol.kpis.ingreso > 0 && sol.kpis.ingreso < dem.kpis.ingreso && Math.abs(sol.kpis.ingreso + dem.kpis.ingreso - rs.kpis.ingreso) < 0.1);
    t('un origen inválido no rompe nada (se usa "todos")', raro.s === 200 && raro.j.origen === 'todos');
    t('el resumen informa la última carga', rs.ultima_carga && /pedidos/.test(rs.ultima_carga.tipo));

    r = await call('GET', '/api/warehouse/exportar', undefined, admin);
    const nombres = (r.j.archivos || []).map((a) => a.nombre).sort();
    t('exportar → 5 archivos CSV (4 dimensiones + hechos)', nombres.join() === 'dw_dim_fecha.csv,dw_dim_presentacion.csv,dw_dim_producto.csv,dw_dim_zona.csv,dw_fact_ventas.csv', nombres.join());
    const hechos = r.j.archivos.find((a) => a.nombre === 'dw_fact_ventas.csv').contenido.trim().split('\n');
    t('CSV de hechos: encabezado y una fila por hecho', hechos[0] === 'venta_id,fecha_key,producto_key,presentacion_key,zona_key,pedido_id,origen,cantidad,ingreso,costo' && hechos.length - 1 === (await q('SELECT count(*)::int AS n FROM dw.fact_ventas'))[0].n);
    t('CSV de fechas: solo fechas con ventas, con nombre de mes y temporada', (() => { const l = r.j.archivos.find((a) => a.nombre === 'dw_dim_fecha.csv').contenido.split('\n'); return l[0].startsWith('fecha_key,fecha,anio') && /,(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre),/.test(l[1]); })());

    r = await call('DELETE', '/api/warehouse/demo', undefined, admin);
    t('quitar demostración borra solo lo de demostración', r.j.ok && r.j.borradas > 500 && (await q("SELECT count(*)::int AS n FROM dw.fact_ventas WHERE origen='demo'"))[0].n === 0 && (await q("SELECT count(*)::int AS n FROM dw.fact_ventas WHERE pedido_id=$1", [ap.j.pedido_id]))[0].n === 1);
    r = await call('POST', '/api/warehouse/cargar', { demo: 'true' }, admin);
    t('demo debe ser exactamente true (un texto no activa la demostración)', r.s === 200 && r.j.demo === null);
  } catch (e) { fail++; console.log('FAIL error inesperado', e); }
  finally {
    try {
      await db.query('DELETE FROM dw.fact_ventas');
      for (const id of clientes) for (const s of ['DELETE FROM checkouts WHERE cliente_id=$1', 'DELETE FROM movimientos_inventario WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id=$1)', 'DELETE FROM pagos WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id=$1)', 'DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id=$1)', 'DELETE FROM pedidos WHERE cliente_id=$1', 'DELETE FROM usuarios WHERE id=$1']) await db.query(s, [id]);
      await db.query('DELETE FROM movimientos_inventario WHERE id > $1', [movMax]);
      for (const i of insumos0) await db.query('UPDATE insumos SET stock=$2 WHERE id=$1', [i.id, i.stock]);
    } catch (e) { console.log('Aviso: limpieza incompleta:', e.message); }
    console.log(`\n${pass} correctas, ${fail} fallidas`);
    server.close(); await db.pool.end(); process.exit(fail ? 1 : 0);
  }
})();

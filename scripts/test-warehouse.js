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

    const { comboDe } = require('../src/services/combos');
    t('combos: cada combo definido se reconoce por sus dos productos, en cualquier orden', comboDe(['Galleta', 'Té chai']).nombre === 'Combo Otoño' && comboDe(['Brownie', 'Café latte']).nombre === 'Combo Navideño' && comboDe(['Café latte', 'Cupcake']).nombre === 'Combo San Valentín' && comboDe(['Café americano', 'Galleta']).nombre === 'Combo Regreso a clases');
    t('combos: cualquier otra mezcla es "Combo personalizado"', comboDe(['Galleta']).nombre === 'Combo personalizado' && comboDe(['Galleta', 'Té chai', 'Brownie']).nombre === 'Combo personalizado' && comboDe(['Brownie', 'Cupcake']).nombre === 'Combo personalizado' && comboDe([]).nombre === 'Combo personalizado');

    const cat = (await call('GET', '/api/catalogo')).j, prod = (n) => cat.productos.find((p) => p.nombre === n), pres = cat.presentaciones.find((x) => x.nombre === 'Caja mediana');
    const DIR = { cp: '91190', colonia: 'Las Flores', calle: 'Calle DW', num_ext: '1' };
    const pedir = async (items, dias, hora) => {
      const fecha = svc.addDays(svc.todayMX(), dias);
      const ck = await call('POST', '/api/pedidos/checkout', { items, presentacion_id: pres.id, fecha, hora, direccion: DIR }, cli);
      const ap = await call('POST', `/api/pagos/simulado/${ck.j.checkout_id}/aprobar`, undefined, cli);
      return { ck, ap, id: ap.j.pedido_id };
    };
    const base = 20 + Math.floor(Math.random() * 60);
    const p1 = await pedir([{ producto_id: prod('Té chai').id, cantidad: 1 }, { producto_id: prod('Galleta').id, cantidad: 2 }], base, '12:00');
    t('se creó un pedido real (Té chai + Galleta) para el ETL', p1.ck.s === 201 && p1.id > 0, p1.ck.texto.slice(0, 160));
    let r = await call('POST', '/api/warehouse/cargar', { demo: false }, admin);
    t('cargar (solo pedidos del sistema) → 200', r.s === 200 && r.j.ok && r.j.pedidos >= 1 && r.j.demo === 0, r.texto);
    const ped = (await q("SELECT total::float AS total, to_char((creado_en AT TIME ZONE 'America/Mexico_City')::date,'YYYYMMDD')::int AS fkey, (SELECT COALESCE(sum(m.cantidad*i.costo_unitario),0)::float FROM movimientos_inventario m JOIN insumos i ON i.id=m.insumo_id WHERE m.pedido_id=pedidos.id AND m.tipo='salida') AS costo FROM pedidos WHERE id=$1", [p1.id]))[0];
    let f = await q('SELECT f.*, c.nombre AS combo FROM dw.fact_ventas f JOIN dw.dim_combo c USING(combo_key) WHERE f.pedido_id=$1', [p1.id]);
    t('el pedido se clasifica como Combo Otoño con el mismo total, costo y fecha que el sistema', f.length === 1 && f[0].combo === 'Combo Otoño' && f[0].cantidad === 3 && Math.abs(Number(f[0].ingreso) - ped.total) < 0.005 && Math.abs(Number(f[0].costo) - ped.costo) < 0.001 && f[0].fecha_key === ped.fkey, JSON.stringify(f[0]) + JSON.stringify(ped));
    await call('POST', '/api/warehouse/cargar', { demo: false }, admin);
    t('cargar dos veces no duplica los hechos (idempotente)', (await q('SELECT count(*)::int AS n FROM dw.fact_ventas WHERE pedido_id=$1', [p1.id]))[0].n === 1);
    const hu = await q(`SELECT (SELECT count(*) FROM dw.fact_ventas f LEFT JOIN dw.dim_fecha d USING(fecha_key) WHERE d.fecha_key IS NULL)::int AS a,
      (SELECT count(*) FROM dw.fact_ventas f LEFT JOIN dw.dim_combo d USING(combo_key) WHERE d.combo_key IS NULL)::int AS b,
      (SELECT count(*) FROM dw.fact_ventas f LEFT JOIN dw.dim_presentacion d USING(presentacion_key) WHERE d.presentacion_key IS NULL)::int AS c`);
    t('integridad: ningún hecho sin su dimensión', hu[0].a === 0 && hu[0].b === 0 && hu[0].c === 0);
    t('ya no existen las tablas de zona ni de producto en el almacén', (await q("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='dw' AND table_name IN ('dim_zona','dim_producto')"))[0].n === 0);

    const antesPedidos = (await q('SELECT count(*)::int AS n FROM pedidos'))[0].n;
    r = await call('POST', '/api/warehouse/cargar', { demo: true }, admin);
    t('cargar con demostración registra cientos de ventas como pedidos del sistema', r.s === 200 && r.j.demo > 800 && (await q('SELECT count(*)::int AS n FROM pedidos'))[0].n === antesPedidos + r.j.demo, r.texto);
    const demo = r.j.demo;
    const nPed = (await q('SELECT count(*)::int AS n FROM pedidos'))[0].n;
    r = await call('POST', '/api/warehouse/cargar', { demo: true }, admin);
    t('repetir la carga no duplica las ventas de demostración', r.j.demo === 0 && (await q('SELECT count(*)::int AS n FROM pedidos'))[0].n === nPed);
    const meses = (await q('SELECT count(DISTINCT d.anio*100+d.mes)::int AS n FROM dw.fact_ventas f JOIN dw.dim_fecha d USING(fecha_key)'))[0].n;
    t('las ventas cubren 12 o 13 meses', meses >= 12 && meses <= 13, meses);
    t('las ventas de demostración son pedidos entregados de un cliente inactivo (no puede iniciar sesión)', (await q("SELECT count(*)::int AS n FROM pedidos p JOIN usuarios u ON u.id=p.cliente_id WHERE u.correo='ventas.demo@encombo.test' AND p.estatus='Entregado' AND NOT u.activo"))[0].n === demo);

    r = await call('GET', '/api/warehouse/resumen', undefined, admin);
    const rs = r.j;
    t('resumen: KPIs coherentes (margen realista entre 40 % y 70 %)', r.s === 200 && rs.kpis.ingreso > 0 && rs.kpis.utilidad < rs.kpis.ingreso && rs.kpis.margen > 0.4 && rs.kpis.margen < 0.7, JSON.stringify(rs.kpis));
    const hoy = svc.todayMX(), rep = (await call('GET', `/api/reportes/ventas?desde=${svc.addDays(hoy, -365)}&hasta=${hoy}&agrupar=mes`, undefined, admin)).j;
    t('el warehouse coincide con Reportes: mismos pedidos, ventas, costo y utilidad', rep.totales && rs.kpis.pedidos === rep.totales.pedidos && Math.abs(rs.kpis.ingreso - rep.totales.ventas) < 0.01 && Math.abs((rs.kpis.ingreso - rs.kpis.utilidad) - rep.totales.costo) < 0.05 && Math.abs(rs.kpis.utilidad - rep.totales.utilidad) < 0.05, JSON.stringify(rs.kpis) + JSON.stringify(rep.totales));
    const dash = (await call('GET', '/api/reportes/dashboard', undefined, admin)).j;
    t('el Dashboard cuenta esas mismas ventas (pedidos entregados)', dash.por_estatus && dash.por_estatus['Entregado'] >= demo);
    t('la conciliación informa que sistema y almacén coinciden', rs.conciliacion.coincide === true && rs.conciliacion.sistema.pedidos === rs.conciliacion.almacen.pedidos && Math.abs(rs.conciliacion.sistema.ventas - rs.conciliacion.almacen.ventas) < 0.01);
    t('ventas por combo: Otoño, Navideño, San Valentín, Regreso a clases y personalizado', ['Combo Otoño', 'Combo Navideño', 'Combo San Valentín', 'Combo Regreso a clases', 'Combo personalizado'].every((n) => rs.combos.some((c) => c.nombre === n)) && rs.combos.length === 5, rs.combos.map((c) => c.nombre).join());
    t('el combo personalizado vende con cualquier mezcla y los demás con sus productos', rs.combos.find((c) => c.nombre === 'Combo Navideño').productos === 'Café latte + Brownie' && rs.combos.find((c) => c.nombre === 'Combo personalizado').pedidos > 50);
    t('resumen: la suma por mes, combo y día de la semana coincide con el total', [rs.meses, rs.combos, rs.dias].every((g) => Math.abs(g.reduce((a, x) => a + x.ingreso, 0) - rs.kpis.ingreso) < 1), '');
    t('resumen: sin zonas ni productos sueltos; 7 días y varias temporadas', rs.zonas === undefined && rs.productos === undefined && rs.dias.length === 7 && rs.temporadas.length >= 4);
    t('resumen: diciembre rinde más que enero (estacionalidad)', (() => { const d = rs.meses.find((m) => /diciembre/.test(m.etiqueta)), e = rs.meses.find((m) => /^enero/.test(m.etiqueta)); return d && e && d.ingreso > e.ingreso; })());
    const est = await q(`SELECT c.clave, d.mes, SUM(f.ingreso)::float AS i FROM dw.fact_ventas f JOIN dw.dim_combo c USING(combo_key) JOIN dw.dim_fecha d USING(fecha_key) GROUP BY 1,2`);
    const mejorMes = (clave) => est.filter((x) => x.clave === clave).sort((a, b) => b.i - a.i)[0].mes;
    t('estacionalidad por combo: Navideño → diciembre, San Valentín → febrero', mejorMes('navideno') === 12 && mejorMes('san-valentin') === 2, mejorMes('navideno') + ',' + mejorMes('san-valentin'));
    t('el resumen informa la última carga', rs.ultima_carga && /pedidos|sincron/.test(rs.ultima_carga.tipo));

    const p2 = await pedir([{ producto_id: prod('Cupcake').id, cantidad: 1 }, { producto_id: prod('Café latte').id, cantidad: 1 }], base + 1, '13:00');
    r = await call('GET', '/api/warehouse/resumen', undefined, admin);
    t('un pedido nuevo aparece solo en el warehouse (San Valentín) y sigue coincidiendo', p2.id > 0 && r.j.kpis.pedidos === rs.kpis.pedidos + 1 && r.j.conciliacion.coincide && (await q("SELECT c.nombre FROM dw.fact_ventas f JOIN dw.dim_combo c USING(combo_key) WHERE f.pedido_id=$1", [p2.id]))[0].nombre === 'Combo San Valentín');

    r = await call('GET', '/api/warehouse/exportar', undefined, admin);
    const nombres = (r.j.archivos || []).map((a) => a.nombre).sort();
    t('exportar → 4 archivos CSV (3 dimensiones + hechos)', nombres.join() === 'dw_dim_combo.csv,dw_dim_fecha.csv,dw_dim_presentacion.csv,dw_fact_ventas.csv', nombres.join());
    const hechos = r.j.archivos.find((a) => a.nombre === 'dw_fact_ventas.csv').contenido.trim().split('\n');
    t('CSV de hechos: encabezado y una fila por pedido', hechos[0] === 'venta_id,fecha_key,combo_key,presentacion_key,pedido_id,cantidad,ingreso,costo' && hechos.length - 1 === (await q('SELECT count(*)::int AS n FROM dw.fact_ventas'))[0].n);
    t('CSV de combos con sus productos', r.j.archivos.find((a) => a.nombre === 'dw_dim_combo.csv').contenido.includes('Combo Navideño,Café latte + Brownie'));

    r = await call('DELETE', '/api/warehouse/demo', undefined, admin);
    t('quitar demostración borra solo las ventas de demostración y deja los pedidos reales', r.j.ok && r.j.borradas === demo && (await q("SELECT count(*)::int AS n FROM pedidos p JOIN usuarios u ON u.id=p.cliente_id WHERE u.correo='ventas.demo@encombo.test'"))[0].n === 0 && (await q('SELECT count(*)::int AS n FROM pedidos WHERE id = ANY($1)', [[p1.id, p2.id]]))[0].n === 2 && (await q('SELECT count(*)::int AS n FROM dw.fact_ventas'))[0].n === (await q('SELECT count(*)::int AS n FROM pedidos'))[0].n);
    r = await call('POST', '/api/warehouse/cargar', { demo: 'true' }, admin);
    t('demo debe ser exactamente true (un texto no registra ventas)', r.s === 200 && r.j.demo === 0);
  } catch (e) { fail++; console.log('FAIL error inesperado', e); }
  finally {
    try {
      await require('../src/services/warehouse').quitarDemo(); await require('../src/services/ventas-demo').revertirCostos(db);
      await db.query('DELETE FROM dw.fact_ventas');
      for (const id of clientes) for (const s of ['DELETE FROM checkouts WHERE cliente_id=$1', 'DELETE FROM movimientos_inventario WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id=$1)', 'DELETE FROM pagos WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id=$1)', 'DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id=$1)', 'DELETE FROM pedidos WHERE cliente_id=$1', 'DELETE FROM usuarios WHERE id=$1']) await db.query(s, [id]);
      await db.query('DELETE FROM movimientos_inventario WHERE id > $1', [movMax]);
      for (const i of insumos0) await db.query('UPDATE insumos SET stock=$2 WHERE id=$1', [i.id, i.stock]);
    } catch (e) { console.log('Aviso: limpieza incompleta:', e.message); }
    console.log(`\n${pass} correctas, ${fail} fallidas`);
    server.close(); await db.pool.end(); process.exit(fail ? 1 : 0);
  }
})();

const db = require('../db');
const { TODOS, comboDe } = require('./combos');
const demo = require('./ventas-demo');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const pad = (n) => String(n).padStart(2, '0');
const aClave = (d) => d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const sumaDias = (d, n) => new Date(d.getTime() + n * 86400000);

function temporada(m, d) {
  if ((m === 2 && d >= 1 && d <= 14)) return 'San Valentín';
  if (m === 5 && d >= 1 && d <= 10) return 'Día de las Madres';
  if ((m === 11 && d >= 25) || m === 12 || (m === 1 && d <= 6)) return 'Navidad';
  if (m === 10 || (m === 11 && d <= 2)) return 'Otoño y Día de Muertos';
  if (m >= 8 && m <= 9) return 'Regreso a clases';
  return 'Temporada regular';
}
function filaFecha(d) {
  const dow = ((d.getUTCDay() + 6) % 7) + 1, m = d.getUTCMonth() + 1;
  return [aClave(d), iso(d), d.getUTCFullYear(), Math.ceil(m / 3), m, MESES[m - 1], d.getUTCDate(), dow, DIAS[dow - 1], dow >= 6, temporada(m, d.getUTCDate())];
}
async function asegurarFechas(c, desde, hasta) {
  const filas = []; for (let d = desde; d <= hasta; d = sumaDias(d, 1)) filas.push(filaFecha(d));
  for (let i = 0; i < filas.length; i += 300) {
    const lote = filas.slice(i, i + 300), params = [];
    const v = lote.map((f, k) => { params.push(...f); return '(' + f.map((_, j) => '$' + (k * 11 + j + 1)).join(',') + ')'; }).join(',');
    await c.query(`INSERT INTO dw.dim_fecha(fecha_key,fecha,anio,trimestre,mes,nombre_mes,dia,dia_semana,nombre_dia,es_fin_semana,temporada) VALUES ${v} ON CONFLICT (fecha_key) DO NOTHING`, params);
  }
}

const TZ = "'America/Mexico_City'";
const num = (x) => Number(x || 0);
const r2 = (n) => Math.round(Number(n) * 100) / 100;

async function refrescarDimensiones(c) {
  await c.query('INSERT INTO dw.dim_presentacion(presentacion_id,nombre) SELECT id, nombre FROM presentaciones ON CONFLICT (presentacion_id) DO UPDATE SET nombre=EXCLUDED.nombre');
  for (const k of TODOS)
    await c.query('INSERT INTO dw.dim_combo(clave,nombre,productos) VALUES($1,$2,$3) ON CONFLICT (clave) DO UPDATE SET nombre=EXCLUDED.nombre, productos=EXCLUDED.productos',
      [k.clave, k.nombre, k.productos.length ? k.productos.join(' + ') : 'A elección del cliente']);
}

async function cargarPedidos(c) {
  await refrescarDimensiones(c);
  await c.query('DELETE FROM dw.fact_ventas');
  const { rows } = await c.query(`
    SELECT p.id, to_char((p.creado_en AT TIME ZONE ${TZ})::date,'YYYYMMDD')::int AS fkey, to_char((p.creado_en AT TIME ZONE ${TZ})::date,'YYYY-MM-DD') AS f,
           p.presentacion_id, p.total,
           (SELECT COALESCE(sum(cantidad),0) FROM pedido_items WHERE pedido_id=p.id)::int AS piezas,
           (SELECT array_agg(DISTINCT pr.nombre) FROM pedido_items pi JOIN productos pr ON pr.id=pi.producto_id WHERE pi.pedido_id=p.id) AS productos,
           COALESCE((SELECT sum(m.cantidad*i.costo_unitario) FROM movimientos_inventario m JOIN insumos i ON i.id=m.insumo_id WHERE m.pedido_id=p.id AND m.tipo='salida'),0) AS costo
      FROM pedidos p ORDER BY p.id`);
  if (!rows.length) return 0;
  const fechas = rows.map((x) => x.f).sort();
  const aDate = (t) => { const [y, m, d] = t.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  await asegurarFechas(c, aDate(fechas[0]), aDate(fechas[fechas.length - 1]));
  const combos = Object.fromEntries((await c.query('SELECT combo_key, clave FROM dw.dim_combo')).rows.map((x) => [x.clave, x.combo_key]));
  const pres = Object.fromEntries((await c.query('SELECT presentacion_key, presentacion_id FROM dw.dim_presentacion')).rows.map((x) => [x.presentacion_id, x.presentacion_key]));
  const filas = rows.filter((x) => x.piezas > 0).map((x) => [x.fkey, combos[comboDe(x.productos || []).clave], pres[x.presentacion_id], x.id, x.piezas, x.total, x.costo]);
  for (let i = 0; i < filas.length; i += 500) {
    const lote = filas.slice(i, i + 500), params = [];
    const v = lote.map((f, k) => { params.push(...f); return '(' + f.map((_, j) => '$' + (k * 7 + j + 1)).join(',') + ')'; }).join(',');
    await c.query(`INSERT INTO dw.fact_ventas(fecha_key,combo_key,presentacion_key,pedido_id,cantidad,ingreso,costo) VALUES ${v}`, params);
  }
  return filas.length;
}

async function cargar({ demo: conDemo = false, usuarioId = null } = {}) {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    const creadas = conDemo ? await demo.asegurar(c) : 0;
    const pedidos = await cargarPedidos(c);
    await c.query('INSERT INTO dw.carga_log(usuario_id,tipo,filas,detalle) VALUES($1,$2,$3,$4)', [usuarioId, 'pedidos', pedidos, `pedidos cargados: ${pedidos}` + (creadas ? `; ventas de demostración registradas: ${creadas}` : '')]);
    await c.query('COMMIT');
    return { pedidos, demo: creadas };
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}

async function quitarDemo() {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    const borradas = await demo.quitar(c);
    await cargarPedidos(c);
    await c.query('COMMIT');
    return borradas;
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}

async function conciliacion() {
  const [s] = (await db.query(`SELECT count(*)::int AS pedidos, COALESCE(sum(p.total),0) AS ventas,
      COALESCE((SELECT sum(m.cantidad*i.costo_unitario) FROM movimientos_inventario m JOIN insumos i ON i.id=m.insumo_id WHERE m.tipo='salida' AND m.pedido_id IS NOT NULL),0) AS costo FROM pedidos p`)).rows;
  const [w] = (await db.query('SELECT count(*)::int AS pedidos, COALESCE(sum(ingreso),0) AS ventas, COALESCE(sum(costo),0) AS costo FROM dw.fact_ventas')).rows;
  const sistema = { pedidos: s.pedidos, ventas: r2(s.ventas), costo: r2(s.costo) }, almacen = { pedidos: w.pedidos, ventas: r2(w.ventas), costo: r2(w.costo) };
  return { sistema, almacen, coincide: sistema.pedidos === almacen.pedidos && Math.abs(sistema.ventas - almacen.ventas) < 0.01 && Math.abs(sistema.costo - almacen.costo) < 0.05 };
}

async function resumen() {
  let conc = await conciliacion();
  if (!conc.coincide && conc.sistema.pedidos > 0) {
    const c = await db.pool.connect();
    try { await c.query('BEGIN'); const n = await cargarPedidos(c); await c.query('INSERT INTO dw.carga_log(tipo,filas,detalle) VALUES($1,$2,$3)', ['sincronizacion', n, 'Se actualizó para coincidir con los pedidos del sistema']); await c.query('COMMIT'); }
    catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    conc = await conciliacion();
  }
  const q = async (sql) => (await db.query(sql)).rows;
  const [k] = await q('SELECT COALESCE(SUM(ingreso),0) AS ingreso, COALESCE(SUM(costo),0) AS costo, COALESCE(SUM(cantidad),0) AS piezas, COUNT(*) AS pedidos FROM dw.fact_ventas');
  const meses = await q(`SELECT d.anio, d.mes, d.nombre_mes, SUM(f.ingreso) AS ingreso, SUM(f.ingreso-f.costo) AS utilidad, SUM(f.cantidad) AS piezas FROM dw.fact_ventas f JOIN dw.dim_fecha d USING (fecha_key) GROUP BY d.anio,d.mes,d.nombre_mes ORDER BY d.anio,d.mes`);
  const combos = await q(`SELECT c.nombre, c.productos, COUNT(*) AS pedidos, SUM(f.cantidad) AS piezas, SUM(f.ingreso) AS ingreso, SUM(f.ingreso-f.costo) AS utilidad FROM dw.fact_ventas f JOIN dw.dim_combo c USING (combo_key) GROUP BY c.nombre,c.productos ORDER BY ingreso DESC`);
  const dias = await q(`SELECT d.dia_semana, d.nombre_dia, SUM(f.ingreso) AS ingreso, SUM(f.cantidad) AS piezas FROM dw.fact_ventas f JOIN dw.dim_fecha d USING (fecha_key) GROUP BY d.dia_semana,d.nombre_dia ORDER BY d.dia_semana`);
  const temporadas = await q(`SELECT d.temporada, SUM(f.ingreso) AS ingreso, SUM(f.cantidad) AS piezas, COUNT(DISTINCT d.fecha_key) AS dias FROM dw.fact_ventas f JOIN dw.dim_fecha d USING (fecha_key) GROUP BY d.temporada ORDER BY ingreso DESC`);
  const [ult] = await q('SELECT l.creado_en, l.tipo, l.filas, l.detalle FROM dw.carga_log l ORDER BY l.id DESC LIMIT 1');
  const ingreso = num(k.ingreso), costo = num(k.costo);
  return { filas: { pedidos: num(k.pedidos) }, ultima_carga: ult || null, conciliacion: conc,
    kpis: { ingreso, utilidad: ingreso - costo, margen: ingreso ? (ingreso - costo) / ingreso : 0, piezas: num(k.piezas), pedidos: num(k.pedidos) },
    meses: meses.map((x) => ({ etiqueta: `${x.nombre_mes} ${x.anio}`, anio: x.anio, mes: x.mes, ingreso: num(x.ingreso), utilidad: num(x.utilidad), piezas: num(x.piezas) })),
    combos: combos.map((x) => ({ nombre: x.nombre, productos: x.productos, pedidos: num(x.pedidos), piezas: num(x.piezas), ingreso: num(x.ingreso), utilidad: num(x.utilidad) })),
    dias: dias.map((x) => ({ dia: x.nombre_dia, ingreso: num(x.ingreso), piezas: num(x.piezas) })),
    temporadas: temporadas.map((x) => ({ temporada: x.temporada, ingreso: num(x.ingreso), piezas: num(x.piezas), dias: num(x.dias), ingreso_por_dia: num(x.dias) ? num(x.ingreso) / num(x.dias) : 0 })) };
}

const celda = (x) => { const s = x == null ? '' : x instanceof Date ? x.toISOString().slice(0, 10) : String(x); const t = /^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s)) ? "'" + s : s; return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
const csv = (cols, rows) => [cols.join(','), ...rows.map((r) => cols.map((c) => celda(r[c])).join(','))].join('\n') + '\n';
async function exportar() {
  const q = async (sql) => (await db.query(sql)).rows;
  const f = await q("SELECT fecha_key, to_char(fecha,'YYYY-MM-DD') AS fecha, anio, trimestre, mes, nombre_mes, dia, dia_semana, nombre_dia, es_fin_semana, temporada FROM dw.dim_fecha WHERE fecha_key IN (SELECT DISTINCT fecha_key FROM dw.fact_ventas) ORDER BY fecha_key");
  const pr = await q('SELECT presentacion_key, presentacion_id, nombre FROM dw.dim_presentacion ORDER BY presentacion_key');
  const cb = await q('SELECT combo_key, clave, nombre, productos FROM dw.dim_combo ORDER BY combo_key');
  const h = await q('SELECT id AS venta_id, fecha_key, combo_key, presentacion_key, pedido_id, cantidad, ingreso, round(costo,2) AS costo FROM dw.fact_ventas ORDER BY id');
  return { archivos: [
    { nombre: 'dw_dim_fecha.csv', contenido: csv(['fecha_key', 'fecha', 'anio', 'trimestre', 'mes', 'nombre_mes', 'dia', 'dia_semana', 'nombre_dia', 'es_fin_semana', 'temporada'], f) },
    { nombre: 'dw_dim_combo.csv', contenido: csv(['combo_key', 'clave', 'nombre', 'productos'], cb) },
    { nombre: 'dw_dim_presentacion.csv', contenido: csv(['presentacion_key', 'presentacion_id', 'nombre'], pr) },
    { nombre: 'dw_fact_ventas.csv', contenido: csv(['venta_id', 'fecha_key', 'combo_key', 'presentacion_key', 'pedido_id', 'cantidad', 'ingreso', 'costo'], h) }] };
}

module.exports = { cargar, quitarDemo, resumen, exportar, temporada, conciliacion };

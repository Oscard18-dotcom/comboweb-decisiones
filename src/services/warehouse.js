const db = require('../db');
const CP = require('../data/cp-veracruz.json');

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
const COSTO_INDIRECTO = 0.30;
async function refrescarDimensiones(c) {
  await c.query(`INSERT INTO dw.dim_producto(producto_id,nombre,precio_lista,costo_estimado)
    SELECT p.id, p.nombre, p.precio, ROUND((COALESCE((SELECT SUM(ri.cantidad / r.rinde * i.costo_unitario) FROM recetas r JOIN receta_ingredientes ri ON ri.receta_id=r.id JOIN insumos i ON i.id=ri.insumo_id WHERE r.producto_id=p.id),0) + p.precio * $1)::numeric, 4)
      FROM productos p
    ON CONFLICT (producto_id) DO UPDATE SET nombre=EXCLUDED.nombre, precio_lista=EXCLUDED.precio_lista, costo_estimado=EXCLUDED.costo_estimado`, [COSTO_INDIRECTO]);
  await c.query(`INSERT INTO dw.dim_presentacion(presentacion_id,nombre) SELECT id, nombre FROM presentaciones ON CONFLICT (presentacion_id) DO UPDATE SET nombre=EXCLUDED.nombre`);
}

async function cargarPedidos(c) {
  await refrescarDimensiones(c);
  await c.query("DELETE FROM dw.fact_ventas WHERE origen='pedido'");
  const { rows: r } = await c.query('SELECT min(fecha_entrega) AS a, max(fecha_entrega) AS b FROM pedidos');
  if (!r[0].a) return 0;
  const a = new Date(r[0].a.toISOString ? r[0].a.toISOString().slice(0, 10) : r[0].a), b = new Date(r[0].b.toISOString ? r[0].b.toISOString().slice(0, 10) : r[0].b);
  await asegurarFechas(c, new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())), new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())));
  await c.query(`INSERT INTO dw.dim_zona(cp,colonia,municipio)
    SELECT DISTINCT COALESCE(dir_cp,'00000'), COALESCE(NULLIF(dir_colonia,''),'Sin dato'), COALESCE(NULLIF(dir_municipio,''),'Sin dato') FROM pedidos
    ON CONFLICT DO NOTHING`);
  const { rowCount } = await c.query(`INSERT INTO dw.fact_ventas(fecha_key,producto_key,presentacion_key,zona_key,pedido_id,origen,cantidad,ingreso,costo)
    SELECT to_char(pe.fecha_entrega,'YYYYMMDD')::int, dp.producto_key, dpr.presentacion_key, dz.zona_key, pe.id, 'pedido', pi.cantidad, pi.cantidad*pi.precio_unitario, pi.cantidad*dp.costo_estimado
      FROM pedidos pe JOIN pedido_items pi ON pi.pedido_id=pe.id
      JOIN dw.dim_producto dp ON dp.producto_id=pi.producto_id
      JOIN dw.dim_presentacion dpr ON dpr.presentacion_id=pe.presentacion_id
      JOIN dw.dim_zona dz ON dz.cp=COALESCE(pe.dir_cp,'00000') AND dz.colonia=COALESCE(NULLIF(pe.dir_colonia,''),'Sin dato') AND dz.municipio=COALESCE(NULLIF(pe.dir_municipio,''),'Sin dato')`);
  return rowCount;
}

function rng(semilla) { let a = semilla >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function poisson(l, r) { const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= r(); } while (p > L); return k - 1; }
const ZONAS_DEMO = [['Xalapa', 'Xalapa Enríquez Centro', 0.30], ['Xalapa', null, 0.26], ['Coatepec', null, 0.16], ['Banderilla', null, 0.10], ['Emiliano Zapata', null, 0.10], ['Xico', null, 0.08]];
function zonasDemo() {
  const out = [];
  for (const [mun, col, peso] of ZONAS_DEMO) {
    const cp = Object.keys(CP).sort().find((k) => CP[k].m === mun && (col ? CP[k].a.includes(col) : true) && CP[k].a.length);
    if (cp) out.push({ cp, colonia: col && CP[cp].a.includes(col) ? col : CP[cp].a[0], municipio: CP[cp].m, peso });
  }
  return out;
}
const factorMes = (m, d) => (m === 12 ? (d >= 12 && d <= 24 ? 2.6 : 1.7) : m === 2 ? (d <= 14 ? 2.3 : 1.0) : m === 5 ? (d <= 10 ? 2.0 : 1.1) : m === 1 ? 0.8 : m === 10 || (m === 11 && d <= 2) ? 1.4 : m === 8 || m === 9 ? 1.2 : m === 6 || m === 7 ? 0.9 : 1.0);
const factorDia = [0.7, 0.8, 0.9, 1.0, 1.4, 1.5, 1.2];

async function cargarDemo(c, hoy = new Date()) {
  await refrescarDimensiones(c);
  await c.query("DELETE FROM dw.fact_ventas WHERE origen='demo'");
  const fin = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() - 1)), ini = sumaDias(fin, -364);
  await asegurarFechas(c, ini, fin);
  const zs = zonasDemo(); if (!zs.length) throw new Error('No se encontraron códigos postales para la demostración.');
  for (const z of zs) await c.query('INSERT INTO dw.dim_zona(cp,colonia,municipio) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [z.cp, z.colonia, z.municipio]);
  const keysZ = (await c.query('SELECT zona_key,cp,colonia,municipio FROM dw.dim_zona')).rows;
  const zonaKey = zs.map((z) => ({ key: keysZ.find((k) => k.cp === z.cp && k.colonia === z.colonia && k.municipio === z.municipio).zona_key, peso: z.peso }));
  const prods = (await c.query('SELECT producto_key,nombre,precio_lista,costo_estimado FROM dw.dim_producto ORDER BY producto_key')).rows;
  const pres = (await c.query('SELECT presentacion_key FROM dw.dim_presentacion ORDER BY presentacion_key')).rows;
  if (!prods.length || !pres.length) throw new Error('Primero carga los datos iniciales del sistema (npm run db:seed).');
  const r = rng(20261103);
  const pesoProd = prods.map((_, i) => 0.6 + ((i * 37) % 10) / 10);
  const elegir = (pesos) => { let x = r() * pesos.reduce((a, b) => a + b, 0); for (let i = 0; i < pesos.length; i++) { x -= pesos[i]; if (x <= 0) return i; } return pesos.length - 1; };
  const filas = [];
  for (let d = ini; d <= fin; d = sumaDias(d, 1)) {
    const dow = (d.getUTCDay() + 6) % 7, lambda = 2.4 * factorMes(d.getUTCMonth() + 1, d.getUTCDate()) * factorDia[dow];
    const pedidos = poisson(lambda, r);
    for (let p = 0; p < pedidos; p++) {
      const zk = zonaKey[elegir(zonaKey.map((z) => z.peso))].key, pk = pres[Math.floor(r() * pres.length)].presentacion_key;
      const n = 1 + Math.floor(r() * Math.min(3, prods.length)), usados = new Set();
      for (let i = 0; i < n; i++) {
        const pi = elegir(pesoProd); if (usados.has(pi)) continue; usados.add(pi);
        const cant = 1 + Math.floor(r() * 3), pr = prods[pi];
        filas.push([aClave(d), pr.producto_key, pk, zk, cant, Math.round(cant * Number(pr.precio_lista) * 100) / 100, Math.round(cant * Number(pr.costo_estimado) * 100) / 100]);
      }
    }
  }
  for (let i = 0; i < filas.length; i += 500) {
    const lote = filas.slice(i, i + 500), params = [];
    const v = lote.map((f, k) => { params.push(...f); return `($${k * 7 + 1},$${k * 7 + 2},$${k * 7 + 3},$${k * 7 + 4},'demo',$${k * 7 + 5},$${k * 7 + 6},$${k * 7 + 7})`; }).join(',');
    await c.query(`INSERT INTO dw.fact_ventas(fecha_key,producto_key,presentacion_key,zona_key,origen,cantidad,ingreso,costo) VALUES ${v}`, params);
  }
  return filas.length;
}

async function cargar({ demo = false, usuarioId = null } = {}) {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    const pedidos = await cargarPedidos(c);
    let demoFilas = null;
    if (demo) demoFilas = await cargarDemo(c);
    await c.query('INSERT INTO dw.carga_log(usuario_id,tipo,filas,detalle) VALUES($1,$2,$3,$4)', [usuarioId, demo ? 'pedidos+demo' : 'pedidos', pedidos + (demoFilas || 0), `pedidos reales: ${pedidos}` + (demo ? `, demostración: ${demoFilas}` : '')]);
    await c.query('COMMIT');
    return { pedidos, demo: demoFilas };
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
async function quitarDemo() { const r = await db.query("DELETE FROM dw.fact_ventas WHERE origen='demo'"); return r.rowCount; }

const ORIGENES = { todos: '', pedido: "WHERE f.origen='pedido'", demo: "WHERE f.origen='demo'" };
async function resumen(origen = 'todos') {
  const w = ORIGENES[origen] ?? ORIGENES.todos, q = async (sql) => (await db.query(sql)).rows;
  const num = (x) => Number(x || 0);
  const [k] = await q(`SELECT COALESCE(SUM(ingreso),0) AS ingreso, COALESCE(SUM(costo),0) AS costo, COALESCE(SUM(cantidad),0) AS piezas, COUNT(DISTINCT COALESCE(pedido_id::text, f.id::text)) AS lineas FROM dw.fact_ventas f ${w}`);
  const [conteo] = await q(`SELECT COUNT(*) FILTER (WHERE origen='pedido') AS pedido, COUNT(*) FILTER (WHERE origen='demo') AS demo FROM dw.fact_ventas`);
  const meses = await q(`SELECT d.anio, d.mes, d.nombre_mes, SUM(f.ingreso) AS ingreso, SUM(f.ingreso-f.costo) AS utilidad, SUM(f.cantidad) AS piezas FROM dw.fact_ventas f JOIN dw.dim_fecha d USING (fecha_key) ${w} GROUP BY d.anio,d.mes,d.nombre_mes ORDER BY d.anio,d.mes`);
  const productos = await q(`SELECT p.nombre, SUM(f.cantidad) AS piezas, SUM(f.ingreso) AS ingreso, SUM(f.ingreso-f.costo) AS utilidad FROM dw.fact_ventas f JOIN dw.dim_producto p USING (producto_key) ${w} GROUP BY p.nombre ORDER BY ingreso DESC LIMIT 10`);
  const zonas = await q(`SELECT z.municipio, SUM(f.ingreso) AS ingreso, SUM(f.cantidad) AS piezas FROM dw.fact_ventas f JOIN dw.dim_zona z USING (zona_key) ${w} GROUP BY z.municipio ORDER BY ingreso DESC LIMIT 10`);
  const dias = await q(`SELECT d.dia_semana, d.nombre_dia, SUM(f.ingreso) AS ingreso, SUM(f.cantidad) AS piezas FROM dw.fact_ventas f JOIN dw.dim_fecha d USING (fecha_key) ${w} GROUP BY d.dia_semana,d.nombre_dia ORDER BY d.dia_semana`);
  const temporadas = await q(`SELECT d.temporada, SUM(f.ingreso) AS ingreso, SUM(f.cantidad) AS piezas, COUNT(DISTINCT d.fecha_key) AS dias FROM dw.fact_ventas f JOIN dw.dim_fecha d USING (fecha_key) ${w} GROUP BY d.temporada ORDER BY ingreso DESC`);
  const [ult] = await q(`SELECT l.creado_en, l.tipo, l.filas, l.detalle FROM dw.carga_log l ORDER BY l.id DESC LIMIT 1`);
  const ingreso = num(k.ingreso), costo = num(k.costo);
  return { origen, filas: { pedido: num(conteo.pedido), demo: num(conteo.demo) }, ultima_carga: ult || null,
    kpis: { ingreso, utilidad: ingreso - costo, margen: ingreso ? (ingreso - costo) / ingreso : 0, piezas: num(k.piezas) },
    meses: meses.map((x) => ({ etiqueta: `${x.nombre_mes} ${x.anio}`, anio: x.anio, mes: x.mes, ingreso: num(x.ingreso), utilidad: num(x.utilidad), piezas: num(x.piezas) })),
    productos: productos.map((x) => ({ nombre: x.nombre, piezas: num(x.piezas), ingreso: num(x.ingreso), utilidad: num(x.utilidad) })),
    zonas: zonas.map((x) => ({ municipio: x.municipio, ingreso: num(x.ingreso), piezas: num(x.piezas) })),
    dias: dias.map((x) => ({ dia: x.nombre_dia, ingreso: num(x.ingreso), piezas: num(x.piezas) })),
    temporadas: temporadas.map((x) => ({ temporada: x.temporada, ingreso: num(x.ingreso), piezas: num(x.piezas), dias: num(x.dias), ingreso_por_dia: num(x.dias) ? num(x.ingreso) / num(x.dias) : 0 })) };
}

const celda = (x) => { const s = x == null ? '' : x instanceof Date ? x.toISOString().slice(0, 10) : String(x); const t = /^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s)) ? "'" + s : s; return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
const csv = (cols, rows) => [cols.join(','), ...rows.map((r) => cols.map((c) => celda(r[c])).join(','))].join('\n') + '\n';
async function exportar() {
  const q = async (sql) => (await db.query(sql)).rows;
  const f = await q("SELECT fecha_key, to_char(fecha,'YYYY-MM-DD') AS fecha, anio, trimestre, mes, nombre_mes, dia, dia_semana, nombre_dia, es_fin_semana, temporada FROM dw.dim_fecha WHERE fecha_key IN (SELECT DISTINCT fecha_key FROM dw.fact_ventas) ORDER BY fecha_key");
  const p = await q('SELECT producto_key, producto_id, nombre, precio_lista, costo_estimado FROM dw.dim_producto ORDER BY producto_key');
  const pr = await q('SELECT presentacion_key, presentacion_id, nombre FROM dw.dim_presentacion ORDER BY presentacion_key');
  const z = await q('SELECT zona_key, cp, colonia, municipio FROM dw.dim_zona ORDER BY zona_key');
  const h = await q('SELECT id AS venta_id, fecha_key, producto_key, presentacion_key, zona_key, pedido_id, origen, cantidad, ingreso, costo FROM dw.fact_ventas ORDER BY id');
  return { archivos: [
    { nombre: 'dw_dim_fecha.csv', contenido: csv(['fecha_key', 'fecha', 'anio', 'trimestre', 'mes', 'nombre_mes', 'dia', 'dia_semana', 'nombre_dia', 'es_fin_semana', 'temporada'], f) },
    { nombre: 'dw_dim_producto.csv', contenido: csv(['producto_key', 'producto_id', 'nombre', 'precio_lista', 'costo_estimado'], p) },
    { nombre: 'dw_dim_presentacion.csv', contenido: csv(['presentacion_key', 'presentacion_id', 'nombre'], pr) },
    { nombre: 'dw_dim_zona.csv', contenido: csv(['zona_key', 'cp', 'colonia', 'municipio'], z) },
    { nombre: 'dw_fact_ventas.csv', contenido: csv(['venta_id', 'fecha_key', 'producto_key', 'presentacion_key', 'zona_key', 'pedido_id', 'origen', 'cantidad', 'ingreso', 'costo'], h) }] };
}

module.exports = { cargar, quitarDemo, resumen, exportar, temporada };

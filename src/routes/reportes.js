const router = require('express').Router();
const db = require('../db');
const { auth, roles } = require('../middleware/auth');
const { wrap } = require('../util');
const svc = require('../services/pedidos');
const { TODOS, comboDe } = require('../services/combos');

router.use(auth, roles('admin'));

const TZ = "'America/Mexico_City'";
const FECHA = `(p.creado_en AT TIME ZONE ${TZ})::date`;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const ESTATUS = ['Pendiente', 'En preparación', 'Listo para entrega', 'Entregado'];
const UNIDAD = { dia: 'day', semana: 'week', mes: 'month' };

function rango(req, res) {
  const hasta = req.query.hasta || svc.todayMX();
  const desde = req.query.desde || svc.addDays(hasta, -29);
  if (!svc.fechaValida(desde) || !svc.fechaValida(hasta)) { res.status(400).json({ error: 'Las fechas deben tener el formato AAAA-MM-DD.' }); return null; }
  if (desde > hasta) { res.status(400).json({ error: 'La fecha inicial debe ser anterior o igual a la final.' }); return null; }
  if ((Date.parse(hasta) - Date.parse(desde)) / 864e5 > 366) { res.status(400).json({ error: 'El rango máximo es de un año.' }); return null; }
  return { desde, hasta };
}
const celda = (v) => {
  let s = v == null ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
function csv(res, nombre, cabecera, filas) {
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nombre}.csv"` });
  res.send('\uFEFF' + [cabecera, ...filas].map((f) => f.map(celda).join(',')).join('\r\n') + '\r\n');
}

router.get('/dashboard', wrap(async (req, res) => {
  const hoy = svc.todayMX();
  const [ventas, est, entregas, reorden, prox, serie, notif, rev, ppx, dec] = await Promise.all([
    db.query(`SELECT count(*)::int AS n, coalesce(sum(total),0) AS total FROM pedidos p WHERE ${FECHA} = $1`, [hoy]),
    db.query('SELECT estatus, count(*)::int AS n FROM pedidos GROUP BY estatus'),
    db.query("SELECT count(*)::int AS n FROM pedidos WHERE fecha_entrega=$1 AND estatus<>'Entregado'", [hoy]),
    db.query('SELECT id,nombre,unidad,stock,stock_minimo FROM insumos WHERE activo AND stock <= stock_minimo ORDER BY nombre'),
    db.query(`SELECT p.id,p.estatus,p.fecha_entrega::text AS fecha,left(p.hora_entrega::text,5) AS hora,u.nombre AS cliente FROM pedidos p JOIN usuarios u ON u.id=p.cliente_id
               WHERE p.estatus<>'Entregado' ORDER BY p.fecha_entrega,p.hora_entrega,p.id LIMIT 5`),
    db.query(`SELECT d::date::text AS fecha, coalesce(s.pedidos,0)::int AS pedidos, coalesce(s.ventas,0) AS ventas
                FROM generate_series($1::date - 6, $1::date, '1 day') d
                LEFT JOIN (SELECT ${FECHA} AS f, count(*) AS pedidos, sum(total) AS ventas FROM pedidos p GROUP BY 1) s ON s.f = d::date ORDER BY d`, [hoy]),
    db.query("SELECT estado, count(*)::int AS n FROM notificaciones WHERE estado IN ('fallida','error','pendiente') GROUP BY estado"),
    db.query(`SELECT c.id,c.total,c.proveedor,c.referencia,c.creado_en,u.nombre AS cliente FROM checkouts c JOIN usuarios u ON u.id=c.cliente_id WHERE c.estado='revision' ORDER BY c.creado_en DESC LIMIT 5`),
    db.query("SELECT count(*)::int AS n FROM pedidos_proveedor WHERE estado='enviado' AND NOT stock_aplicado"),
    db.query(`SELECT d.id,d.titulo,d.alternativa,d.base,d.creado_en,u.nombre AS usuario,count(*) OVER ()::int AS total
                FROM decisiones d LEFT JOIN usuarios u ON u.id=d.usuario_id ORDER BY d.id DESC LIMIT 1`),
  ]);
  const porEstatus = Object.fromEntries(ESTATUS.map((e) => [e, (est.rows.find((x) => x.estatus === e) || { n: 0 }).n]));
  const nt = Object.fromEntries(notif.rows.map((x) => [x.estado, x.n]));
  res.json({ hoy,
    ventas_hoy: r2(ventas.rows[0].total), pedidos_hoy: ventas.rows[0].n, entregas_pendientes_hoy: entregas.rows[0].n, por_estatus: porEstatus,
    insumos_en_reorden: reorden.rows.length, alertas_reorden: reorden.rows.slice(0, 8).map((x) => ({ ...x, stock: Number(x.stock), stock_minimo: Number(x.stock_minimo) })),
    proximas_entregas: prox.rows.map((x) => ({ ...x, folio: svc.folio(x.id) })),
    ventas_7_dias: serie.rows.map((x) => ({ fecha: x.fecha, pedidos: x.pedidos, ventas: r2(x.ventas) })),
    notificaciones: { fallidas: nt.fallida || 0, con_error: nt.error || 0, pendientes: nt.pendiente || 0 },
    pedidos_proveedor_por_recibir: ppx.rows[0].n,
    decisiones: { total: dec.rows[0] ? dec.rows[0].total : 0, ultima: dec.rows[0] ? { id: dec.rows[0].id, titulo: dec.rows[0].titulo, alternativa: dec.rows[0].alternativa, base: dec.rows[0].base, creado_en: dec.rows[0].creado_en, usuario: dec.rows[0].usuario } : null },
    pagos_en_revision: rev.rows.length, pagos_revision: rev.rows.map((x) => ({ ...x, total: Number(x.total) })) });
}));

const PERIODOS = ['hoy', 'semana', 'mes', 'trimestre', 'semestre', 'anio', 'total'];
function inicioPeriodo(periodo, hoy) {
  const [y, m] = hoy.split('-').map(Number), pad = (n) => String(n).padStart(2, '0');
  if (periodo === 'hoy') return hoy;
  if (periodo === 'semana') { const dow = (new Date(hoy + 'T12:00:00Z').getUTCDay() + 6) % 7; return svc.addDays(hoy, -dow); }
  if (periodo === 'mes') return `${y}-${pad(m)}-01`;
  if (periodo === 'trimestre') return `${y}-${pad(Math.floor((m - 1) / 3) * 3 + 1)}-01`;
  if (periodo === 'semestre') return `${y}-${m <= 6 ? '01' : '07'}-01`;
  if (periodo === 'anio') return `${y}-01-01`;
  return null;
}

router.get('/ventas-periodo', wrap(async (req, res) => {
  const periodo = req.query.periodo || 'hoy';
  if (!PERIODOS.includes(periodo)) return res.status(400).json({ error: 'Elige hoy, semana, mes, trimestre, semestre, anio o total.' });
  const hasta = svc.todayMX();
  let desde = inicioPeriodo(periodo, hasta);
  if (!desde) {
    const m = (await db.query(`SELECT min(${FECHA})::text AS d FROM pedidos p`)).rows[0].d;
    desde = m || hasta;
  }
  const dias = (Date.parse(hasta) - Date.parse(desde)) / 864e5;
  const unidad = periodo === 'hoy' ? 'hour' : dias <= 31 ? 'day' : dias <= 100 ? 'week' : dias <= 1100 ? 'month' : 'year';
  const { rows } = await db.query(
    `WITH base AS (SELECT p.id, p.total, (p.creado_en AT TIME ZONE ${TZ}) AS ts FROM pedidos p WHERE ${FECHA} BETWEEN $1 AND $2),
          costos AS (SELECT m.pedido_id, sum(m.cantidad * i.costo_unitario) AS costo FROM movimientos_inventario m JOIN insumos i ON i.id = m.insumo_id
                      WHERE m.tipo = 'salida' AND m.pedido_id IN (SELECT id FROM base) GROUP BY m.pedido_id)
     SELECT to_char(date_trunc($3, b.ts), 'YYYY-MM-DD HH24:MI') AS periodo, count(*)::int AS pedidos, sum(b.total) AS ventas, coalesce(sum(c.costo), 0) AS costo
       FROM base b LEFT JOIN costos c ON c.pedido_id = b.id GROUP BY 1 ORDER BY 1`, [desde, hasta, unidad]);
  const tot = rows.reduce((a, x) => ({ pedidos: a.pedidos + x.pedidos, ventas: a.ventas + Number(x.ventas), costo: a.costo + Number(x.costo) }), { pedidos: 0, ventas: 0, costo: 0 });
  const pc = (await db.query(
    `SELECT p.total, (SELECT COALESCE(sum(cantidad),0) FROM pedido_items WHERE pedido_id=p.id)::int AS piezas,
            (SELECT array_agg(DISTINCT pr.nombre) FROM pedido_items pi JOIN productos pr ON pr.id=pi.producto_id WHERE pi.pedido_id=p.id) AS productos
       FROM pedidos p WHERE ${FECHA} BETWEEN $1 AND $2`, [desde, hasta])).rows;
  const acum = new Map(TODOS.map((c) => [c.clave, { nombre: c.nombre, pedidos: 0, ventas: 0 }]));
  for (const x of pc) { const a = acum.get(comboDe(x.productos || []).clave); a.pedidos += 1; a.ventas += Number(x.total); }
  res.json({ periodo, desde, hasta, unidad, pedidos: tot.pedidos, ventas: r2(tot.ventas), costo: r2(tot.costo), utilidad: r2(tot.ventas - tot.costo),
    margen_pct: tot.ventas > 0 ? Math.round((tot.ventas - tot.costo) / tot.ventas * 1000) / 10 : 0, ticket_promedio: tot.pedidos ? r2(tot.ventas / tot.pedidos) : 0,
    serie: rows.map((x) => ({ periodo: x.periodo, pedidos: x.pedidos, ventas: r2(x.ventas) })),
    combos: [...acum.values()].filter((x) => x.pedidos).map((x) => ({ nombre: x.nombre, pedidos: x.pedidos, ventas: r2(x.ventas) })) });
}));

router.get('/ventas', wrap(async (req, res) => {
  const rg = rango(req, res); if (!rg) return;
  const agrupar = req.query.agrupar || 'dia';
  if (!UNIDAD[agrupar]) return res.status(400).json({ error: 'Agrupa por dia, semana o mes.' });
  const { rows } = await db.query(
    `WITH base AS (SELECT p.id, p.total, ${FECHA} AS f FROM pedidos p WHERE ${FECHA} BETWEEN $1 AND $2),
          costos AS (SELECT m.pedido_id, sum(m.cantidad * i.costo_unitario) AS costo FROM movimientos_inventario m JOIN insumos i ON i.id = m.insumo_id
                      WHERE m.tipo = 'salida' AND m.pedido_id IN (SELECT id FROM base) GROUP BY m.pedido_id)
     SELECT date_trunc($3, b.f::timestamp)::date::text AS periodo, count(*)::int AS pedidos, sum(b.total) AS ventas, coalesce(sum(c.costo), 0) AS costo
       FROM base b LEFT JOIN costos c ON c.pedido_id = b.id GROUP BY 1 ORDER BY 1`, [rg.desde, rg.hasta, UNIDAD[agrupar]]);
  const periodos = rows.map((x) => ({ periodo: x.periodo, pedidos: x.pedidos, ventas: r2(x.ventas), costo: r2(x.costo), utilidad: r2(Number(x.ventas) - Number(x.costo)) }));
  const tot = rows.reduce((a, x) => ({ pedidos: a.pedidos + x.pedidos, ventas: a.ventas + Number(x.ventas), costo: a.costo + Number(x.costo) }), { pedidos: 0, ventas: 0, costo: 0 });
  const totales = { pedidos: tot.pedidos, ventas: r2(tot.ventas), costo: r2(tot.costo), utilidad: r2(tot.ventas - tot.costo), margen_pct: tot.ventas > 0 ? Math.round((tot.ventas - tot.costo) / tot.ventas * 1000) / 10 : 0 };
  const top = (await db.query(
    `SELECT pd.nombre, sum(i.cantidad)::int AS piezas, sum(i.cantidad * i.precio_unitario) AS ventas FROM pedido_items i JOIN pedidos p ON p.id = i.pedido_id
       JOIN productos pd ON pd.id = i.producto_id WHERE ${FECHA} BETWEEN $1 AND $2 GROUP BY pd.nombre ORDER BY piezas DESC, pd.nombre LIMIT 10`, [rg.desde, rg.hasta])).rows
    .map((x) => ({ nombre: x.nombre, piezas: x.piezas, ventas: r2(x.ventas) }));
  const pc = (await db.query(
    `SELECT p.total, (SELECT COALESCE(sum(cantidad),0) FROM pedido_items WHERE pedido_id=p.id)::int AS piezas,
            (SELECT array_agg(DISTINCT pr.nombre) FROM pedido_items pi JOIN productos pr ON pr.id=pi.producto_id WHERE pi.pedido_id=p.id) AS productos
       FROM pedidos p WHERE ${FECHA} BETWEEN $1 AND $2`, [rg.desde, rg.hasta])).rows;
  const acum = new Map(TODOS.map((c) => [c.clave, { nombre: c.nombre, productos: c.productos.join(' + ') || 'Cualquier mezcla', pedidos: 0, piezas: 0, ventas: 0 }]));
  for (const x of pc) { const a = acum.get(comboDe(x.productos || []).clave); a.pedidos += 1; a.piezas += x.piezas; a.ventas += Number(x.total); }
  const combos = [...acum.values()].map((x) => ({ ...x, ventas: r2(x.ventas) }));
  if (req.query.formato === 'csv')
    return csv(res, `ventas-${rg.desde}-a-${rg.hasta}`, ['Periodo', 'Pedidos', 'Ventas', 'Costo de insumos', 'Utilidad bruta'],
      [...periodos.map((x) => [x.periodo, x.pedidos, x.ventas.toFixed(2), x.costo.toFixed(2), x.utilidad.toFixed(2)]), ['TOTAL', totales.pedidos, totales.ventas.toFixed(2), totales.costo.toFixed(2), totales.utilidad.toFixed(2)]]);
  res.json({ ...rg, agrupar, periodos, totales, top_productos: top, combos });
}));

router.get('/estatus', wrap(async (req, res) => {
  const rg = rango(req, res); if (!rg) return;
  const { rows } = await db.query(`SELECT p.estatus, count(*)::int AS n FROM pedidos p WHERE ${FECHA} BETWEEN $1 AND $2 GROUP BY p.estatus`, [rg.desde, rg.hasta]);
  const estatus = ESTATUS.map((e) => ({ estatus: e, pedidos: (rows.find((x) => x.estatus === e) || { n: 0 }).n }));
  const total = estatus.reduce((a, x) => a + x.pedidos, 0);
  if (req.query.formato === 'csv') return csv(res, `pedidos-por-estatus-${rg.desde}-a-${rg.hasta}`, ['Estatus', 'Pedidos'], [...estatus.map((x) => [x.estatus, x.pedidos]), ['TOTAL', total]]);
  res.json({ ...rg, estatus, total });
}));

router.get('/decisiones', wrap(async (req, res) => {
  const rg = rango(req, res); if (!rg) return;
  const { rows } = await db.query(
    `SELECT d.id,d.titulo,d.alternativa,d.base,d.notas,d.resultados,d.creado_en,u.nombre AS usuario
       FROM decisiones d LEFT JOIN usuarios u ON u.id=d.usuario_id
      WHERE (d.creado_en AT TIME ZONE ${TZ})::date BETWEEN $1 AND $2 ORDER BY d.creado_en DESC, d.id DESC`, [rg.desde, rg.hasta]);
  const decisiones = rows.map((x) => {
    const c = x.resultados && x.resultados.consenso;
    return { id: x.id, fecha: x.creado_en, titulo: x.titulo, alternativa: x.alternativa, base: x.base, usuario: x.usuario, notas: x.notas,
      coincide_con_consenso: c ? c.ganadora === x.alternativa : null, consenso: c ? c.ganadora : null };
  });
  const porBase = Object.entries(decisiones.reduce((a, x) => { a[x.base] = (a[x.base] || 0) + 1; return a; }, {})).map(([base, n]) => ({ base, decisiones: n }));
  const siguieron = decisiones.filter((x) => x.coincide_con_consenso === true).length;
  if (req.query.formato === 'csv')
    return csv(res, `decisiones-${rg.desde}-a-${rg.hasta}`, ['Fecha', 'Tema', 'Alternativa elegida', 'Basada en', 'Consenso recomendaba', 'Registro', 'Notas'],
      decisiones.map((x) => [new Date(x.fecha).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }), x.titulo, x.alternativa, x.base, x.consenso || '', x.usuario || '', x.notas || '']));
  res.json({ ...rg, decisiones, total: decisiones.length, siguieron_consenso: siguieron, por_base: porBase });
}));

router.get('/existencias', wrap(async (req, res) => {
  const { rows } = await db.query('SELECT nombre,unidad,stock,stock_minimo,costo_unitario FROM insumos WHERE activo ORDER BY nombre');
  const insumos = rows.map((x) => ({ nombre: x.nombre, unidad: x.unidad, stock: Number(x.stock), stock_minimo: Number(x.stock_minimo), costo_unitario: Number(x.costo_unitario),
    valor: r2(Number(x.stock) * Number(x.costo_unitario)), estado: Number(x.stock) <= Number(x.stock_minimo) ? 'Reorden' : 'OK' }));
  const totales = { valor: r2(insumos.reduce((a, x) => a + x.stock * x.costo_unitario, 0)), en_reorden: insumos.filter((x) => x.estado === 'Reorden').length };
  if (req.query.formato === 'csv')
    return csv(res, 'existencias', ['Insumo', 'Unidad', 'Stock', 'Minimo', 'Costo unitario', 'Valor', 'Estado'],
      [...insumos.map((x) => [x.nombre, x.unidad, x.stock, x.stock_minimo, x.costo_unitario, x.valor.toFixed(2), x.estado]), ['TOTAL', '', '', '', '', totales.valor.toFixed(2), '']]);
  res.json({ insumos, totales });
}));

module.exports = router;

const router = require('express').Router();
const db = require('../db');
const { auth, roles } = require('../middleware/auth');
const { wrap, paramId } = require('../util');
const svc = require('../services/pedidos');
const notif = require('../services/notificaciones');
const direccion = require('../services/direccion');

router.use(auth, roles('cocina', 'admin'));

const ESTATUS = ['Pendiente', 'En preparación', 'Listo para entrega', 'Entregado'];
const SIG = { 'Pendiente': 'En preparación', 'En preparación': 'Listo para entrega', 'Listo para entrega': 'Entregado' };
const ANT = Object.fromEntries(Object.entries(SIG).map(([a, b]) => [b, a]));

async function fichas(rows) {
  const ids = rows.map((r) => r.id);
  const ing = ids.length ? (await db.query(
    `SELECT pi.pedido_id, i.nombre, i.unidad, ceil(sum(ri.cantidad / r.rinde * pi.cantidad) * 10000) / 10000 AS cantidad
       FROM pedido_items pi JOIN recetas r ON r.producto_id = pi.producto_id JOIN receta_ingredientes ri ON ri.receta_id = r.id JOIN insumos i ON i.id = ri.insumo_id
      WHERE pi.pedido_id = ANY($1) GROUP BY pi.pedido_id, i.id ORDER BY i.nombre`, [ids])).rows : [];
  const por = new Map();
  for (const x of ing) { if (!por.has(x.pedido_id)) por.set(x.pedido_id, []); por.get(x.pedido_id).push({ nombre: x.nombre, unidad: x.unidad, cantidad: Number(x.cantidad) }); }
  return rows.map((r) => ({ id: r.id, folio: svc.folio(r.id), estatus: r.estatus, fecha: r.fecha, hora: r.hora, atrasado: r.atrasado, cliente: r.cliente,
    presentacion: r.presentacion, dedicatoria: r.dedicatoria, direccion: direccion.desdeFila(r), items: r.items || [], ingredientes: por.get(r.id) || [] }));
}
const BASE = `SELECT p.id,p.estatus,p.fecha_entrega::text AS fecha,left(p.hora_entrega::text,5) AS hora,p.dedicatoria,pr.nombre AS presentacion,u.nombre AS cliente,${direccion.COLS},
    (p.fecha_entrega < $1::date AND p.estatus <> 'Entregado') AS atrasado,
    (SELECT json_agg(json_build_object('nombre',pd.nombre,'cantidad',i.cantidad) ORDER BY pd.nombre) FROM pedido_items i JOIN productos pd ON pd.id=i.producto_id WHERE i.pedido_id=p.id) AS items
  FROM pedidos p LEFT JOIN presentaciones pr ON pr.id=p.presentacion_id JOIN usuarios u ON u.id=p.cliente_id`;

router.get('/pedidos', wrap(async (req, res) => {
  const fecha = req.query.fecha || svc.todayMX();
  if (!svc.fechaValida(fecha)) return res.status(400).json({ error: 'Elige una fecha válida (AAAA-MM-DD).' });
  const { rows } = await db.query(BASE + ` WHERE p.fecha_entrega = $1::date OR (p.fecha_entrega < $1::date AND p.estatus <> 'Entregado')
                                          ORDER BY p.fecha_entrega, p.hora_entrega, p.id`, [fecha]);
  const pedidos = await fichas(rows);
  const resumen = Object.fromEntries(ESTATUS.map((e) => [e, pedidos.filter((p) => p.estatus === e).length]));
  res.json({ fecha, pedidos, resumen });
}));

router.get('/pedidos/:id', wrap(async (req, res) => {
  const id = paramId(req);
  if (!id) return res.status(400).json({ error: 'Identificador inválido.' });
  const { rows } = await db.query(BASE + ' WHERE p.id = $2', [svc.todayMX(), id]);
  if (!rows[0]) return res.status(404).json({ error: 'Pedido no encontrado.' });
  res.json({ pedido: (await fichas(rows))[0] });
}));

router.patch('/pedidos/:id/estatus', wrap(async (req, res) => {
  const id = paramId(req), objetivo = (req.body || {}).estatus;
  if (!id) return res.status(400).json({ error: 'Identificador inválido.' });
  if (!ESTATUS.includes(objetivo)) return res.status(400).json({ error: 'Estatus inválido.' });
  const previo = ANT[objetivo];
  if (!previo) return res.status(409).json({ error: 'Un pedido no puede regresar a Pendiente.' });
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    const p = (await c.query('SELECT id,estatus FROM pedidos WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!p) { await c.query('ROLLBACK'); return res.status(404).json({ error: 'Pedido no encontrado.' }); }
    const pedido = { id, folio: svc.folio(id), estatus: objetivo };
    if (p.estatus === objetivo) { await c.query('COMMIT'); return res.json({ pedido, sin_cambio: true }); }
    if (p.estatus !== previo) {
      await c.query('ROLLBACK');
      return res.status(409).json({ error: `El pedido está en “${p.estatus}”${SIG[p.estatus] ? `; solo puede pasar a “${SIG[p.estatus]}”` : ' y ya no puede cambiar'}.` });
    }
    await c.query('UPDATE pedidos SET estatus=$2 WHERE id=$1', [id, objetivo]);
    await c.query('INSERT INTO pedido_estatus_historial(pedido_id,estatus,usuario_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [id, objetivo, req.user.id]);
    await notif.encolar(c, id, objetivo);
    await c.query('COMMIT');
    notif.disparar();
    res.json({ pedido, sin_cambio: false });
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}));

module.exports = router;

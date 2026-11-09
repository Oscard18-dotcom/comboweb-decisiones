const router = require('express').Router();
const db = require('../db');
const { auth, roles } = require('../middleware/auth');
const { wrap, paramId } = require('../util');
const compras = require('../services/compras');

router.use(auth, roles('admin'));

const manejar = (fn) => wrap(async (req, res) => {
  try { await fn(req, res); } catch (e) { if (e.publico) return res.status(e.status).json({ error: e.publico }); throw e; }
});

router.get('/sugerencias', manejar(async (req, res) => {
  const pid = req.query.proveedor_id === undefined ? null : Number.parseInt(req.query.proveedor_id, 10);
  if (req.query.proveedor_id !== undefined && (!Number.isInteger(pid) || pid <= 0)) return res.status(400).json({ error: 'Proveedor inválido.' });
  const { rows } = await db.query(
    `SELECT i.id,i.nombre,i.unidad,i.stock,i.stock_minimo,CEIL(GREATEST(i.stock_minimo*2 - i.stock,0)*10000)/10000 AS sugerido
       FROM insumos i WHERE i.activo AND i.stock <= i.stock_minimo
        AND ($1::int IS NULL OR NOT EXISTS (SELECT 1 FROM proveedor_insumos x WHERE x.proveedor_id=$1)
             OR EXISTS (SELECT 1 FROM proveedor_insumos x WHERE x.proveedor_id=$1 AND x.insumo_id=i.id))
      ORDER BY i.nombre`, [pid]);
  res.json({ sugerencias: rows.map((r) => ({ id: r.id, nombre: r.nombre, unidad: r.unidad, stock: Number(r.stock), stock_minimo: Number(r.stock_minimo), sugerido: Number(r.sugerido) })) });
}));

router.get('/', manejar(async (req, res) => {
  const estado = ['enviado', 'recibido', 'cancelado'].includes(req.query.estado) ? req.query.estado : null;
  res.json({ pedidos: await compras.lista(estado) });
}));

router.get('/:id', manejar(async (req, res) => {
  const id = paramId(req);
  if (!id) return res.status(400).json({ error: 'Identificador inválido.' });
  const d = await compras.detalle(db, id);
  if (!d) return res.status(404).json({ error: 'Pedido no encontrado.' });
  res.json({ pedido: d });
}));

router.post('/', manejar(async (req, res) => { res.status(201).json({ pedido: await compras.crear(req.user, req.body) }); }));

router.post('/:id/recibir', manejar(async (req, res) => {
  const id = paramId(req);
  if (!id) return res.status(400).json({ error: 'Identificador inválido.' });
  res.json({ pedido: await compras.recibir(id, req.user) });
}));

router.post('/:id/cancelar', manejar(async (req, res) => {
  const id = paramId(req);
  if (!id) return res.status(400).json({ error: 'Identificador inválido.' });
  res.json({ pedido: await compras.cancelar(id, req.user) });
}));

module.exports = router;

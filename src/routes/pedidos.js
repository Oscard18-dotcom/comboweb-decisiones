const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { auth, roles } = require('../middleware/auth');
const { wrap, paramId } = require('../util');
const svc = require('../services/pedidos');
const pagos = require('../payments');

const lim = (limit, mensaje) => rateLimit({ windowMs: 15 * 60 * 1000, limit, standardHeaders: true, legacyHeaders: false, message: { error: mensaje } });
const limCotizar = lim(300, 'Demasiadas consultas. Intenta de nuevo en unos minutos.');
const limCheckout = lim(30, 'Demasiados intentos de pago. Intenta de nuevo en unos minutos.');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Horarios libres de una fecha (HU03)
router.get('/disponibilidad', limCotizar, wrap(async (req, res) => {
  if (!svc.fechaValida(req.query.fecha)) return res.status(400).json({ error: 'Elige una fecha válida (AAAA-MM-DD).' });
  res.json({ fecha: req.query.fecha, horarios: await svc.horarios(db, req.query.fecha) });
}));

// Cotiza y valida el combo sin guardar nada (HU01–HU03)
router.post('/cotizar', limCotizar, wrap(async (req, res) => {
  const { errores, detalle } = await svc.validar(db, req.body);
  res.json({ ok: errores.length === 0, errores, detalle });
}));

// Paso 12: valida, guarda el combo y entrega el enlace de la pasarela (HU04)
router.post('/checkout', auth, roles('cliente'), limCheckout, wrap(async (req, res) => {
  const r = await svc.crearCheckout(req.user, req.body, pagos.obtener());
  if (r.errores) return res.status(422).json({ error: r.errores[0].mensaje, errores: r.errores });
  res.status(201).json(r);
}));

// Estado de un pago (el cliente lo consulta al volver de la pasarela)
router.get('/checkout/:id', auth, roles('cliente'), wrap(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(400).json({ error: 'Identificador inválido.' });
  const { rows } = await db.query('SELECT id,estado,total,pedido_id FROM checkouts WHERE id=$1 AND cliente_id=$2', [req.params.id, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Pago no encontrado.' });
  res.json({ checkout: { ...rows[0], total: Number(rows[0].total) } });
}));

router.get('/', auth, roles('cliente'), wrap(async (req, res) => res.json({ pedidos: await svc.pedidosDe(req.user.id) })));

// Detalle / comprobante digital: el dueño, cocina o administración
router.get('/:id', auth, wrap(async (req, res) => {
  const id = paramId(req);
  if (!id) return res.status(400).json({ error: 'Identificador inválido.' });
  const p = await svc.detallePedido(id);
  const permitido = p && (p.cliente_id === req.user.id || ['admin', 'cocina'].includes(req.user.rol));
  if (!permitido) return res.status(404).json({ error: 'Pedido no encontrado.' });
  delete p.cliente_id;
  res.json({ pedido: p });
}));

module.exports = router;

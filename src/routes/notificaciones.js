const router = require('express').Router();
const db = require('../db');
const { auth, roles } = require('../middleware/auth');
const { wrap, paramId } = require('../util');
const notif = require('../services/notificaciones');

router.use(auth, roles('admin'));

// Lista de avisos enviados y su estado. ?estado=fallida|error|pendiente|enviada
router.get('/', wrap(async (req, res) => {
  const estado = ['pendiente', 'enviando', 'enviada', 'error', 'fallida'].includes(req.query.estado) ? req.query.estado : null;
  const { rows } = await db.query(
    `SELECT id,pedido_id,pedido_proveedor_id,plantilla,destinatario,asunto,estado,intentos,ultimo_error,creado_en,enviada_en
       FROM notificaciones WHERE ($1::text IS NULL OR estado=$1) ORDER BY id DESC LIMIT 100`, [estado]);
  res.json({ notificaciones: rows.map((r) => ({ ...r, folio: r.pedido_proveedor_id ? notif.folioPP(r.pedido_proveedor_id) : notif.folio(r.pedido_id) })) });
}));

// Reintentar una notificación que falló
router.post('/:id/reintentar', wrap(async (req, res) => {
  const id = paramId(req);
  if (!id) return res.status(400).json({ error: 'Identificador inválido.' });
  const { rows } = await db.query(
    "UPDATE notificaciones SET estado='pendiente', intentos=0, proximo_intento=NULL WHERE id=$1 AND estado IN ('error','fallida') RETURNING id", [id]);
  if (!rows[0]) return res.status(409).json({ error: 'Solo se pueden reintentar los avisos con error.' });
  await notif.enviarPendientes();
  const n = (await db.query('SELECT id,estado,intentos,ultimo_error FROM notificaciones WHERE id=$1', [id])).rows[0];
  res.json({ notificacion: n });
}));

module.exports = router;

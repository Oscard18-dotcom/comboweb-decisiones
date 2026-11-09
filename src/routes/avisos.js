const router = require('express').Router();
const db = require('../db');
const { auth, roles } = require('../middleware/auth');
const { wrap, paramId } = require('../util');
const notif = require('../services/notificaciones');

router.use(auth, roles('cliente'));

const DONDE = 'cliente_id=$1 AND pedido_id IS NOT NULL';

router.get('/', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT id,pedido_id,plantilla,asunto,creado_en,leida_en FROM notificaciones WHERE ${DONDE} ORDER BY creado_en DESC, id DESC LIMIT 50`, [req.user.id]);
  const n = (await db.query(`SELECT count(*)::int AS n FROM notificaciones WHERE ${DONDE} AND leida_en IS NULL`, [req.user.id])).rows[0].n;
  res.json({
    no_leidas: n,
    avisos: rows.map((r) => ({ id: r.id, pedido_id: r.pedido_id, folio: notif.folio(r.pedido_id), titulo: r.asunto, mensaje: notif.mensajeAviso(r.plantilla, notif.folio(r.pedido_id)), creado_en: r.creado_en, leida: !!r.leida_en })),
  });
}));

router.get('/contador', wrap(async (req, res) => {
  res.json({ no_leidas: (await db.query(`SELECT count(*)::int AS n FROM notificaciones WHERE ${DONDE} AND leida_en IS NULL`, [req.user.id])).rows[0].n });
}));

router.post('/leer-todas', wrap(async (req, res) => {
  const r = await db.query(`UPDATE notificaciones SET leida_en=now() WHERE ${DONDE} AND leida_en IS NULL`, [req.user.id]);
  res.json({ marcadas: r.rowCount });
}));

router.post('/:id/leida', wrap(async (req, res) => {
  const id = paramId(req);
  if (!id) return res.status(400).json({ error: 'Identificador inválido.' });
  const r = await db.query(`UPDATE notificaciones SET leida_en=coalesce(leida_en,now()) WHERE id=$2 AND ${DONDE} RETURNING id`, [req.user.id, id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Aviso no encontrado.' });
  res.json({ ok: true });
}));

module.exports = router;

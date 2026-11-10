const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { auth, roles } = require('../middleware/auth');
const { wrap } = require('../util');
const wh = require('../services/warehouse');

router.use(auth, roles('admin'));
router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 200, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas consultas. Intenta de nuevo en unos minutos.' } }));

router.get('/resumen', wrap(async (req, res) => {
  res.json(await wh.resumen());
}));
router.post('/cargar', wrap(async (req, res) => {
  const r = await wh.cargar({ demo: !!(req.body && req.body.demo === true), usuarioId: req.user.id });
  res.json({ ok: true, ...r });
}));
router.delete('/demo', wrap(async (req, res) => res.json({ ok: true, borradas: await wh.quitarDemo() })));
router.get('/exportar', wrap(async (req, res) => res.json(await wh.exportar())));

module.exports = router;

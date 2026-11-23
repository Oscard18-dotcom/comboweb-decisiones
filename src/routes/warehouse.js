const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { auth, roles } = require('../middleware/auth');
const { wrap } = require('../util');
const wh = require('../services/warehouse');
const weka = require('../services/weka');

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

// Conjuntos de datos para Weka (ARFF o CSV). Todo se arma en el servidor; el id se valida contra una lista fija.
router.get('/weka', wrap(async (req, res) => res.json(await weka.catalogo())));
router.get('/weka/:id', wrap(async (req, res) => {
  const id = String(req.params.id);
  if (!weka.IDS.includes(id)) return res.status(404).json({ error: 'Ese conjunto de datos no existe.' });
  try { res.json(await weka.descargar(id, String(req.query.formato || 'arff'))); }
  catch (e) { if (e.status >= 400 && e.status < 500) return res.status(e.status).json({ error: e.message }); throw e; }
}));

module.exports = router;

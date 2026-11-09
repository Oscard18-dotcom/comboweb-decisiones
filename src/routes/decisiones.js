const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { auth, roles } = require('../middleware/auth');
const { wrap } = require('../util');
const svc = require('../services/decisiones');

router.use(auth, roles('admin'));
router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas consultas. Intenta de nuevo en unos minutos.' } }));

async function casosConDatos() {
  const guardados = Object.fromEntries((await db.query('SELECT caso_id,pagos,probabilidades,alfa,actualizado_en FROM decision_datos')).rows.map((r) => [r.caso_id, r]));
  return svc.casos().map((c) => {
    const g = guardados[c.id];
    if (!g || g.pagos.length !== c.alternativas.length) return { ...c, guardado: false, alfa: 0.6 };
    return { ...c, guardado: true, actualizado_en: g.actualizado_en, alfa: Number(g.alfa), probabilidades: g.probabilidades,
      alternativas: c.alternativas.map((a, i) => ({ ...a, pagos: g.pagos[i] })) };
  });
}
router.get('/casos', wrap(async (req, res) => res.json({ casos: await casosConDatos(), criterios: svc.CRITERIOS.map(({ clave, nombre, tipo, idea }) => ({ clave, nombre, tipo, idea })) })));

router.put('/casos/:id', wrap(async (req, res) => {
  const caso = /^[a-z0-9-]{1,40}$/.test(req.params.id) ? svc.caso(req.params.id) : null;
  if (!caso) return res.status(404).json({ error: 'Ese tipo de decisión no existe.' });
  const b = req.body || {};
  const ev = svc.evaluar({ alternativas: caso.alternativas.map((a) => a.nombre), escenarios: caso.escenarios, pagos: b.pagos, probabilidades: b.probabilidades, alfa: b.alfa });
  if (ev.error) return res.status(400).json({ error: ev.error });
  const pagos = ev.alternativas.map((_, i) => b.pagos[i].map(Number));
  await db.query(`INSERT INTO decision_datos(caso_id,pagos,probabilidades,alfa,usuario_id) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT (caso_id) DO UPDATE SET pagos=$2, probabilidades=$3, alfa=$4, usuario_id=$5, actualizado_en=now()`,
  [caso.id, JSON.stringify(pagos), JSON.stringify(ev.probabilidades), ev.alfa, req.user.id]);
  res.json({ ok: true });
}));

router.delete('/casos/:id', wrap(async (req, res) => {
  if (!/^[a-z0-9-]{1,40}$/.test(req.params.id)) return res.status(404).json({ error: 'Ese tipo de decisión no existe.' });
  await db.query('DELETE FROM decision_datos WHERE caso_id=$1', [req.params.id]);
  res.json({ ok: true });
}));

router.post('/evaluar', (req, res) => {
  const r = svc.evaluar(req.body);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ evaluacion: r });
});

router.post('/exportar', (req, res) => {
  const r = svc.exportar(req.body, (req.body || {}).titulo);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(r);
});

router.post('/', wrap(async (req, res) => {
  const b = req.body || {};
  const caso = typeof b.caso_id === 'string' && /^[a-z0-9-]{1,40}$/.test(b.caso_id) ? b.caso_id : null;
  if (!caso) return res.status(400).json({ error: 'Falta el tipo de decisión.' });
  const ev = svc.evaluar(b.matriz);
  if (ev.error) return res.status(400).json({ error: ev.error });
  const alternativa = typeof b.alternativa === 'string' ? b.alternativa.trim() : '';
  if (!ev.alternativas.includes(alternativa)) return res.status(400).json({ error: 'Elige una de las alternativas de la matriz.' });
  const base = b.base === undefined || b.base === 'consenso' ? 'consenso' : String(b.base);
  if (base !== 'consenso' && !svc.CRITERIOS.some((c) => c.clave === base)) return res.status(400).json({ error: 'Criterio no válido.' });
  let notas = null;
  if (b.notas != null && b.notas !== '') {
    if (typeof b.notas !== 'string') return res.status(400).json({ error: 'Las notas no son válidas.' });
    notas = b.notas.replace(/[\u0000-\u001F\u007F]/g, ' ').trim() || null;
    if (notas && notas.length > 500) return res.status(400).json({ error: 'Las notas no pueden pasar de 500 caracteres.' });
  }
  const conocido = svc.caso(caso);
  const titulo = (conocido ? conocido.titulo : typeof b.titulo === 'string' ? b.titulo.trim().slice(0, 120) : '') || 'Decisión';
  const matriz = { alternativas: ev.alternativas, escenarios: ev.escenarios, probabilidades: ev.probabilidades, alfa: ev.alfa,
    pagos: ev.alternativas.map((_, i) => b.matriz.pagos[i].map(Number)) };
  const resultados = { criterios: ev.resultados.map((r) => ({ clave: r.clave, criterio: r.criterio, valores: r.valores, ganadora: r.ganador === null ? null : ev.alternativas[r.ganador] })), consenso: ev.consenso };
  const { rows } = await db.query(
    `INSERT INTO decisiones(caso_id,titulo,alternativa,base,notas,matriz,resultados,usuario_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,creado_en`,
    [caso, titulo, alternativa, base, notas, JSON.stringify(matriz), JSON.stringify(resultados), req.user.id]);
  res.status(201).json({ decision: { id: rows[0].id, creado_en: rows[0].creado_en, caso_id: caso, titulo, alternativa, base, notas } });
}));

router.get('/', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT d.id,d.caso_id,d.titulo,d.alternativa,d.base,d.notas,d.matriz,d.resultados,d.creado_en,u.nombre AS usuario
       FROM decisiones d LEFT JOIN usuarios u ON u.id=d.usuario_id ORDER BY d.id DESC LIMIT 100`);
  res.json({ decisiones: rows });
}));

module.exports = router;

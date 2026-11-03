// Toma de decisiones del administrador: casos de ejemplo, evaluación con 6 criterios, exportación y registro de decisiones.
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { auth, roles } = require('../middleware/auth');
const { wrap } = require('../util');
const svc = require('../services/decisiones');

router.use(auth, roles('admin'));
router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas consultas. Intenta de nuevo en unos minutos.' } }));

router.get('/casos', (req, res) => res.json({ casos: svc.casos(), criterios: svc.CRITERIOS.map(({ clave, nombre, tipo, idea }) => ({ clave, nombre, tipo, idea })) }));

// Calcula los 6 criterios para la matriz que se está editando (no guarda nada)
router.post('/evaluar', (req, res) => {
  const r = svc.evaluar(req.body);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ evaluacion: r });
});

// Devuelve los dos archivos CSV (matriz y resultados) para Power BI / Excel
router.post('/exportar', (req, res) => {
  const r = svc.exportar(req.body, (req.body || {}).titulo);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(r);
});

// Registra la decisión tomada. El servidor vuelve a evaluar la matriz: lo que se guarda nunca depende de resultados enviados por el navegador.
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

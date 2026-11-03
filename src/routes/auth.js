const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { wrap, isEmail, isPassword, isText } = require('../util');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT) || 20, // intentos por 15 minutos (se puede ajustar con AUTH_RATE_LIMIT)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' },
});
const sign = (u) => jwt.sign({ id: u.id, v: u.token_version || 0 }, process.env.JWT_SECRET, { expiresIn: '8h' });
const pub = (u) => ({ id: u.id, nombre: u.nombre, correo: u.correo, rol: u.rol });
// Hash de relleno: evita que el tiempo de respuesta revele si el correo existe
const DUMMY_HASH = bcrypt.hashSync('relleno-no-es-una-contraseña', 12);

// Registro público: SIEMPRE crea clientes. El personal lo da de alta el administrador.
router.post('/register', limiter, wrap(async (req, res) => {
  const { nombre, correo, telefono, password } = req.body || {};
  if (!isText(nombre, 2, 80)) return res.status(400).json({ error: 'Escribe tu nombre completo.' });
  if (!isEmail(correo)) return res.status(400).json({ error: 'Escribe un correo válido.' });
  if (!isPassword(password)) return res.status(400).json({ error: 'La contraseña debe tener entre 8 y 72 caracteres.' });
  const hash = await bcrypt.hash(password, 12);
  try {
    const { rows } = await db.query(
      "INSERT INTO usuarios(nombre,correo,telefono,password_hash,rol) VALUES($1,$2,$3,$4,'cliente') RETURNING id,nombre,correo,rol,token_version",
      [nombre.trim(), correo.trim().toLowerCase(), telefono ? String(telefono).slice(0, 20) : null, hash]);
    res.status(201).json({ token: sign(rows[0]), usuario: pub(rows[0]) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe una cuenta con este correo. Inicia sesión.' });
    throw e;
  }
}));

router.post('/login', limiter, wrap(async (req, res) => {
  const { correo, password } = req.body || {};
  const { rows } = await db.query(
    'SELECT id,nombre,correo,rol,activo,password_hash,token_version FROM usuarios WHERE lower(correo)=lower($1)', [String(correo || '')]);
  const u = rows[0];
  const ok = await bcrypt.compare(String(password || ''), u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok || !u.activo) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  res.json({ token: sign(u), usuario: pub(u) });
}));

// Cambiar la propia contraseña: cierra todas las demás sesiones y devuelve un token nuevo para esta
router.post('/cambiar-password', limiter, auth, wrap(async (req, res) => {
  const { actual, nueva } = req.body || {};
  if (!isPassword(nueva)) return res.status(400).json({ error: 'La nueva contraseña debe tener entre 8 y 72 caracteres.' });
  if (actual === nueva) return res.status(400).json({ error: 'La nueva contraseña debe ser distinta de la actual.' });
  const { rows } = await db.query('SELECT password_hash FROM usuarios WHERE id=$1', [req.user.id]);
  if (!(await bcrypt.compare(String(actual || ''), rows[0].password_hash))) return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
  const { rows: [u] } = await db.query('UPDATE usuarios SET password_hash=$2, token_version=token_version+1 WHERE id=$1 RETURNING id,nombre,correo,rol,token_version',
    [req.user.id, await bcrypt.hash(nueva, 12)]);
  res.json({ ok: true, token: sign(u) });
}));

router.get('/me', auth, (req, res) => res.json({ usuario: pub(req.user) }));

module.exports = router;

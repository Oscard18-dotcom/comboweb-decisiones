const jwt = require('jsonwebtoken');
const db = require('../db');

async function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await db.query('SELECT id,nombre,correo,rol,activo,token_version FROM usuarios WHERE id=$1', [payload.id]);
    if (!rows[0] || !rows[0].activo || (payload.v ?? 0) !== rows[0].token_version) return res.status(401).json({ error: 'Sesión inválida.' });
    req.user = rows[0];
    next();
  } catch (e) {
    if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError')
      return res.status(401).json({ error: 'Sesión inválida o expirada.' });
    next(e);
  }
}

const roles = (...permitidos) => (req, res, next) =>
  permitidos.includes(req.user.rol) ? next() : res.status(403).json({ error: 'No tienes permiso para esta acción.' });

module.exports = { auth, roles };

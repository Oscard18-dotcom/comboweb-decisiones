// Envuelve handlers async para que los errores lleguen al manejador global
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const isEmail = (v) => typeof v === 'string' && v.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
// bcrypt solo considera los primeros 72 bytes
const isPassword = (v) => typeof v === 'string' && v.length >= 8 && Buffer.byteLength(v) <= 72;
const isText = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
const parsePrice = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 100000 ? Math.round(n * 100) / 100 : null;
};
const paramId = (req) => {
  const n = Number.parseInt(req.params.id, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

module.exports = { wrap, isEmail, isPassword, isText, parsePrice, paramId };

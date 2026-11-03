// Selector del servicio de correo. Se lee en cada envío para poder cambiarlo en pruebas.
let reemplazo = null;
const nombre = () => process.env.MAIL_PROVIDER || 'consola';
function obtener() {
  if (reemplazo) return reemplazo;
  const n = nombre();
  return n === 'smtp' ? require('./smtp') : n === 'resend' ? require('./resend') : require('./consola');
}
module.exports = { nombre, obtener, reemplazar: (p) => { reemplazo = p; } };

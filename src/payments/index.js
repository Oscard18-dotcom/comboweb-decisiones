let reemplazo = null;
const nombre = () => process.env.PAYMENT_PROVIDER || 'simulado';
const simuladoPermitido = () => nombre() === 'simulado' && (process.env.NODE_ENV !== 'production' || process.env.MODO_DEMO === 'true');
function obtener() {
  if (reemplazo) return reemplazo;
  return nombre() === 'stripe' ? require('./stripe') : require('./simulado');
}
module.exports = { nombre, simuladoPermitido, obtener, reemplazar: (p) => { reemplazo = p; } };

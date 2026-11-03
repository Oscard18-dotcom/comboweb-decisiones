// Pasarela SIMULADA: solo para desarrollo y pruebas. No cobra nada.
// Su endpoint de "aprobar" está deshabilitado cuando NODE_ENV=production.
const base = () => process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
module.exports = {
  nombre: 'simulado',
  async crearSesion({ checkoutId }) {
    return { url: `${base()}/pago-simulado.html?checkout=${checkoutId}`, referencia: 'sim_' + checkoutId };
  },
};

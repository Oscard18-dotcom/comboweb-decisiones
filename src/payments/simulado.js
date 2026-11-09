const base = () => process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
module.exports = {
  nombre: 'simulado',
  async crearSesion({ checkoutId }) {
    return { url: `${base()}/pago-simulado.html?checkout=${checkoutId}`, referencia: 'sim_' + checkoutId };
  },
};

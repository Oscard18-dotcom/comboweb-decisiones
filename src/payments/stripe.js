let cliente = null;
const sdk = () => {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Falta STRIPE_SECRET_KEY');
  return cliente || (cliente = require('stripe')(process.env.STRIPE_SECRET_KEY));
};
const base = () => process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;

module.exports = {
  nombre: 'stripe',
  async crearSesion({ checkoutId, total, correo }) {
    const s = await sdk().checkout.sessions.create({
      mode: 'payment',
      client_reference_id: checkoutId,
      customer_email: correo,
      line_items: [{ quantity: 1, price_data: { currency: 'mxn', unit_amount: Math.round(total * 100), product_data: { name: 'Pedido EN COMBO' } } }],
      success_url: `${base()}/?checkout=${checkoutId}`,
      cancel_url: `${base()}/?cancelado=${checkoutId}`,
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
    }, { idempotencyKey: 'checkout_' + checkoutId });
    return { url: s.url, referencia: s.id };
  },
  verificarEvento(cuerpoCrudo, firma) {
    if (!process.env.STRIPE_WEBHOOK_SECRET) throw new Error('Falta STRIPE_WEBHOOK_SECRET');
    return sdk().webhooks.constructEvent(cuerpoCrudo, firma, process.env.STRIPE_WEBHOOK_SECRET);
  },
};

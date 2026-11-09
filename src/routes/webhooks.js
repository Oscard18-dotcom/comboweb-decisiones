const db = require('../db');
const svc = require('../services/pedidos');
const pagos = require('../payments');
const stripe = require('../payments/stripe');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function stripeWebhook(req, res) {
  if (pagos.nombre() !== 'stripe') return res.status(404).json({ error: 'Ruta no encontrada.' });
  let ev;
  try { ev = stripe.verificarEvento(req.body, req.headers['stripe-signature']); }
  catch (e) { return res.status(400).json({ error: 'Firma inválida.' }); }
  try {
    const s = ev.data.object;
    const id = s && s.client_reference_id;
    if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(ev.type)) {
      if (s.payment_status === 'paid' && UUID.test(id || ''))
        await svc.confirmarPago(id, { proveedor: 'stripe', referencia: s.id, monto: s.amount_total / 100, moneda: s.currency });
    } else if (ev.type === 'checkout.session.expired' && UUID.test(id || '')) {
      await db.query("UPDATE checkouts SET estado='expirado' WHERE id=$1 AND estado='creado'", [id]);
    }
    res.json({ received: true });
  } catch (e) {
    console.error('Error en webhook de Stripe:', e);
    res.status(500).json({ error: 'Error al procesar el evento.' });
  }
}
module.exports = { stripeWebhook };

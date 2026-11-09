require('./config');
const express = require('express');
const helmet = require('helmet');
const path = require('path');
const db = require('./db');

const app = express();
app.disable('x-powered-by');
app.use(helmet());
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));

app.post('/api/pagos/webhook/stripe', express.raw({ type: 'application/json', limit: '200kb' }), require('./routes/webhooks').stripeWebhook);

app.use(express.json({ limit: '100kb' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/catalogo', require('./routes/catalog'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/pedidos', require('./routes/pedidos'));
app.use('/api/inventario', require('./routes/inventario'));
app.use('/api/recetas', require('./routes/recetas'));
app.use('/api/cocina', require('./routes/cocina'));
app.use('/api/reportes', require('./routes/reportes'));
app.use('/api/notificaciones', require('./routes/notificaciones'));
app.use('/api/avisos', require('./routes/avisos'));
app.use('/api/decisiones', require('./routes/decisiones'));
app.use('/api/warehouse', require('./routes/warehouse'));
app.use('/api/pagos', require('./routes/pagos'));
app.use('/api/proveedores', require('./routes/proveedores'));
app.use('/api/pedidos-proveedor', require('./routes/pedidosProveedor'));
app.get('/api/salud', async (req, res) => {
  try { await db.query('SELECT 1'); res.json({ estado: 'ok', version: require('../package.json').version, modo_demo: process.env.MODO_DEMO === 'true' }); }
  catch (e) { res.status(503).json({ estado: 'error' }); }
});
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'La solicitud es demasiado grande.' });
  if (err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: 'Solicitud inválida.' });
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

module.exports = app;

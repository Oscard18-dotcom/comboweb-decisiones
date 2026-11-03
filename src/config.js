require('dotenv').config();

if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL en el archivo .env');
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)
  throw new Error('Define JWT_SECRET en .env (mínimo 32 caracteres aleatorios).');

// Render (y otros) publican su dirección pública en una variable propia: si no definiste PUBLIC_URL, se usa esa.
if (!process.env.PUBLIC_URL && process.env.RENDER_EXTERNAL_URL) process.env.PUBLIC_URL = process.env.RENDER_EXTERNAL_URL;
// MODO_DEMO=true: sitio público de DEMOSTRACIÓN (pago y correo simulados). Permite publicarlo en línea sin pasarela de pago.
// Nunca se activa solo: debe escribirse a propósito. No cobra ni manda correos reales.
const demo = process.env.MODO_DEMO === 'true';

const proveedor = process.env.PAYMENT_PROVIDER || 'simulado';
if (!['simulado', 'stripe'].includes(proveedor)) throw new Error('PAYMENT_PROVIDER debe ser "simulado" o "stripe".');
if (proveedor === 'simulado' && process.env.NODE_ENV === 'production' && !demo)
  throw new Error('PAYMENT_PROVIDER=simulado no está permitido en producción. Usa "stripe" (o, solo para una demostración pública sin cobros, define MODO_DEMO=true).');
if (proveedor === 'stripe' && (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET))
  throw new Error('Con PAYMENT_PROVIDER=stripe define STRIPE_SECRET_KEY y STRIPE_WEBHOOK_SECRET.');

const correo = process.env.MAIL_PROVIDER || 'consola';
if (!['consola', 'smtp', 'resend'].includes(correo)) throw new Error('MAIL_PROVIDER debe ser "consola", "smtp" o "resend".');
if (correo === 'consola' && process.env.NODE_ENV === 'production' && !demo)
  throw new Error('MAIL_PROVIDER=consola no está permitido en producción: los clientes no recibirían sus avisos. Usa "smtp" o "resend" (o, solo para una demostración pública, define MODO_DEMO=true).');
if (correo === 'smtp' && (!process.env.SMTP_HOST || !process.env.MAIL_FROM)) throw new Error('Con MAIL_PROVIDER=smtp define SMTP_HOST y MAIL_FROM.');
if (correo === 'resend' && (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM)) throw new Error('Con MAIL_PROVIDER=resend define RESEND_API_KEY y MAIL_FROM.');

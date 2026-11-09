let transporte = null, llave = '';
function obtenerTransporte() {
  const k = [process.env.SMTP_HOST, process.env.SMTP_PORT, process.env.SMTP_USER, process.env.SMTP_PASS].join('|');
  if (!transporte || k !== llave) {
    const puerto = Number(process.env.SMTP_PORT || 587);
    transporte = require('nodemailer').createTransport({
      host: process.env.SMTP_HOST, port: puerto, secure: puerto === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    });
    llave = k;
  }
  return transporte;
}
module.exports = {
  nombre: 'smtp',
  async enviar({ a, asunto, texto, html, responderA }) {
    await obtenerTransporte().sendMail({ from: process.env.MAIL_FROM, to: a, subject: asunto, text: texto, html, ...(responderA ? { replyTo: responderA } : {}) });
  },
};

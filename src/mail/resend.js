// Correo real por API HTTPS (Resend). Útil si tu hosting bloquea el puerto SMTP.
module.exports = {
  nombre: 'resend',
  async enviar({ a, asunto, texto, html, responderA }) {
    const r = await fetch(process.env.MAIL_API_URL || 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [a], subject: asunto, text: texto, html, ...(responderA ? { reply_to: responderA } : {}) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`Resend respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
  },
};

function remitente(de) {
  const m = String(de || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].trim() || undefined, email: m[2].trim() } : { email: String(de || '').trim() };
}
module.exports = {
  nombre: 'brevo',
  remitente,
  async enviar({ a, asunto, texto, html, responderA }) {
    const r = await fetch(process.env.MAIL_API_URL || 'https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: remitente(process.env.MAIL_FROM), to: [{ email: a }], subject: asunto, textContent: texto, ...(html ? { htmlContent: html } : {}), ...(responderA ? { replyTo: { email: responderA } } : {}) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`Brevo respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
  },
};

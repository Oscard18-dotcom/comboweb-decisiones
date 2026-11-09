process.env.AUTH_RATE_LIMIT_OLVIDE = '7';
const crypto = require('crypto');
const app = require('../src/app');
const db = require('../src/db');
const mail = require('../src/mail');

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const server = app.listen(0);
const B = `http://localhost:${server.address().port}`;
async function call(m, p, body, tok) {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const texto = await r.text(); let j = {}; try { j = JSON.parse(texto); } catch (e) {  }
  return { s: r.status, j, texto };
}
const q = async (sql, p) => (await db.query(sql, p)).rows;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const R = Date.now();
const correos = [];

(async () => {
  const ids = [];
  mail.reemplazar({ nombre: 'prueba', async enviar(m) { correos.push(m); } });
  try {
    const c1 = `rec${R}@prueba.test`, c2 = `rec2${R}@prueba.test`;
    const reg = async (correo, nombre) => { const r = await call('POST', '/api/auth/register', { nombre, correo, password: 'vieja1234' }); ids.push(r.j.usuario.id); return r.j; };
    const u1 = await reg(c1, 'Cliente <b>Recupera</b>'), u2 = await reg(c2, 'Cliente Inactivo');
    await db.query('UPDATE usuarios SET activo=false WHERE id=$1', [u2.usuario.id]);
    const MENSAJE = 'Si el correo está registrado';

    let r = await call('POST', '/api/auth/olvide', { correo: 'no-es-correo' });
    t('olvide: un correo mal escrito → 400', r.s === 400);
    r = await call('POST', '/api/auth/olvide', { correo: `nadie${R}@prueba.test` }); const sinCuenta = r;
    await espera(100);
    t('olvide: correo sin cuenta → 200 con el mismo mensaje y sin enviar nada', r.s === 200 && r.j.ok && r.j.mensaje.startsWith(MENSAJE) && correos.length === 0);
    r = await call('POST', '/api/auth/olvide', { correo: c1.toUpperCase() }); await espera(150);
    t('olvide: correo con cuenta → 200 y el MISMO mensaje que sin cuenta', r.s === 200 && r.j.mensaje === sinCuenta.j.mensaje && r.texto === sinCuenta.texto);
    const m1 = correos[0];
    t('se envió un correo al cliente con enlace de un solo código de 64 caracteres', correos.length === 1 && m1.a === c1 && /\/\?reset=[0-9a-f]{64}(\s|$)/.test(m1.texto) && /Restablece tu contraseña/.test(m1.asunto));
    const tok1 = (m1.texto.match(/reset=([0-9a-f]{64})/) || [])[1];
    t('el correo no revela la contraseña y escapa el nombre en HTML', !/vieja1234/.test(m1.texto + m1.html) && !/<b>Recupera/.test(m1.html) && /&lt;b&gt;Recupera/.test(m1.html));
    const filas = await q('SELECT token_hash, expira_en > now() AS vigente, expira_en < now() + interval \'61 minutes\' AS en_una_hora FROM recuperaciones_password WHERE usuario_id=$1', [u1.usuario.id]);
    t('en la base solo se guarda el hash del código (nunca el código) y vence en 1 hora', filas.length === 1 && filas[0].token_hash === crypto.createHash('sha256').update(tok1).digest('hex') && filas[0].token_hash !== tok1 && filas[0].vigente && filas[0].en_una_hora);
    r = await call('POST', '/api/auth/olvide', { correo: c1 }); await espera(150);
    const tok2 = (correos[1].texto.match(/reset=([0-9a-f]{64})/) || [])[1];
    t('una nueva solicitud genera otro enlace distinto', correos.length === 2 && tok2 && tok2 !== tok1);
    r = await call('POST', '/api/auth/restablecer', { token: tok1, nueva: 'nueva12345' });
    t('el enlace anterior deja de funcionar al pedir uno nuevo', r.s === 400 && /venció|usó/.test(r.j.error));
    const antes = correos.length;
    r = await call('POST', '/api/auth/olvide', { correo: c2 }); await espera(150);
    t('una cuenta desactivada recibe la misma respuesta pero no se le envía nada', r.s === 200 && r.j.mensaje === sinCuenta.j.mensaje && correos.length === antes);
    await db.query("INSERT INTO recuperaciones_password(usuario_id,token_hash,expira_en,usado_en) SELECT $1, md5(random()::text)||md5(random()::text), now()+interval '1 hour', now() FROM generate_series(1,3)", [u1.usuario.id]);
    r = await call('POST', '/api/auth/olvide', { correo: c1 }); await espera(150);
    t('tope de 3 enlaces por hora y por cuenta: el cuarto no se envía (y sigue respondiendo igual)', r.s === 200 && r.j.mensaje === sinCuenta.j.mensaje && correos.length === antes);
    await db.query('DELETE FROM recuperaciones_password WHERE usuario_id=$1 AND usado_en IS NOT NULL AND token_hash <> $2', [u1.usuario.id, crypto.createHash('sha256').update(tok1).digest('hex')]);

    r = await call('POST', '/api/auth/restablecer', { token: 'abc', nueva: 'nueva12345' }); t('restablecer: código con formato inválido → 400', r.s === 400 && /no es válido/.test(r.j.error));
    r = await call('POST', '/api/auth/restablecer', { token: 'f'.repeat(64), nueva: 'nueva12345' }); t('restablecer: código inventado → 400', r.s === 400);
    r = await call('POST', '/api/auth/restablecer', { token: tok2, nueva: 'corta' }); t('restablecer: contraseña corta → 400 y el enlace NO se gasta', r.s === 400 && (await q('SELECT 1 FROM recuperaciones_password WHERE token_hash=$1 AND usado_en IS NULL', [crypto.createHash('sha256').update(tok2).digest('hex')])).length === 1);
    r = await call('POST', '/api/auth/restablecer', { token: tok2, nueva: 'x'.repeat(73) }); t('restablecer: contraseña de más de 72 caracteres → 400', r.s === 400);
    await db.query("UPDATE recuperaciones_password SET expira_en = now() - interval '1 minute' WHERE token_hash=$1", [crypto.createHash('sha256').update(tok2).digest('hex')]);
    r = await call('POST', '/api/auth/restablecer', { token: tok2, nueva: 'nueva12345' }); t('restablecer: un enlace vencido → 400', r.s === 400 && /venció/.test(r.j.error));
    await db.query("UPDATE recuperaciones_password SET expira_en = now() + interval '1 hour' WHERE token_hash=$1", [crypto.createHash('sha256').update(tok2).digest('hex')]);
    const sesionVieja = u1.token;
    t('antes del cambio, la sesión vieja funciona', (await call('GET', '/api/auth/me', undefined, sesionVieja)).s === 200);
    r = await call('POST', '/api/auth/restablecer', { token: tok2, nueva: 'nueva12345' });
    t('restablecer con un enlace válido → 200', r.s === 200 && r.j.ok);
    t('entrar con la contraseña NUEVA funciona', (await call('POST', '/api/auth/login', { correo: c1, password: 'nueva12345' })).s === 200);
    t('entrar con la contraseña VIEJA ya no funciona', (await call('POST', '/api/auth/login', { correo: c1, password: 'vieja1234' })).s === 401);
    t('las sesiones abiertas antes quedan cerradas', (await call('GET', '/api/auth/me', undefined, sesionVieja)).s === 401);
    r = await call('POST', '/api/auth/restablecer', { token: tok2, nueva: 'otra123456' }); t('el enlace sirve una sola vez', r.s === 400 && /usó/.test(r.j.error));
    t('con el segundo intento la contraseña no cambió', (await call('POST', '/api/auth/login', { correo: c1, password: 'nueva12345' })).s === 200);
    const tokC = crypto.randomBytes(32).toString('hex');
    await db.query("INSERT INTO recuperaciones_password(usuario_id,token_hash,expira_en) VALUES($1,$2,now()+interval '1 hour')", [u1.usuario.id, crypto.createHash('sha256').update(tokC).digest('hex')]);
    const dos = await Promise.all([call('POST', '/api/auth/restablecer', { token: tokC, nueva: 'carrera11111' }), call('POST', '/api/auth/restablecer', { token: tokC, nueva: 'carrera22222' })]);
    t('si el mismo enlace se usa dos veces a la vez, solo una gana', dos.filter((x) => x.s === 200).length === 1 && dos.filter((x) => x.s === 400).length === 1, dos.map((x) => x.s).join());
    r = await call('POST', '/api/auth/restablecer', { token: "' OR 1=1 --", nueva: 'nueva12345' }); t('un código con comillas se rechaza sin tocar la base', r.s === 400);
    r = await call('POST', '/api/auth/olvide', { correo: "a'; DROP TABLE usuarios;--@x.com" }); t('un correo con inyección SQL se rechaza (400) y la tabla sigue', r.s === 400 && (await q('SELECT count(*)::int AS n FROM usuarios'))[0].n > 0);
    let ultimo = null; for (let i = 0; i < 2; i++) ultimo = await call('POST', '/api/auth/olvide', { correo: c1 });
    t('después de varias solicitudes seguidas, el sistema bloquea por un rato (429)', ultimo.s === 429 && /Demasiados intentos/.test(ultimo.j.error), ultimo.s);

    {
      const http = require('http'), { spawnSync } = require('child_process');
      const recibidos = []; let modo = 'ok';
      const web = http.createServer((rq, rs) => { let b = ''; rq.on('data', (d) => (b += d)); rq.on('end', () => { recibidos.push({ url: rq.url, key: rq.headers['api-key'], ct: rq.headers['content-type'], body: JSON.parse(b || '{}') }); if (modo === 'error') { rs.writeHead(401, { 'Content-Type': 'application/json' }); rs.end('{"message":"Key not found"}'); } else { rs.writeHead(201, { 'Content-Type': 'application/json' }); rs.end('{"messageId":"<x@y>"}'); } }); });
      await new Promise((ok) => web.listen(0, '127.0.0.1', ok));
      const brevo = require('../src/mail/brevo');
      Object.assign(process.env, { BREVO_API_KEY: 'xkeysib-prueba', MAIL_FROM: '"EN COMBO" <avisos@ejemplo.com>', MAIL_API_URL: `http://127.0.0.1:${web.address().port}/v3/smtp/email` });
      await brevo.enviar({ a: 'cli@ejemplo.com', asunto: 'Hola', texto: 'Texto', html: '<p>Hola</p>', responderA: 'admin@ejemplo.com' });
      const x = recibidos[0];
      t('Brevo: manda la llave en el encabezado api-key y el contenido en JSON', x.key === 'xkeysib-prueba' && /json/.test(x.ct) && x.url === '/v3/smtp/email');
      t('Brevo: remitente (nombre y correo), destinatario, asunto, texto y HTML correctos', x.body.sender.name === 'EN COMBO' && x.body.sender.email === 'avisos@ejemplo.com' && x.body.to[0].email === 'cli@ejemplo.com' && x.body.subject === 'Hola' && x.body.textContent === 'Texto' && x.body.htmlContent === '<p>Hola</p>');
      t('Brevo: el administrador queda como responder-a', x.body.replyTo.email === 'admin@ejemplo.com');
      t('Brevo: acepta MAIL_FROM sin nombre, con nombre sin comillas y con espacios', JSON.stringify(brevo.remitente('avisos@ejemplo.com')) === '{"email":"avisos@ejemplo.com"}' && brevo.remitente('EN COMBO <a@b.co>').name === 'EN COMBO' && brevo.remitente('  Tienda Ñandú  <a@b.co> ').email === 'a@b.co');
      modo = 'error';
      const fallo = await brevo.enviar({ a: 'cli@ejemplo.com', asunto: 'Hola', texto: 'Texto' }).then(() => null, (e) => e.message);
      t('Brevo: si responde error (llave mala) falla con el motivo y sin mostrar la llave', /401/.test(fallo || '') && /Key not found/.test(fallo) && !/xkeysib/.test(fallo));
      mail.reemplazar(null); process.env.MAIL_PROVIDER = 'brevo'; t('MAIL_PROVIDER=brevo selecciona el módulo de Brevo', mail.obtener().nombre === 'brevo'); process.env.MAIL_PROVIDER = 'consola';
      const arranca = (env) => spawnSync(process.execPath, ['-e', "require('./src/config')"], { cwd: require('path').join(__dirname, '..'), env: { PATH: process.env.PATH, JWT_SECRET: process.env.JWT_SECRET, DATABASE_URL: process.env.DATABASE_URL, ...env }, encoding: 'utf8' });
      let a = arranca({ MAIL_PROVIDER: 'brevo', MAIL_FROM: 'a@b.co' }); t('brevo sin llave: se niega a arrancar y lo explica', a.status !== 0 && /BREVO_API_KEY/.test(a.stderr));
      a = arranca({ MAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'k' }); t('brevo sin remitente (MAIL_FROM): se niega a arrancar', a.status !== 0 && /MAIL_FROM/.test(a.stderr));
      a = arranca({ MAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'k', MAIL_FROM: 'a@b.co', NODE_ENV: 'production', PAYMENT_PROVIDER: 'simulado', MODO_DEMO: 'true' }); t('brevo con llave y remitente en producción (modo demostración): arranca', a.status === 0, a.stderr);
      delete process.env.MAIL_API_URL; delete process.env.BREVO_API_KEY; delete process.env.MAIL_FROM; web.close();
    }
    t('el administrador sigue pudiendo restablecer contraseñas desde Usuarios (ruta existente)', require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'routes', 'admin.js'), 'utf8').includes("'/usuarios/:id/password'"));
    const pkg = require('../package.json'), lock = require('../package-lock.json');
    const v = (n) => (lock.packages['node_modules/' + n] || {}).version;
    const mayorQue = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] > y[i]; } return true; };
    t('dependencias corregidas: body-parser ≥ 1.20.9, qs ≥ 6.16.1, nodemailer ≥ 10.1.4', mayorQue(v('body-parser'), '1.20.9') && mayorQue(v('qs'), '6.16.1') && mayorQue(v('nodemailer'), '10.1.4'), [v('body-parser'), v('qs'), v('nodemailer')].join(' '));
    t('el package.json ya no pide versiones con fallas conocidas', !!pkg.dependencies.express);
  } catch (e) { fail++; console.log('FAIL error inesperado', e); }
  finally {
    try { await db.query('DELETE FROM usuarios WHERE id = ANY($1)', [ids]); } catch (e) { console.log('Aviso: limpieza incompleta:', e.message); }
    server.close(); console.log(`\n${pass} correctas, ${fail} fallidas`); await db.pool.end(); process.exit(fail ? 1 : 0);
  }
})();

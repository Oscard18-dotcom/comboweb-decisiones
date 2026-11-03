// Revisión previa a publicar el sistema. Muestra qué está bien (✔), qué conviene revisar (⚠) y qué debe corregirse (✖).
//   NODE_ENV=production npm run verificar        (con tus variables de producción)
// Termina con código 1 si hay algún ✖.
const res = [];
const marca = { ok: '✔', aviso: '⚠', fallo: '✖' };
const chk = (nivel, texto, detalle = '') => res.push({ nivel, texto, detalle });
(async () => {
  let db = null;
  try { require('../src/config'); chk('ok', 'La configuración (.env) es válida'); }
  catch (e) { chk('fallo', 'Configuración inválida', e.message); }
  const env = process.env, prod = env.NODE_ENV === 'production';
  chk(prod ? 'ok' : 'aviso', prod ? 'NODE_ENV=production' : 'NODE_ENV no es "production" (en el servidor real debe serlo)');
  const jwt = env.JWT_SECRET || '';
  if (jwt.length < 32) chk('fallo', 'JWT_SECRET', 'Debe tener al menos 32 caracteres aleatorios');
  else if (new Set(jwt).size < 10) chk('fallo', 'JWT_SECRET demasiado simple', 'Genera uno con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  else chk('ok', 'JWT_SECRET es largo y variado');
  const publica = env.PUBLIC_URL || '';
  if (!publica) chk('fallo', 'PUBLIC_URL', 'Define la dirección pública del sitio (con https://)');
  else if (!publica.startsWith('https://')) chk(prod ? 'fallo' : 'aviso', 'PUBLIC_URL no usa https://', publica);
  else chk('ok', 'PUBLIC_URL usa https', publica);
  if (env.PAYMENT_PROVIDER === 'stripe') {
    if ((env.STRIPE_SECRET_KEY || '').startsWith('sk_live_')) chk('ok', 'Stripe en modo REAL (sk_live_)');
    else chk('aviso', 'Stripe está con llaves de PRUEBA', 'Los pagos no son reales. Para cobrar de verdad usa la llave sk_live_ y su webhook');
  } else if (env.MODO_DEMO === 'true') chk('aviso', 'MODO DEMOSTRACIÓN: el pago es simulado', 'Nadie puede pagar de verdad. Para vender, configura Stripe y quita MODO_DEMO');
  else chk(prod ? 'fallo' : 'aviso', 'PAYMENT_PROVIDER no es "stripe"', 'El pago simulado no cobra nada');
  if (!env.MAIL_PROVIDER || env.MAIL_PROVIDER === 'consola') chk(prod && env.MODO_DEMO !== 'true' ? 'fallo' : 'aviso', 'MAIL_PROVIDER=consola', 'Los clientes no recibirían sus avisos');
  else chk('ok', `Correo configurado (${env.MAIL_PROVIDER})`);
  chk(env.TRUST_PROXY ? 'ok' : 'aviso', env.TRUST_PROXY ? 'TRUST_PROXY definido' : 'TRUST_PROXY no está definido', env.TRUST_PROXY ? '' : 'Detrás de Render, Railway, etc. ponlo en 1 para que el límite de intentos funcione por cliente');
  try {
    db = require('../src/db');
    await db.query('SELECT 1');
    chk('ok', 'Conexión a la base de datos');
    const host = (env.DATABASE_URL || '').split('@')[1] || '';
    if (env.DATABASE_SSL !== 'true' && !/^(localhost|127\.0\.0\.1)/.test(host)) chk('aviso', 'DATABASE_SSL no es "true"', 'Si la base está en otro servidor, la conexión debe ir cifrada');
    const tablas = ['usuarios', 'productos', 'insumos', 'recetas', 'pedidos', 'checkouts', 'notificaciones', 'pedido_estatus_historial'];
    const { rows } = await db.query('SELECT table_name FROM information_schema.tables WHERE table_schema=$1', ['public']);
    const faltan = tablas.filter((x) => !rows.some((r) => r.table_name === x));
    const col = await db.query("SELECT 1 FROM information_schema.columns WHERE table_name='usuarios' AND column_name='token_version'");
    if (faltan.length || !col.rows[0]) chk('fallo', 'Faltan tablas o columnas', `${faltan.join(', ')}${col.rows[0] ? '' : ' (usuarios.token_version)'} → ejecuta: npm run db:init`);
    else chk('ok', 'El esquema de la base de datos está al día');
    if (!faltan.length) {
      const adm = (await db.query("SELECT count(*)::int n FROM usuarios WHERE rol='admin' AND activo")).rows[0].n;
      adm ? chk('ok', `Hay ${adm} administrador(es) activo(s)`) : chk('fallo', 'No hay ningún administrador activo', 'Crea uno con: npm run crear-admin');
      const prueba = (await db.query("SELECT count(*)::int n FROM usuarios WHERE activo AND correo LIKE '%@encombo.test'")).rows[0].n;
      prueba ? chk('aviso', `Hay ${prueba} cuenta(s) de prueba activa(s) (@encombo.test)`, 'Desactívalas en Usuarios o cámbiales la contraseña antes de abrir el sistema al público') : chk('ok', 'No hay cuentas de prueba activas');
      const cat = (await db.query("SELECT count(*)::int n FROM productos p WHERE p.activo AND EXISTS (SELECT 1 FROM recetas r WHERE r.producto_id=p.id)")).rows[0].n;
      cat ? chk('ok', `Catálogo: ${cat} producto(s) activo(s) con receta`) : chk('fallo', 'No hay productos activos con receta', 'Los clientes no podrían comprar nada');
      const pres = (await db.query('SELECT count(*)::int n FROM presentaciones WHERE activo')).rows[0].n;
      pres ? chk('ok', `${pres} presentación(es) activa(s)`) : chk('fallo', 'No hay presentaciones activas');
    }
  } catch (e) { chk('fallo', 'No se pudo revisar la base de datos', e.message); }
  for (const r of res) console.log(`${marca[r.nivel]} ${r.texto}${r.detalle ? ' — ' + r.detalle : ''}`);
  const f = res.filter((r) => r.nivel === 'fallo').length, a = res.filter((r) => r.nivel === 'aviso').length;
  console.log(`\n${f ? '✖ NO está listo' : '✔ Listo'} para publicar: ${f} problema(s) por corregir, ${a} aviso(s).`);
  if (db) await db.pool.end().catch(() => {});
  process.exit(f ? 1 : 0);
})();

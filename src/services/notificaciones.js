const db = require('../db');
const mail = require('../mail');
const direccion = require('./direccion');

const MAX_INTENTOS = 5;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const base = () => process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
const folio = (id) => (id == null ? '' : 'EC-' + String(id).padStart(4, '0'));
const folioPP = (id) => 'PP-' + String(id).padStart(4, '0');
const EMPRESA = () => process.env.EMPRESA_NOMBRE || 'EN COMBO';
// Cantidad legible: sin ceros sobrantes (2.5, 1,500)
const humano = (n) => Number(n).toLocaleString('es-MX', { maximumFractionDigits: 4 });

// Textos de cada aviso. El asunto solo lleva el folio (nada que escriba el usuario).
const TEXTOS = {
  'confirmacion': (f) => [`Pedido ${f} confirmado`, 'Recibimos tu pago y tu pedido quedó registrado.'],
  'En preparación': (f) => [`Tu pedido ${f} está en preparación`, 'Ya estamos preparando tu pedido.'],
  'Listo para entrega': (f) => [`Tu pedido ${f} está listo para entrega`, 'Tu pedido está listo. ¡Ya puedes recibirlo o recogerlo!'],
  'Entregado': (f) => [`Tu pedido ${f} fue entregado`, 'Tu pedido fue entregado. ¡Gracias por elegir EN COMBO!'],
};
function redactar(tipo, p) {
  const f = folio(p.id), [asunto, linea] = TEXTOS[tipo](f);
  const dir = direccion.texto(direccion.desdeFila(p));
  const texto = `Hola ${p.nombre},\n\n${linea}\n\nPedido: ${f}\nEntrega: ${p.fecha} a las ${p.hora} h${dir ? '\nDirección: ' + dir : ''}\n\nPuedes ver el estado de tu pedido en ${base()}\n\nEN COMBO`;
  const html = `<p>Hola ${esc(p.nombre)},</p><p>${esc(linea)}</p><p><b>Pedido:</b> ${f}<br><b>Entrega:</b> ${esc(p.fecha)} a las ${esc(p.hora)} h${dir ? '<br><b>Dirección:</b> ' + esc(dir) : ''}</p>`
    + `<p><a href="${esc(base())}">Ver el estado de mi pedido</a></p><p>EN COMBO</p>`;
  return { asunto, texto, html };
}

// Se llama DENTRO de la transacción del cambio de estatus (q = la conexión de esa transacción)
async function encolar(q, pedidoId, tipo) {
  const { rows } = await q.query(
    `SELECT p.id,p.cliente_id,p.fecha_entrega::text AS fecha,left(p.hora_entrega::text,5) AS hora,u.nombre,u.correo,${direccion.COLS}
       FROM pedidos p JOIN usuarios u ON u.id=p.cliente_id WHERE p.id=$1`, [pedidoId]);
  if (!rows[0]) return;
  const m = redactar(tipo, rows[0]);
  await q.query(
    `INSERT INTO notificaciones(pedido_id,cliente_id,plantilla,destinatario,asunto,cuerpo_texto,cuerpo_html)
     VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (pedido_id, plantilla) DO NOTHING`,
    [pedidoId, rows[0].cliente_id, tipo, rows[0].correo, m.asunto, m.texto, m.html]);
}

// Reclama filas de forma atómica (SKIP LOCKED): dos procesos nunca envían el mismo correo.
// También rescata las que quedaron "enviando" por más de 5 minutos (el servidor se cayó a media tarea).
async function enviarPendientes({ limite = 20 } = {}) {
  const { rows } = await db.query(
    `UPDATE notificaciones SET estado='enviando', intentos=intentos+1, reclamado_en=now()
      WHERE id IN (SELECT id FROM notificaciones
                    WHERE ((estado IN ('pendiente','error') AND (proximo_intento IS NULL OR proximo_intento <= now()))
                        OR (estado='enviando' AND reclamado_en < now() - interval '5 minutes'))
                      AND intentos < $2
                    ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
      RETURNING *`, [limite, MAX_INTENTOS]);
  let enviadas = 0, errores = 0;
  for (const n of rows) {
    try {
      await mail.obtener().enviar({ a: n.destinatario, asunto: n.asunto, texto: n.cuerpo_texto, html: n.cuerpo_html, responderA: n.responder_a || undefined });
      await db.query("UPDATE notificaciones SET estado='enviada', enviada_en=now(), ultimo_error=NULL WHERE id=$1", [n.id]);
      enviadas++;
    } catch (e) {
      errores++;
      // Reintentos con espera creciente: 1, 4, 9 y 16 minutos; al quinto fallo queda "fallida" (el administrador puede reintentarla)
      await db.query(
        `UPDATE notificaciones SET estado=$2, ultimo_error=$3, proximo_intento = now() + make_interval(mins => $4) WHERE id=$1`,
        [n.id, n.intentos >= MAX_INTENTOS ? 'fallida' : 'error', String(e.message || e).slice(0, 300), n.intentos * n.intentos]);
    }
  }
  return { enviadas, errores };
}
// Disparo sin esperar: un fallo de correo NUNCA debe romper el pago ni el cambio de estatus
const disparar = () => enviarPendientes().catch((e) => console.error('Error al enviar notificaciones:', e.message));

function iniciarTrabajo(cadaMs = 60000) {
  disparar();
  return setInterval(disparar, cadaMs).unref();
}

// ---- Pedidos a proveedor: correo al proveedor pidiendo cada insumo con su cantidad ----
// Dentro de la transacción del pedido (q = esa conexión). tipo: 'pedido' | 'cancelacion'. responderA = correo del administrador.
async function encolarProveedor(q, pedidoId, tipo, responderA) {
  const { rows } = await q.query(
    `SELECT pp.id,pp.nota,pp.fecha_requerida::text AS fecha,pr.nombre AS proveedor,pr.correo,pr.contacto
       FROM pedidos_proveedor pp JOIN proveedores pr ON pr.id=pp.proveedor_id WHERE pp.id=$1`, [pedidoId]);
  if (!rows[0]) return;
  const p = rows[0];
  const items = (await q.query(
    `SELECT i.nombre,i.unidad,it.cantidad FROM pedido_proveedor_items it JOIN insumos i ON i.id=it.insumo_id WHERE it.pedido_id=$1 ORDER BY i.nombre`, [pedidoId])).rows;
  const f = folioPP(p.id), emp = EMPRESA();
  const saludo = p.contacto ? `Hola ${p.contacto}` : `Hola, equipo de ${p.proveedor}`;
  const lineas = items.map((i) => `- ${i.nombre}: ${humano(i.cantidad)} ${i.unidad}`);
  let asunto, intro, cierre;
  if (tipo === 'cancelacion') {
    asunto = `Cancelación del pedido ${f} - ${emp}`;
    intro = `Te escribimos para CANCELAR el pedido ${f} que te enviamos antes. Por favor no lo surtas. Disculpa la molestia.`;
    cierre = 'Era este pedido:';
  } else {
    asunto = `Pedido ${f} de ${emp}`;
    intro = 'Te solicitamos los siguientes insumos:';
    cierre = '';
  }
  const extra = [p.fecha ? `Fecha en que los necesitamos: ${p.fecha}` : '', p.nota ? `Nota: ${p.nota}` : ''].filter(Boolean);
  const texto = [`${saludo},`, '', intro, ...(cierre ? [cierre] : []), '', ...lineas, '', ...extra, ...(extra.length ? [''] : []),
    'Por favor confirma la recepción de este pedido respondiendo a este correo.', '', 'Gracias,', emp].join('\n');
  const htmlItems = items.map((i) => `<tr><td style="padding:4px 12px;border-bottom:1px solid #E0D0C0">${esc(i.nombre)}</td><td style="padding:4px 12px;border-bottom:1px solid #E0D0C0;text-align:right"><b>${esc(humano(i.cantidad))}</b> ${esc(i.unidad)}</td></tr>`).join('');
  const html = `<div style="font-family:Arial,sans-serif;color:#33170C"><p>${esc(saludo)},</p><p>${esc(intro)}</p>${cierre ? `<p>${esc(cierre)}</p>` : ''}`
    + `<table style="border-collapse:collapse;background:#F8F0E5"><tr><th style="padding:4px 12px;text-align:left">Insumo</th><th style="padding:4px 12px;text-align:right">Cantidad</th></tr>${htmlItems}</table>`
    + (extra.length ? `<p>${extra.map(esc).join('<br>')}</p>` : '')
    + `<p>Por favor confirma la recepción de este pedido respondiendo a este correo.</p><p>Gracias,<br>${esc(emp)}</p></div>`;
  await q.query(
    `INSERT INTO notificaciones(pedido_proveedor_id,plantilla,destinatario,asunto,cuerpo_texto,cuerpo_html,responder_a)
     VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (pedido_proveedor_id, plantilla) WHERE pedido_proveedor_id IS NOT NULL DO NOTHING`,
    [pedidoId, tipo, p.correo, asunto, texto, html, responderA || null]);
}

// Texto corto para la bandeja del cliente dentro de la página (el mismo mensaje del correo)
const mensajeAviso = (plantilla, f) => (TEXTOS[plantilla] ? TEXTOS[plantilla](f)[1] : null);

module.exports = { mensajeAviso, encolar, encolarProveedor, enviarPendientes, disparar, iniciarTrabajo, MAX_INTENTOS, folio, folioPP };

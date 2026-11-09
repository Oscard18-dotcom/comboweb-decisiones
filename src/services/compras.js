const db = require('../db');
const notif = require('./notificaciones');
const { todayMX } = require('./pedidos');

const folioPP = notif.folioPP;
const err = (status, msg) => Object.assign(new Error(msg), { status, publico: msg });

const cant4 = (v) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 1e7 && Math.abs(n * 1e4 - Math.round(n * 1e4)) < 1e-6 ? Math.round(n * 1e4) / 1e4 : null;
};

async function aplicarStock(c, pedidoId, usuarioId) {
  const { rows } = await c.query(
    `SELECT it.insumo_id,it.cantidad,pr.nombre AS proveedor FROM pedido_proveedor_items it
       JOIN pedidos_proveedor pp ON pp.id=it.pedido_id JOIN proveedores pr ON pr.id=pp.proveedor_id WHERE it.pedido_id=$1 ORDER BY it.insumo_id`, [pedidoId]);
  for (const it of rows) {
    await c.query('UPDATE insumos SET stock = stock + $2 WHERE id=$1', [it.insumo_id, it.cantidad]);
    await c.query("INSERT INTO movimientos_inventario(insumo_id,tipo,cantidad,nota,usuario_id,pedido_proveedor_id) VALUES($1,'entrada',$2,$3,$4,$5)",
      [it.insumo_id, it.cantidad, `Pedido a proveedor ${folioPP(pedidoId)} (${rows[0].proveedor})`.slice(0, 200), usuarioId, pedidoId]);
  }
  await c.query('UPDATE pedidos_proveedor SET stock_aplicado=true WHERE id=$1', [pedidoId]);
}

async function detalle(q, id) {
  const { rows } = await q.query(
    `SELECT pp.id,pp.estado,pp.suma_stock_en,pp.stock_aplicado,pp.nota,pp.fecha_requerida::text AS fecha_requerida,pp.creado_en,pp.recibido_en,
            pp.proveedor_id,pr.nombre AS proveedor,pr.correo AS proveedor_correo,u.nombre AS usuario,
            (SELECT n.estado FROM notificaciones n WHERE n.pedido_proveedor_id=pp.id AND n.plantilla='pedido') AS correo_estado
       FROM pedidos_proveedor pp JOIN proveedores pr ON pr.id=pp.proveedor_id LEFT JOIN usuarios u ON u.id=pp.usuario_id WHERE pp.id=$1`, [id]);
  if (!rows[0]) return null;
  const items = (await q.query(
    `SELECT i.id AS insumo_id,i.nombre,i.unidad,it.cantidad FROM pedido_proveedor_items it JOIN insumos i ON i.id=it.insumo_id WHERE it.pedido_id=$1 ORDER BY i.nombre`, [id])).rows;
  return { ...rows[0], folio: folioPP(id), items: items.map((i) => ({ ...i, cantidad: Number(i.cantidad) })) };
}

async function lista(estado) {
  const { rows } = await db.query(
    `SELECT pp.id FROM pedidos_proveedor pp WHERE ($1::text IS NULL OR pp.estado=$1) ORDER BY pp.id DESC LIMIT 100`, [estado]);
  const out = [];
  for (const r of rows) out.push(await detalle(db, r.id));
  return out;
}

async function crear(user, b) {
  b = b || {};
  const provId = Number.parseInt(b.proveedor_id, 10);
  if (!Number.isInteger(provId) || provId <= 0) throw err(400, 'Elige un proveedor.');
  if (!Array.isArray(b.items) || b.items.length < 1) throw err(400, 'Agrega al menos un insumo al pedido.');
  if (b.items.length > 30) throw err(400, 'Un pedido puede llevar máximo 30 insumos.');
  const vistos = new Set(), items = [];
  for (const it of b.items) {
    const id = Number.parseInt(it && it.insumo_id, 10), cant = cant4(it && it.cantidad);
    if (!Number.isInteger(id) || id <= 0) throw err(400, 'Hay un insumo inválido en el pedido.');
    if (cant === null) throw err(400, 'Cada cantidad debe ser un número mayor a 0 (máximo 4 decimales).');
    if (vistos.has(id)) throw err(400, 'Un insumo está repetido en el pedido: súmalo en una sola línea.');
    vistos.add(id); items.push({ id, cant });
  }
  const nota = b.nota == null || b.nota === '' ? null : String(b.nota).trim();
  if (nota !== null && nota.length > 300) throw err(400, 'La nota es muy larga (máximo 300 caracteres).');
  let fecha = null;
  if (b.fecha_requerida != null && b.fecha_requerida !== '') {
    if (typeof b.fecha_requerida !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.fecha_requerida) || Number.isNaN(Date.parse(b.fecha_requerida))) throw err(400, 'La fecha debe tener el formato AAAA-MM-DD.');
    if (b.fecha_requerida < todayMX()) throw err(400, 'La fecha en que necesitas los insumos no puede ser anterior a hoy.');
    fecha = b.fecha_requerida;
  }
  const suma = b.suma_stock_en === undefined ? 'envio' : b.suma_stock_en;
  if (!['envio', 'recepcion'].includes(suma)) throw err(400, 'Elige cuándo se suma al stock: al enviar o al recibir.');

  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    const prov = (await c.query('SELECT id,activo FROM proveedores WHERE id=$1', [provId])).rows[0];
    if (!prov) throw err(404, 'Proveedor no encontrado.');
    if (!prov.activo) throw err(409, 'Ese proveedor está archivado. Reactívalo para pedirle.');
    const ins = (await c.query('SELECT id,activo FROM insumos WHERE id = ANY($1::int[])', [items.map((i) => i.id)])).rows;
    if (ins.length !== items.length) throw err(400, 'Hay un insumo que no existe.');
    if (ins.some((i) => !i.activo)) throw err(409, 'Hay un insumo archivado en el pedido.');
    const pp = (await c.query(
      'INSERT INTO pedidos_proveedor(proveedor_id,usuario_id,suma_stock_en,nota,fecha_requerida) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [provId, user.id, suma, nota, fecha])).rows[0];
    for (const it of items) await c.query('INSERT INTO pedido_proveedor_items(pedido_id,insumo_id,cantidad) VALUES($1,$2,$3)', [pp.id, it.id, it.cant]);
    await notif.encolarProveedor(c, pp.id, 'pedido', user.correo);
    if (suma === 'envio') await aplicarStock(c, pp.id, user.id);
    await c.query('COMMIT');
    notif.disparar();
    return await detalle(c, pp.id);
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

async function recibir(id, user) {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    const pp = (await c.query('SELECT id,estado,stock_aplicado FROM pedidos_proveedor WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!pp) throw err(404, 'Pedido no encontrado.');
    if (pp.estado === 'cancelado') throw err(409, 'Ese pedido está cancelado.');
    if (pp.estado === 'enviado') {
      if (!pp.stock_aplicado) await aplicarStock(c, id, user.id);
      await c.query("UPDATE pedidos_proveedor SET estado='recibido', recibido_en=now() WHERE id=$1", [id]);
    }
    await c.query('COMMIT');
    return await detalle(c, id);
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

async function cancelar(id, user) {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    const pp = (await c.query('SELECT id,estado,stock_aplicado FROM pedidos_proveedor WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!pp) throw err(404, 'Pedido no encontrado.');
    if (pp.estado === 'cancelado') { await c.query('COMMIT'); return await detalle(c, id); }
    if (pp.estado === 'recibido') throw err(409, 'Ese pedido ya fue recibido: no se puede cancelar.');
    if (pp.stock_aplicado) throw err(409, 'A este pedido ya se le sumó el stock al enviarlo. Si hubo un error, corrige las existencias con una salida o un ajuste en Inventario.');
    await c.query("UPDATE pedidos_proveedor SET estado='cancelado' WHERE id=$1", [id]);
    await notif.encolarProveedor(c, id, 'cancelacion', user.correo);
    await c.query('COMMIT');
    notif.disparar();
    return await detalle(c, id);
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

module.exports = { crear, recibir, cancelar, lista, detalle, folioPP, err };

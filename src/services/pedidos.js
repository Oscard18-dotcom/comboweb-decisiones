const db = require('../db');
const notif = require('./notificaciones');
const direccion = require('./direccion');

const HORAS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
const CAPACIDAD = () => Number(process.env.SLOT_CAPACITY || 2); // pedidos máximos por horario
const DIAS_MIN = () => Number(process.env.MIN_DAYS_AHEAD || 1);  // anticipación mínima
const DIAS_MAX = 90;
const cents = (v) => Math.round(Number(v) * 100);

/* ---------- Fechas (zona horaria de México) ---------- */
const todayMX = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fechaValida = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T12:00:00Z')) && addDays(s, 0) === s;

/* ---------- Horarios ---------- */
async function horarios(q, fecha) {
  const { rows } = await q.query(
    'SELECT left(hora_entrega::text,5) AS h, count(*)::int AS n FROM pedidos WHERE fecha_entrega=$1 GROUP BY 1', [fecha]);
  const ocupados = Object.fromEntries(rows.map((r) => [r.h, r.n]));
  return HORAS.map((hora) => ({ hora, disponible: (ocupados[hora] || 0) < CAPACIDAD() }));
}

/* ---------- Insumos que consume un combo ---------- */
async function requeridos(q, items, insumoCaja) {
  const ids = [...items.keys()], cants = ids.map((i) => items.get(i));
  // Consumo por pieza = cantidad de la receta / rinde. Se suma y se redondea hacia arriba a 4 decimales, todo en SQL (numérico exacto)
  const { rows } = await q.query(
    `SELECT ri.insumo_id, ceil(sum(ri.cantidad / r.rinde * x.cant) * 10000) / 10000 AS total
       FROM unnest($1::int[], $2::int[]) AS x(pid, cant)
       JOIN recetas r ON r.producto_id = x.pid
       JOIN receta_ingredientes ri ON ri.receta_id = r.id
      GROUP BY ri.insumo_id`, [ids, cants]);
  const conReceta = new Set((await q.query('SELECT producto_id FROM recetas WHERE producto_id = ANY($1)', [ids])).rows.map((r) => r.producto_id));
  const reqs = new Map(rows.map((r) => [r.insumo_id, Number(r.total)]));
  reqs.set(insumoCaja, (reqs.get(insumoCaja) || 0) + 1); // una caja por combo
  return { reqs, sinReceta: ids.filter((i) => !conReceta.has(i)) };
}

/* ---------- Disponibilidad: insumos (ext. 8.a) y horario (ext. 10.a) ---------- */
async function chequear(q, reqs, fecha, hora) {
  const errores = [];
  const { rows } = await q.query('SELECT id,nombre,stock FROM insumos WHERE id = ANY($1) AND activo', [[...reqs.keys()]]);
  const stock = new Map(rows.map((r) => [r.id, r]));
  const faltan = [];
  for (const [id, necesita] of reqs) {
    const s = stock.get(id);
    if (!s || Number(s.stock) < necesita) faltan.push(s ? s.nombre : 'un insumo');
  }
  if (faltan.length)
    errores.push({ campo: 'items', codigo: 'stock_insuficiente', insumos: faltan,
      mensaje: `No hay insumos suficientes para este combo (${faltan.join(', ')}). Modifica el combo o elige otra fecha.` });
  if (fecha && hora) {
    const { rows: [{ n }] } = await q.query('SELECT count(*)::int AS n FROM pedidos WHERE fecha_entrega=$1 AND hora_entrega=$2', [fecha, hora]);
    if (n >= CAPACIDAD()) {
      const alternativas = (await horarios(q, fecha)).filter((h) => h.disponible).map((h) => h.hora);
      errores.push({ campo: 'hora', codigo: 'horario_ocupado', alternativas,
        mensaje: 'Ese horario ya está ocupado. Selecciona otro horario del calendario.' });
    }
  }
  return errores;
}

/* ---------- Validación completa del combo (HU01–HU03). Nunca confía en precios del cliente ---------- */
async function validar(q, b = {}) {
  const errores = [];
  const err = (campo, codigo, mensaje) => errores.push({ campo, codigo, mensaje });

  const items = new Map();
  let itemsOk = false;
  if (!Array.isArray(b.items) || b.items.length === 0) err('items', 'sin_productos', 'Elige al menos un producto.');
  else {
    let malo = false;
    for (const it of b.items) {
      const id = Number(it && it.producto_id), n = Number(it && it.cantidad);
      if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(n) || n < 1) { malo = true; break; }
      items.set(id, (items.get(id) || 0) + n);
    }
    if (malo) err('items', 'item_invalido', 'Cada producto necesita una cantidad entera de 1 o más.');
    else if (items.size > 10 || [...items.values()].some((n) => n > 50))
      err('items', 'cantidad_excedida', 'Máximo 10 productos distintos y 50 piezas de cada uno.');
    else itemsOk = true;
  }

  const presId = Number(b.presentacion_id);
  const presOk = Number.isInteger(presId) && presId > 0;
  if (!presOk) err('presentacion_id', 'presentacion_invalida', 'Elige una presentación.');

  let dedicatoria = null;
  if (b.dedicatoria != null && b.dedicatoria !== '') {
    if (typeof b.dedicatoria !== 'string') err('dedicatoria', 'dedicatoria_invalida', 'La dedicatoria no es válida.');
    else {
      dedicatoria = b.dedicatoria.replace(/[\u0000-\u001F\u007F]/g, ' ').trim() || null;
      if (dedicatoria && dedicatoria.length > 120) err('dedicatoria', 'dedicatoria_larga', 'La dedicatoria no puede pasar de 120 caracteres.');
    }
  }

  const hoy = todayMX();
  let fechaOk = false;
  if (!fechaValida(b.fecha)) err('fecha', 'fecha_invalida', 'Elige una fecha de entrega válida.');
  else if (b.fecha < addDays(hoy, DIAS_MIN())) err('fecha', 'fecha_pasada', `Elige una fecha de entrega a partir del ${addDays(hoy, DIAS_MIN())}.`);
  else if (b.fecha > addDays(hoy, DIAS_MAX)) err('fecha', 'fecha_lejana', `Solo se aceptan pedidos con máximo ${DIAS_MAX} días de anticipación.`);
  else fechaOk = true;
  const horaOk = HORAS.includes(b.hora);
  if (!horaOk) err('hora', 'hora_invalida', `Elige una hora de entrega entre ${HORAS[0]} y ${HORAS[HORAS.length - 1]}.`);

  let detalle = null;
  if (itemsOk && presOk) {
    const prods = (await q.query('SELECT id,nombre,precio FROM productos WHERE activo AND id = ANY($1)', [[...items.keys()]])).rows;
    const pres = (await q.query('SELECT id,nombre,precio,insumo_id FROM presentaciones WHERE activo AND id=$1', [presId])).rows[0];
    if (prods.length !== items.size) err('items', 'producto_no_disponible', 'Alguno de los productos ya no está disponible.');
    if (!pres) err('presentacion_id', 'presentacion_no_disponible', 'La presentación elegida no está disponible.');
    if (prods.length === items.size && pres) {
      const lineas = prods.map((p) => ({ producto_id: p.id, nombre: p.nombre, cantidad: items.get(p.id), precio_unitario: Number(p.precio) }));
      const totalC = lineas.reduce((a, l) => a + cents(l.precio_unitario) * l.cantidad, 0) + cents(pres.precio);
      detalle = { lineas, presentacion: { id: pres.id, nombre: pres.nombre, precio: Number(pres.precio) },
        total: totalC / 100, fecha: b.fecha, hora: b.hora, dedicatoria };
      const { reqs, sinReceta } = await requeridos(q, items, pres.insumo_id);
      if (sinReceta.length) err('items', 'producto_sin_receta', 'Alguno de los productos no se puede preparar por ahora.');
      else errores.push(...(await chequear(q, reqs, fechaOk && horaOk ? b.fecha : null, b.hora)));
    }
  }
  return { errores, detalle };
}

/* ---------- Checkout: guarda el combo y devuelve el enlace de pago (paso 12) ---------- */
async function crearCheckout(user, body, proveedor) {
  const v = await validar(db, body);
  const dv = direccion.validar((body || {}).direccion);   // la dirección solo se exige al pagar, no al cotizar
  if (v.errores.length || dv.errores.length) return { errores: [...v.errores, ...dv.errores] };
  const d = v.detalle;
  const payload = { items: d.lineas.map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad })), lineas: d.lineas,
    presentacion_id: d.presentacion.id, presentacion: d.presentacion, fecha: d.fecha, hora: d.hora, dedicatoria: d.dedicatoria, direccion: dv.dir };
  const { rows } = await db.query(
    "INSERT INTO checkouts(cliente_id,payload,total,proveedor,expira_en) VALUES($1,$2,$3,$4, now() + interval '35 minutes') RETURNING id",
    [user.id, JSON.stringify(payload), d.total, proveedor.nombre]);
  const id = rows[0].id;
  try {
    const s = await proveedor.crearSesion({ checkoutId: id, total: d.total, correo: user.correo });
    await db.query('UPDATE checkouts SET referencia=$2 WHERE id=$1', [id, s.referencia]);
    return { checkout_id: id, url: s.url };
  } catch (e) {
    await db.query("UPDATE checkouts SET estado='rechazado' WHERE id=$1", [id]);
    throw e;
  }
}

/* ---------- Confirmación del pago (pasos 14–15): todo ocurre en UNA transacción ---------- */
async function confirmarPago(checkoutId, { proveedor, referencia, monto, moneda = 'mxn' }) {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    const ck = (await c.query('SELECT * FROM checkouts WHERE id=$1 FOR UPDATE', [checkoutId])).rows[0];
    if (!ck) { await c.query('ROLLBACK'); return { estado: 'no_encontrado' }; }
    if (['pagado', 'revision', 'rechazado'].includes(ck.estado)) { await c.query('COMMIT'); return { estado: ck.estado, pedido_id: ck.pedido_id }; }

    const aRevision = async (motivo) => {
      await c.query("UPDATE checkouts SET estado='revision',referencia=$2 WHERE id=$1", [ck.id, referencia]);
      await c.query('COMMIT');
      console.warn(`[PAGO EN REVISIÓN] checkout=${ck.id} proveedor=${proveedor} ref=${referencia} motivo=${motivo} -> requiere reembolso o atención manual`);
      return { estado: 'revision', motivo };
    };
    if (String(moneda).toLowerCase() !== 'mxn' || cents(monto) !== cents(ck.total)) return aRevision('monto_o_moneda');

    const p = ck.payload;
    const dir = p.direccion || {};
    // Bloqueos para que dos pagos simultáneos no usen el mismo stock ni el mismo horario
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`slot ${p.fecha} ${p.hora}`]);
    const items = new Map(p.items.map((i) => [i.producto_id, i.cantidad]));
    const { reqs } = await requeridos(c, items, (await c.query('SELECT insumo_id FROM presentaciones WHERE id=$1', [p.presentacion_id])).rows[0].insumo_id);
    await c.query('SELECT id FROM insumos WHERE id = ANY($1) ORDER BY id FOR UPDATE', [[...reqs.keys()]]);
    const faltas = await chequear(c, reqs, p.fecha, p.hora);
    if (faltas.length) return aRevision(faltas[0].codigo);

    const pedido = (await c.query(
      `INSERT INTO pedidos(cliente_id,presentacion_id,fecha_entrega,hora_entrega,dedicatoria,total,estatus,
                           dir_cp,dir_colonia,dir_calle,dir_num_ext,dir_num_int,dir_municipio,dir_estado,dir_referencias)
       VALUES($1,$2,$3,$4,$5,$6,'Pendiente',$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [ck.cliente_id, p.presentacion_id, p.fecha, p.hora, p.dedicatoria, ck.total,
        dir.cp || null, dir.colonia || null, dir.calle || null, dir.num_ext || null, dir.num_int || null, dir.municipio || null, dir.estado || null, dir.referencias || null])).rows[0];
    for (const l of p.lineas)
      await c.query('INSERT INTO pedido_items(pedido_id,producto_id,cantidad,precio_unitario) VALUES($1,$2,$3,$4)', [pedido.id, l.producto_id, l.cantidad, l.precio_unitario]);
    for (const [insumoId, cant] of reqs) {
      await c.query('UPDATE insumos SET stock = stock - $2 WHERE id=$1', [insumoId, cant]);
      await c.query("INSERT INTO movimientos_inventario(insumo_id,tipo,cantidad,pedido_id) VALUES($1,'salida',$2,$3)", [insumoId, cant, pedido.id]);
    }
    await c.query("INSERT INTO pagos(pedido_id,proveedor,referencia,monto,estado) VALUES($1,$2,$3,$4,'aprobado')", [pedido.id, proveedor, referencia, ck.total]);
    await c.query("UPDATE checkouts SET estado='pagado',pedido_id=$2,referencia=$3 WHERE id=$1", [ck.id, pedido.id, referencia]);
    await c.query("INSERT INTO pedido_estatus_historial(pedido_id,estatus) VALUES($1,'Pendiente')", [pedido.id]);
    await notif.encolar(c, pedido.id, 'confirmacion'); // correo de confirmación (en la misma transacción)
    await c.query('COMMIT');
    notif.disparar();
    return { estado: 'pagado', pedido_id: pedido.id };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/* ---------- Consultas de pedidos ---------- */
const folio = (id) => 'EC-' + String(id).padStart(4, '0');
async function detallePedido(id) {
  const p = (await db.query(
    `SELECT p.id,p.cliente_id,p.estatus,p.fecha_entrega::text AS fecha,left(p.hora_entrega::text,5) AS hora,p.dedicatoria,p.total,p.creado_en,
            pr.nombre AS presentacion, u.nombre AS cliente, u.correo, ${direccion.COLS}
       FROM pedidos p JOIN presentaciones pr ON pr.id=p.presentacion_id JOIN usuarios u ON u.id=p.cliente_id WHERE p.id=$1`, [id])).rows[0];
  if (!p) return null;
  const items = (await db.query(
    'SELECT pd.nombre,i.cantidad,i.precio_unitario FROM pedido_items i JOIN productos pd ON pd.id=i.producto_id WHERE i.pedido_id=$1 ORDER BY pd.nombre', [id])).rows
    .map((i) => ({ nombre: i.nombre, cantidad: i.cantidad, precio_unitario: Number(i.precio_unitario), subtotal: cents(i.precio_unitario) * i.cantidad / 100 }));
  const pago = (await db.query('SELECT proveedor,referencia,estado FROM pagos WHERE pedido_id=$1 ORDER BY id LIMIT 1', [id])).rows[0] || null;
  const historial = (await db.query('SELECT estatus,creado_en FROM pedido_estatus_historial WHERE pedido_id=$1 ORDER BY id', [id])).rows;
  const sumaItems = items.reduce((a, i) => a + cents(i.subtotal), 0);
  return { id: p.id, cliente_id: p.cliente_id, folio: folio(p.id), estatus: p.estatus, cliente: { nombre: p.cliente, correo: p.correo },
    entrega: { fecha: p.fecha, hora: p.hora, direccion: direccion.desdeFila(p) }, dedicatoria: p.dedicatoria,
    presentacion: { nombre: p.presentacion, precio: (cents(p.total) - sumaItems) / 100 }, items, total: Number(p.total), pago, historial, creado_en: p.creado_en };
}
async function pedidosDe(clienteId) {
  const { rows } = await db.query(
    `SELECT p.id,p.estatus,p.fecha_entrega::text AS fecha,left(p.hora_entrega::text,5) AS hora,p.dedicatoria,p.total,p.creado_en,pr.nombre AS presentacion, ${direccion.COLS},
            (SELECT json_agg(json_build_object('nombre',pd.nombre,'cantidad',i.cantidad) ORDER BY pd.nombre)
               FROM pedido_items i JOIN productos pd ON pd.id=i.producto_id WHERE i.pedido_id=p.id) AS items,
            (SELECT json_agg(json_build_object('estatus',h.estatus,'creado_en',h.creado_en) ORDER BY h.id)
               FROM pedido_estatus_historial h WHERE h.pedido_id=p.id) AS historial
       FROM pedidos p JOIN presentaciones pr ON pr.id=p.presentacion_id WHERE p.cliente_id=$1 ORDER BY p.id DESC`, [clienteId]);
  return rows.map((r) => {
    const o = { ...r, direccion: direccion.desdeFila(r), folio: folio(r.id), total: Number(r.total) };
    for (const k of Object.keys(o)) if (k.startsWith('dir_')) delete o[k];   // las columnas internas no salen de la API
    return o;
  });
}

module.exports = { HORAS, todayMX, addDays, fechaValida, horarios, validar, crearCheckout, confirmarPago, detallePedido, pedidosDe, folio };

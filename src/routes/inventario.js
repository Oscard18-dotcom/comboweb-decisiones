const router = require('express').Router();
const db = require('../db');
const { auth, roles } = require('../middleware/auth');
const { wrap, isText, paramId } = require('../util');

router.use(auth, roles('almacen', 'admin'));

// Número no negativo con máximo 4 decimales (null si no es válido)
const num4 = (v) => {
  const n = Number(v);
  return v !== '' && v !== null && Number.isFinite(n) && n >= 0 && n <= 1e9 && Math.abs(n * 1e4 - Math.round(n * 1e4)) < 1e-6 ? Math.round(n * 1e4) / 1e4 : null;
};
const SEL = `SELECT i.id,i.nombre,i.unidad,i.stock,i.stock_minimo,i.costo_unitario,i.activo,
  (i.stock <= i.stock_minimo) AS en_reorden, GREATEST(i.stock_minimo * 2 - i.stock, 0) AS sugerido,
  ((SELECT count(*) FROM receta_ingredientes ri WHERE ri.insumo_id = i.id) + (SELECT count(*) FROM presentaciones pr WHERE pr.insumo_id = i.id))::int AS en_uso
  FROM insumos i`;
const fmt = (r) => ({ id: r.id, nombre: r.nombre, unidad: r.unidad, stock: Number(r.stock), stock_minimo: Number(r.stock_minimo),
  costo_unitario: Number(r.costo_unitario), activo: r.activo, en_reorden: r.en_reorden, sugerido_reponer: Number(r.sugerido), en_uso: r.en_uso });
const uno = async (q, id) => { const { rows } = await q.query(SEL + ' WHERE i.id=$1', [id]); return rows[0] ? fmt(rows[0]) : null; };
async function usos(id) {
  const { rows } = await db.query(
    `SELECT p.nombre FROM receta_ingredientes ri JOIN recetas rc ON rc.id=ri.receta_id JOIN productos p ON p.id=rc.producto_id WHERE ri.insumo_id=$1
     UNION ALL SELECT 'presentación ' || nombre FROM presentaciones WHERE insumo_id=$1`, [id]);
  return rows.map((r) => r.nombre);
}
const dup = (res) => res.status(409).json({ error: 'Ya existe un insumo con ese nombre.' });

/* Lista (HU07). ?inactivos=1 incluye los archivados */
router.get('/', wrap(async (req, res) => {
  const { rows } = await db.query(SEL + ' WHERE ($1 OR i.activo) ORDER BY i.nombre', [req.query.inactivos === '1']);
  res.json({ insumos: rows.map(fmt) });
}));

/* Alertas de reorden (HU09): stock actual igual o menor al mínimo. Se calculan al momento: desaparecen solas al reponer */
router.get('/alertas', wrap(async (req, res) => {
  const { rows } = await db.query(SEL + ' WHERE i.activo AND i.stock <= i.stock_minimo ORDER BY i.nombre');
  res.json({ alertas: rows.map(fmt) });
}));

router.post('/', wrap(async (req, res) => {
  const b = req.body || {};
  const stock = b.stock === undefined ? 0 : num4(b.stock), minimo = b.stock_minimo === undefined ? 0 : num4(b.stock_minimo), costo = b.costo_unitario === undefined ? 0 : num4(b.costo_unitario);
  if (!isText(b.nombre, 2, 80)) return res.status(400).json({ error: 'El nombre debe tener entre 2 y 80 caracteres.' });
  if (!isText(b.unidad, 1, 10)) return res.status(400).json({ error: 'Escribe la unidad (por ejemplo g, ml o pza).' });
  if (stock === null || minimo === null) return res.status(400).json({ error: 'El stock y el mínimo deben ser números de 0 o más.' });
  if (costo === null || costo > 100000) return res.status(400).json({ error: 'El costo unitario debe ser un número de 0 o más.' });
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query('INSERT INTO insumos(nombre,unidad,stock,stock_minimo,costo_unitario) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [b.nombre.trim(), b.unidad.trim(), stock, minimo, costo]);
    if (stock > 0) await c.query("INSERT INTO movimientos_inventario(insumo_id,tipo,cantidad,nota,usuario_id) VALUES($1,'entrada',$2,'Existencia inicial',$3)", [rows[0].id, stock, req.user.id]);
    await c.query('COMMIT');
    res.status(201).json({ insumo: await uno(c, rows[0].id) });
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') return dup(res);
    throw e;
  } finally { c.release(); }
}));

/* Editar datos. El stock NO se edita aquí: solo cambia con movimientos (queda historial) */
router.put('/:id', wrap(async (req, res) => {
  const id = paramId(req), b = req.body || {};
  if (!id) return res.status(400).json({ error: 'Identificador inválido.' });
  if ('stock' in b) return res.status(400).json({ error: 'El stock solo se cambia registrando un movimiento (entrada, salida o ajuste).' });
  const minimo = b.stock_minimo === undefined ? null : num4(b.stock_minimo), costo = b.costo_unitario === undefined ? null : num4(b.costo_unitario);
  if (b.nombre !== undefined && !isText(b.nombre, 2, 80)) return res.status(400).json({ error: 'El nombre debe tener entre 2 y 80 caracteres.' });
  if (b.unidad !== undefined && !isText(b.unidad, 1, 10)) return res.status(400).json({ error: 'Escribe la unidad (por ejemplo g, ml o pza).' });
  if (b.stock_minimo !== undefined && minimo === null) return res.status(400).json({ error: 'El mínimo debe ser un número de 0 o más.' });
  if (b.costo_unitario !== undefined && (costo === null || costo > 100000)) return res.status(400).json({ error: 'El costo unitario debe ser un número de 0 o más.' });
  if (b.activo !== undefined && typeof b.activo !== 'boolean') return res.status(400).json({ error: 'Datos inválidos.' });
  const actual = await uno(db, id);
  if (!actual) return res.status(404).json({ error: 'Insumo no encontrado.' });
  if (actual.en_uso > 0 && b.unidad !== undefined && b.unidad.trim() !== actual.unidad)
    return res.status(409).json({ error: 'No se puede cambiar la unidad de un insumo que ya está en recetas.' });
  if (actual.en_uso > 0 && b.activo === false)
    return res.status(409).json({ error: `No se puede archivar: forma parte de ${(await usos(id)).join(', ')}.` });
  try {
    await db.query('UPDATE insumos SET nombre=COALESCE($2,nombre),unidad=COALESCE($3,unidad),stock_minimo=COALESCE($4,stock_minimo),costo_unitario=COALESCE($5,costo_unitario),activo=COALESCE($6,activo) WHERE id=$1',
      [id, b.nombre ? b.nombre.trim() : null, b.unidad ? b.unidad.trim() : null, minimo, costo, b.activo ?? null]);
    res.json({ insumo: await uno(db, id) });
  } catch (e) { if (e.code === '23505') return dup(res); throw e; }
}));

/* Movimientos: entrada (compra), salida (merma, consumo manual) y ajuste (conteo físico: se escribe el stock real) */
router.post('/:id/movimientos', wrap(async (req, res) => {
  const id = paramId(req), { tipo, nota } = req.body || {};
  const cant = num4((req.body || {}).cantidad);
  if (!id) return res.status(400).json({ error: 'Identificador inválido.' });
  if (!['entrada', 'salida', 'ajuste'].includes(tipo)) return res.status(400).json({ error: 'El tipo debe ser entrada, salida o ajuste.' });
  if (cant === null || (tipo !== 'ajuste' && cant === 0)) return res.status(400).json({ error: tipo === 'ajuste' ? 'Escribe el stock real contado (0 o más).' : 'La cantidad debe ser un número mayor a 0 (máximo 4 decimales).' });
  if (nota !== undefined && nota !== null && !isText(String(nota), 0, 200)) return res.status(400).json({ error: 'La nota es muy larga (máximo 200 caracteres).' });
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    let registrada;
    if (tipo === 'entrada') {
      registrada = (await c.query('UPDATE insumos SET stock = stock + $2 WHERE id=$1 AND activo RETURNING $2::numeric AS cant', [id, cant])).rows[0];
    } else if (tipo === 'salida') {
      registrada = (await c.query('UPDATE insumos SET stock = stock - $2 WHERE id=$1 AND activo AND stock >= $2 RETURNING $2::numeric AS cant', [id, cant])).rows[0];
    } else {
      registrada = (await c.query(
        'WITH viejo AS (SELECT id, stock FROM insumos WHERE id=$1 AND activo FOR UPDATE) UPDATE insumos i SET stock=$2 FROM viejo WHERE i.id=viejo.id RETURNING i.stock - viejo.stock AS cant', [id, cant])).rows[0];
    }
    if (!registrada) {
      await c.query('ROLLBACK');
      const x = await uno(c, id);
      if (!x) return res.status(404).json({ error: 'Insumo no encontrado.' });
      if (!x.activo) return res.status(409).json({ error: 'El insumo está archivado.' });
      return res.status(409).json({ error: `No hay suficiente stock para esa salida (hay ${x.stock} ${x.unidad}).` });
    }
    const m = (await c.query('INSERT INTO movimientos_inventario(insumo_id,tipo,cantidad,nota,usuario_id) VALUES($1,$2,$3,$4,$5) RETURNING id,tipo,cantidad,nota,creado_en',
      [id, tipo, registrada.cant, nota ? String(nota).trim() : null, req.user.id])).rows[0];
    await c.query('COMMIT');
    res.status(201).json({ insumo: await uno(c, id), movimiento: { ...m, cantidad: Number(m.cantidad) } });
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}));

router.get('/:id/movimientos', wrap(async (req, res) => {
  const id = paramId(req);
  if (!id) return res.status(400).json({ error: 'Identificador inválido.' });
  if (!(await uno(db, id))) return res.status(404).json({ error: 'Insumo no encontrado.' });
  const { rows } = await db.query(
    `SELECT m.id,m.tipo,m.cantidad,m.nota,m.pedido_id,m.pedido_proveedor_id,m.creado_en,u.nombre AS usuario FROM movimientos_inventario m
       LEFT JOIN usuarios u ON u.id=m.usuario_id WHERE m.insumo_id=$1 ORDER BY m.id DESC LIMIT 100`, [id]);
  res.json({ movimientos: rows.map((r) => ({ ...r, cantidad: Number(r.cantidad) })) });
}));

/* Eliminar: si está en recetas o presentaciones se avisa y NO se permite; si tiene historial se archiva; si es nuevo se borra */
router.delete('/:id', wrap(async (req, res) => {
  const id = paramId(req);
  if (!id) return res.status(400).json({ error: 'Identificador inválido.' });
  const x = await uno(db, id);
  if (!x) return res.status(404).json({ error: 'Insumo no encontrado.' });
  if (x.en_uso > 0) return res.status(409).json({ error: `No se puede eliminar: forma parte de ${(await usos(id)).join(', ')}. Quítalo primero de esas recetas.` });
  const { rows } = await db.query('SELECT 1 FROM movimientos_inventario WHERE insumo_id=$1 UNION ALL SELECT 1 FROM pedido_proveedor_items WHERE insumo_id=$1 LIMIT 1', [id]);
  if (rows[0]) { await db.query('UPDATE insumos SET activo=false WHERE id=$1', [id]); return res.json({ archivado: true }); }
  await db.query('DELETE FROM proveedor_insumos WHERE insumo_id=$1', [id]);
  await db.query('DELETE FROM insumos WHERE id=$1', [id]);
  res.json({ eliminado: true });
}));

module.exports = router;

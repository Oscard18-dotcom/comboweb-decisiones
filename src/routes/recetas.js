const router = require('express').Router();
const db = require('../db');
const { auth, roles } = require('../middleware/auth');
const { wrap, paramId } = require('../util');

router.use(auth, roles('admin'));

const redondeo = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
const SEL = `SELECT r.id AS receta_id, r.rinde, p.id AS producto_id, p.nombre, p.precio, p.activo,
    json_agg(json_build_object('insumo_id', i.id, 'nombre', i.nombre, 'unidad', i.unidad, 'cantidad', ri.cantidad,
      'costo_unitario', i.costo_unitario, 'costo', ri.cantidad * i.costo_unitario) ORDER BY i.nombre) AS ingredientes,
    sum(ri.cantidad * i.costo_unitario) AS costo_total
  FROM recetas r JOIN productos p ON p.id = r.producto_id JOIN receta_ingredientes ri ON ri.receta_id = r.id JOIN insumos i ON i.id = ri.insumo_id`;
const fmt = (r) => {
  const total = Number(r.costo_total), pieza = total / r.rinde, precio = Number(r.precio);
  return { id: r.receta_id, producto_id: r.producto_id, producto: r.nombre, precio, activo: r.activo, rinde: r.rinde,
    ingredientes: r.ingredientes.map((i) => ({ ...i, cantidad: Number(i.cantidad), costo_unitario: Number(i.costo_unitario), costo: redondeo(Number(i.costo), 4) })),
    costo_total: redondeo(total, 2), costo_pieza: redondeo(pieza, 2), margen_pct: redondeo((precio - pieza) / precio * 100, 1) };
};
const uno = async (q, id) => { const { rows } = await q.query(SEL + ' WHERE r.id=$1 GROUP BY r.id, p.id', [id]); return rows[0] ? fmt(rows[0]) : null; };

function validar(b = {}) {
  const rinde = b.rinde === undefined ? 1 : Number(b.rinde);
  if (!Number.isInteger(rinde) || rinde < 1 || rinde > 1000) return { error: 'El rinde debe ser un número entero entre 1 y 1000.' };
  if (!Array.isArray(b.ingredientes) || b.ingredientes.length < 1 || b.ingredientes.length > 30) return { error: 'La receta necesita entre 1 y 30 ingredientes.' };
  const vistos = new Set(), ing = [];
  for (const x of b.ingredientes) {
    const insumo = Number(x && x.insumo_id), cant = Number(x && x.cantidad);
    if (!Number.isInteger(insumo) || insumo <= 0) return { error: 'Cada ingrediente necesita un insumo válido.' };
    if (!Number.isFinite(cant) || cant <= 0 || cant > 1e6) return { error: 'Las cantidades deben ser mayores a 0.' };
    if (Math.abs(cant * 1000 - Math.round(cant * 1000)) > 1e-6) return { error: 'Las cantidades admiten hasta 3 decimales.' };
    if (vistos.has(insumo)) return { error: 'Un insumo no puede repetirse en la misma receta.' };
    vistos.add(insumo); ing.push({ insumo_id: insumo, cantidad: Math.round(cant * 1000) / 1000 });
  }
  return { rinde, ing };
}
async function guardarIngredientes(c, recetaId, ing) {
  const ids = ing.map((i) => i.insumo_id);
  const { rows } = await c.query('SELECT id FROM insumos WHERE id = ANY($1) AND activo', [ids]);
  if (rows.length !== ids.length) { const e = new Error('ingredientes'); e.codigo = 'ingredientes'; throw e; }
  await c.query('DELETE FROM receta_ingredientes WHERE receta_id=$1', [recetaId]);
  for (const i of ing) await c.query('INSERT INTO receta_ingredientes(receta_id,insumo_id,cantidad) VALUES($1,$2,$3)', [recetaId, i.insumo_id, i.cantidad]);
}
const MSG_ING = 'Alguno de los ingredientes no existe o está archivado.';

router.get('/', wrap(async (req, res) => {
  const { rows } = await db.query(SEL + ' GROUP BY r.id, p.id ORDER BY p.nombre');
  res.json({ recetas: rows.map(fmt) });
}));
router.get('/:id', wrap(async (req, res) => {
  const id = paramId(req);
  if (!id) return res.status(400).json({ error: 'Identificador inválido.' });
  const r = await uno(db, id);
  if (!r) return res.status(404).json({ error: 'Receta no encontrada.' });
  res.json({ receta: r });
}));

router.post('/', wrap(async (req, res) => {
  const productoId = Number((req.body || {}).producto_id), v = validar(req.body);
  if (!Number.isInteger(productoId) || productoId <= 0) return res.status(400).json({ error: 'Elige el producto de la receta.' });
  if (v.error) return res.status(400).json({ error: v.error });
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    if (!(await c.query('SELECT 1 FROM productos WHERE id=$1', [productoId])).rows[0]) { await c.query('ROLLBACK'); return res.status(404).json({ error: 'Producto no encontrado.' }); }
    const r = (await c.query('INSERT INTO recetas(producto_id,rinde) VALUES($1,$2) RETURNING id', [productoId, v.rinde])).rows[0];
    await guardarIngredientes(c, r.id, v.ing);
    await c.query('COMMIT');
    res.status(201).json({ receta: await uno(c, r.id) });
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') return res.status(409).json({ error: 'Ese producto ya tiene receta; edítala.' });
    if (e.codigo === 'ingredientes') return res.status(400).json({ error: MSG_ING });
    throw e;
  } finally { c.release(); }
}));

router.put('/:id', wrap(async (req, res) => {
  const id = paramId(req), v = validar(req.body);
  if (!id) return res.status(400).json({ error: 'Identificador inválido.' });
  if (v.error) return res.status(400).json({ error: v.error });
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    if (!(await c.query('SELECT 1 FROM recetas WHERE id=$1 FOR UPDATE', [id])).rows[0]) { await c.query('ROLLBACK'); return res.status(404).json({ error: 'Receta no encontrada.' }); }
    await c.query('UPDATE recetas SET rinde=$2 WHERE id=$1', [id, v.rinde]);
    await guardarIngredientes(c, id, v.ing);
    await c.query('COMMIT');
    res.json({ receta: await uno(c, id) });
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    if (e.codigo === 'ingredientes') return res.status(400).json({ error: MSG_ING });
    throw e;
  } finally { c.release(); }
}));

router.delete('/:id', wrap(async (req, res) => {
  const id = paramId(req);
  if (!id) return res.status(400).json({ error: 'Identificador inválido.' });
  const r = await uno(db, id);
  if (!r) return res.status(404).json({ error: 'Receta no encontrada.' });
  if (r.activo) return res.status(409).json({ error: 'Desactiva primero el producto: un producto activo necesita su receta.' });
  await db.query('DELETE FROM recetas WHERE id=$1', [id]);
  res.json({ eliminada: true });
}));

module.exports = router;

const router = require('express').Router();
const db = require('../db');
const { auth, roles } = require('../middleware/auth');
const { wrap, isEmail, isText, paramId } = require('../util');

router.use(auth, roles('admin'));

const SEL = `SELECT p.id,p.nombre,p.correo,p.contacto,p.telefono,p.notas,p.activo,
  COALESCE((SELECT json_agg(json_build_object('id',i.id,'nombre',i.nombre,'unidad',i.unidad) ORDER BY i.nombre)
              FROM proveedor_insumos pi JOIN insumos i ON i.id=pi.insumo_id WHERE pi.proveedor_id=p.id),'[]'::json) AS insumos,
  (SELECT count(*)::int FROM pedidos_proveedor pp WHERE pp.proveedor_id=p.id) AS pedidos
  FROM proveedores p`;
const uno = async (q, id) => (await q.query(SEL + ' WHERE p.id=$1', [id])).rows[0] || null;

function validar(b, parcial) {
  const v = {};
  if (!parcial || b.nombre !== undefined) { if (!isText(b.nombre, 2, 80)) return { error: 'El nombre del proveedor debe tener entre 2 y 80 caracteres.' }; v.nombre = b.nombre.trim(); }
  if (!parcial || b.correo !== undefined) { if (!isEmail(b.correo)) return { error: 'Escribe un correo válido del proveedor (a ese correo se enviarán los pedidos).' }; v.correo = b.correo.trim().toLowerCase(); }
  if (b.contacto !== undefined && b.contacto !== null && b.contacto !== '') { if (!isText(String(b.contacto), 1, 80)) return { error: 'El nombre de contacto es muy largo (máximo 80 caracteres).' }; v.contacto = String(b.contacto).trim(); }
  else if (b.contacto !== undefined) v.contacto = null;
  if (b.telefono !== undefined && b.telefono !== null && b.telefono !== '') { if (typeof b.telefono !== 'string' || !/^[0-9+()\-\s.]{7,30}$/.test(b.telefono.trim())) return { error: 'El teléfono solo puede llevar números, espacios, + ( ) - y debe tener al menos 7 dígitos.' }; v.telefono = b.telefono.trim(); }
  else if (b.telefono !== undefined) v.telefono = null;
  if (b.notas !== undefined && b.notas !== null && b.notas !== '') { if (!isText(String(b.notas), 1, 300)) return { error: 'Las notas son muy largas (máximo 300 caracteres).' }; v.notas = String(b.notas).trim(); }
  else if (b.notas !== undefined) v.notas = null;
  if (b.activo !== undefined) { if (typeof b.activo !== 'boolean') return { error: 'Datos inválidos.' }; v.activo = b.activo; }
  if (b.insumos !== undefined) {
    if (!Array.isArray(b.insumos) || b.insumos.length > 100) return { error: 'La lista de insumos no es válida.' };
    const ids = b.insumos.map((x) => Number.parseInt(x, 10));
    if (ids.some((x) => !Number.isInteger(x) || x <= 0)) return { error: 'La lista de insumos no es válida.' };
    v.insumos = [...new Set(ids)];
  }
  return { v };
}
async function guardarInsumos(c, id, ids) {
  if (ids.length) {
    const n = (await c.query('SELECT count(*)::int AS n FROM insumos WHERE id = ANY($1::int[])', [ids])).rows[0].n;
    if (n !== ids.length) return false;
  }
  await c.query('DELETE FROM proveedor_insumos WHERE proveedor_id=$1', [id]);
  for (const i of ids) await c.query('INSERT INTO proveedor_insumos(proveedor_id,insumo_id) VALUES($1,$2)', [id, i]);
  return true;
}
const dup = (res) => res.status(409).json({ error: 'Ya existe un proveedor con ese nombre.' });

router.get('/', wrap(async (req, res) => {
  const { rows } = await db.query(SEL + ' WHERE ($1 OR p.activo) ORDER BY p.activo DESC, lower(p.nombre)', [req.query.inactivos === '1']);
  res.json({ proveedores: rows });
}));

router.post('/', wrap(async (req, res) => {
  const { error, v } = validar(req.body || {}, false);
  if (error) return res.status(400).json({ error });
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    const id = (await c.query('INSERT INTO proveedores(nombre,correo,contacto,telefono,notas) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [v.nombre, v.correo, v.contacto || null, v.telefono || null, v.notas || null])).rows[0].id;
    if (v.insumos && !(await guardarInsumos(c, id, v.insumos))) { await c.query('ROLLBACK'); return res.status(400).json({ error: 'Hay un insumo que no existe.' }); }
    await c.query('COMMIT');
    res.status(201).json({ proveedor: await uno(c, id) });
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); if (e.code === '23505') return dup(res); throw e; } finally { c.release(); }
}));

router.put('/:id', wrap(async (req, res) => {
  const id = paramId(req);
  if (!id) return res.status(400).json({ error: 'Identificador inválido.' });
  const { error, v } = validar(req.body || {}, true);
  if (error) return res.status(400).json({ error });
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    if (!(await c.query('SELECT 1 FROM proveedores WHERE id=$1 FOR UPDATE', [id])).rows[0]) { await c.query('ROLLBACK'); return res.status(404).json({ error: 'Proveedor no encontrado.' }); }
    const has = (k) => k in v;
    await c.query(`UPDATE proveedores SET nombre=COALESCE($2,nombre),correo=COALESCE($3,correo),activo=COALESCE($4,activo),
        contacto=CASE WHEN $5 THEN $6 ELSE contacto END, telefono=CASE WHEN $7 THEN $8 ELSE telefono END, notas=CASE WHEN $9 THEN $10 ELSE notas END WHERE id=$1`,
      [id, v.nombre ?? null, v.correo ?? null, v.activo ?? null, has('contacto'), v.contacto ?? null, has('telefono'), v.telefono ?? null, has('notas'), v.notas ?? null]);
    if (v.insumos && !(await guardarInsumos(c, id, v.insumos))) { await c.query('ROLLBACK'); return res.status(400).json({ error: 'Hay un insumo que no existe.' }); }
    await c.query('COMMIT');
    res.json({ proveedor: await uno(c, id) });
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); if (e.code === '23505') return dup(res); throw e; } finally { c.release(); }
}));

router.delete('/:id', wrap(async (req, res) => {
  const id = paramId(req);
  if (!id) return res.status(400).json({ error: 'Identificador inválido.' });
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    if (!(await c.query('SELECT 1 FROM proveedores WHERE id=$1 FOR UPDATE', [id])).rows[0]) { await c.query('ROLLBACK'); return res.status(404).json({ error: 'Proveedor no encontrado.' }); }
    const pend = (await c.query("SELECT count(*)::int AS n FROM pedidos_proveedor WHERE proveedor_id=$1 AND estado='enviado'", [id])).rows[0].n;
    if (pend > 0) { await c.query('ROLLBACK'); return res.status(409).json({ error: 'Este proveedor tiene pedidos enviados que aún no se marcan como recibidos. Recíbelos o cancélalos primero.' }); }
    const tuvo = (await c.query('SELECT 1 FROM pedidos_proveedor WHERE proveedor_id=$1 LIMIT 1', [id])).rows[0];
    if (tuvo) { await c.query('UPDATE proveedores SET activo=false WHERE id=$1', [id]); await c.query('COMMIT'); return res.json({ archivado: true }); }
    await c.query('DELETE FROM proveedores WHERE id=$1', [id]);
    await c.query('COMMIT');
    res.json({ eliminado: true });
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}));

module.exports = router;

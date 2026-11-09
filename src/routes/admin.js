const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { auth, roles } = require('../middleware/auth');
const { wrap, isEmail, isPassword, isText, parsePrice, paramId } = require('../util');

router.use(auth, roles('admin'));

const dup = (res) => res.status(409).json({ error: 'Ya existe un registro con ese nombre.' });

router.get('/productos', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT p.id,p.nombre,p.descripcion,p.precio,p.activo,(r.id IS NOT NULL) AS tiene_receta
       FROM productos p LEFT JOIN recetas r ON r.producto_id=p.id ORDER BY p.nombre`);
  res.json({ productos: rows });
}));

router.post('/productos', wrap(async (req, res) => {
  const { nombre, descripcion } = req.body || {};
  const precio = parsePrice((req.body || {}).precio);
  if (!isText(nombre, 2, 80)) return res.status(400).json({ error: 'El nombre debe tener entre 2 y 80 caracteres.' });
  if (precio === null) return res.status(400).json({ error: 'El precio debe ser un número mayor a cero.' });
  if (descripcion != null && !isText(String(descripcion), 0, 300)) return res.status(400).json({ error: 'La descripción es muy larga.' });
  try {
    const { rows } = await db.query(
      'INSERT INTO productos(nombre,descripcion,precio,activo) VALUES($1,$2,$3,false) RETURNING *',
      [nombre.trim(), descripcion ? String(descripcion).trim() : null, precio]);
    res.status(201).json({ producto: rows[0] });
  } catch (e) { if (e.code === '23505') return dup(res); throw e; }
}));

router.put('/productos/:id', wrap(async (req, res) => {
  const id = paramId(req), { nombre, descripcion } = req.body || {};
  const precio = parsePrice((req.body || {}).precio);
  if (!id) return res.status(400).json({ error: 'Identificador inválido.' });
  if (!isText(nombre, 2, 80)) return res.status(400).json({ error: 'El nombre debe tener entre 2 y 80 caracteres.' });
  if (precio === null) return res.status(400).json({ error: 'El precio debe ser un número mayor a cero.' });
  try {
    const { rows } = await db.query(
      'UPDATE productos SET nombre=$2,descripcion=$3,precio=$4 WHERE id=$1 RETURNING *',
      [id, nombre.trim(), descripcion ? String(descripcion).trim().slice(0, 300) : null, precio]);
    if (!rows[0]) return res.status(404).json({ error: 'Producto no encontrado.' });
    res.json({ producto: rows[0] });
  } catch (e) { if (e.code === '23505') return dup(res); throw e; }
}));

router.patch('/productos/:id/activo', wrap(async (req, res) => {
  const id = paramId(req), { activo } = req.body || {};
  if (!id || typeof activo !== 'boolean') return res.status(400).json({ error: 'Datos inválidos.' });
  if (activo) {
    const r = await db.query('SELECT 1 FROM recetas WHERE producto_id=$1', [id]);
    if (!r.rows[0]) return res.status(409).json({ error: 'Para activar un producto primero debe tener una receta.' });
  }
  const { rows } = await db.query('UPDATE productos SET activo=$2 WHERE id=$1 RETURNING *', [id, activo]);
  if (!rows[0]) return res.status(404).json({ error: 'Producto no encontrado.' });
  res.json({ producto: rows[0] });
}));

router.delete('/productos/:id', wrap(async (req, res) => {
  const id = paramId(req);
  if (!id) return res.status(400).json({ error: 'Identificador inválido.' });
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    const p = (await c.query('SELECT id,nombre FROM productos WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!p) { await c.query('ROLLBACK'); return res.status(404).json({ error: 'Producto no encontrado.' }); }
    const vendido = (await c.query('SELECT 1 FROM pedido_items WHERE producto_id=$1 LIMIT 1', [id])).rows[0];
    if (vendido) {
      await c.query('UPDATE productos SET activo=false WHERE id=$1', [id]);
      await c.query('COMMIT');
      return res.json({ archivado: true });
    }
    await c.query('DELETE FROM productos WHERE id=$1', [id]);
    await c.query('COMMIT');
    res.json({ eliminado: true });
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}));

router.get('/presentaciones', wrap(async (req, res) => {
  const { rows } = await db.query('SELECT id,nombre,precio,activo FROM presentaciones ORDER BY precio');
  res.json({ presentaciones: rows });
}));

router.put('/presentaciones/:id', wrap(async (req, res) => {
  const id = paramId(req), b = req.body || {};
  const precio = b.precio === undefined ? null : parsePrice(b.precio);
  if (!id) return res.status(400).json({ error: 'Identificador inválido.' });
  if (b.precio !== undefined && precio === null) return res.status(400).json({ error: 'El precio debe ser un número mayor a cero.' });
  if (b.activo !== undefined && typeof b.activo !== 'boolean') return res.status(400).json({ error: 'Datos inválidos.' });
  const { rows } = await db.query(
    'UPDATE presentaciones SET precio=COALESCE($2,precio),activo=COALESCE($3,activo) WHERE id=$1 RETURNING id,nombre,precio,activo',
    [id, precio, b.activo ?? null]);
  if (!rows[0]) return res.status(404).json({ error: 'Presentación no encontrada.' });
  res.json({ presentacion: rows[0] });
}));

const ROLES = ['cliente', 'cocina', 'almacen', 'admin'];

router.get('/usuarios', wrap(async (req, res) => {
  const { rows } = await db.query('SELECT id,nombre,correo,telefono,rol,activo,creado_en FROM usuarios ORDER BY id');
  res.json({ usuarios: rows });
}));

router.post('/usuarios', wrap(async (req, res) => {
  const { nombre, correo, password, rol } = req.body || {};
  if (!isText(nombre, 2, 80)) return res.status(400).json({ error: 'Escribe el nombre completo.' });
  if (!isEmail(correo)) return res.status(400).json({ error: 'Escribe un correo válido.' });
  if (!isPassword(password)) return res.status(400).json({ error: 'La contraseña debe tener entre 8 y 72 caracteres.' });
  if (!['cocina', 'almacen', 'admin'].includes(rol)) return res.status(400).json({ error: 'El rol debe ser cocina, almacen o admin.' });
  try {
    const { rows } = await db.query(
      'INSERT INTO usuarios(nombre,correo,password_hash,rol) VALUES($1,$2,$3,$4) RETURNING id,nombre,correo,rol,activo',
      [nombre.trim(), correo.trim().toLowerCase(), await bcrypt.hash(password, 12), rol]);
    res.status(201).json({ usuario: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe un usuario con ese correo.' });
    throw e;
  }
}));

router.patch('/usuarios/:id', wrap(async (req, res) => {
  const id = paramId(req), { rol, activo } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Identificador inválido.' });
  if (rol !== undefined && !ROLES.includes(rol)) return res.status(400).json({ error: 'Rol inválido.' });
  if (activo !== undefined && typeof activo !== 'boolean') return res.status(400).json({ error: 'Datos inválidos.' });
  const t = (await db.query('SELECT rol,activo FROM usuarios WHERE id=$1', [id])).rows[0];
  if (!t) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const nuevoRol = rol ?? t.rol, nuevoActivo = activo ?? t.activo;
  if (t.rol === 'admin' && t.activo && (nuevoRol !== 'admin' || !nuevoActivo)) {
    const { rows } = await db.query("SELECT count(*)::int AS n FROM usuarios WHERE rol='admin' AND activo AND id<>$1", [id]);
    if (rows[0].n === 0) return res.status(409).json({ error: 'No se puede dejar al sistema sin un administrador activo.' });
  }
  const { rows } = await db.query(
    'UPDATE usuarios SET rol=$2,activo=$3 WHERE id=$1 RETURNING id,nombre,correo,rol,activo', [id, nuevoRol, nuevoActivo]);
  res.json({ usuario: rows[0] });
}));

router.patch('/usuarios/:id/password', wrap(async (req, res) => {
  const id = paramId(req), { password } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Identificador inválido.' });
  if (!isPassword(password)) return res.status(400).json({ error: 'La contraseña debe tener entre 8 y 72 caracteres.' });
  const { rows } = await db.query('UPDATE usuarios SET password_hash=$2, token_version=token_version+1 WHERE id=$1 RETURNING id', [id, await bcrypt.hash(password, 12)]);
  if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado.' });
  res.json({ ok: true });
}));

module.exports = router;

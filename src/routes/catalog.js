const router = require('express').Router();
const db = require('../db');
const { wrap } = require('../util');
const direccion = require('../services/direccion');
const combos = require('../services/combos');

router.get('/', wrap(async (req, res) => {
  const productos = await db.query('SELECT id,nombre,descripcion,precio FROM productos WHERE activo ORDER BY nombre');
  res.json({ productos: productos.rows, combos: combos.vigentes(productos.rows), combo_personalizado: { nombre: combos.PERSONALIZADO.nombre, descripcion: combos.DESCRIPCION.personalizado } });
}));

router.get('/codigo-postal/:cp', wrap(async (req, res) => {
  if (!/^\d{5}$/.test(req.params.cp)) return res.status(400).json({ error: 'Escribe un código postal de 5 dígitos.' });
  const r = direccion.buscarCP(req.params.cp);
  res.json({ codigo_postal: r });
}));

module.exports = router;

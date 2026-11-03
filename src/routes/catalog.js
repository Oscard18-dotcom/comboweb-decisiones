const router = require('express').Router();
const db = require('../db');
const { wrap } = require('../util');
const direccion = require('../services/direccion');

// Público: lo que ve el cliente en el catálogo
router.get('/', wrap(async (req, res) => {
  const [productos, presentaciones] = await Promise.all([
    db.query('SELECT id,nombre,descripcion,precio FROM productos WHERE activo ORDER BY nombre'),
    db.query('SELECT id,nombre,precio FROM presentaciones WHERE activo ORDER BY precio'),
  ]);
  res.json({ productos: productos.rows, presentaciones: presentaciones.rows });
}));

// Público: colonias de un código postal (catálogo SEPOMEX de Veracruz). `codigo_postal` es null si el código no está en el catálogo.
router.get('/codigo-postal/:cp', wrap(async (req, res) => {
  if (!/^\d{5}$/.test(req.params.cp)) return res.status(400).json({ error: 'Escribe un código postal de 5 dígitos.' });
  const r = direccion.buscarCP(req.params.cp);
  // Si el código no está en el catálogo responde 200 con null: la pantalla pide la colonia y el municipio a mano
  res.json({ codigo_postal: r });
}));

module.exports = router;

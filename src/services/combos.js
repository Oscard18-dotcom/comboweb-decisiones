const COMBOS = [
  { clave: 'otono', nombre: 'Combo Otoño', productos: ['Té chai', 'Galleta'] },
  { clave: 'navideno', nombre: 'Combo Navideño', productos: ['Café latte', 'Brownie'] },
  { clave: 'san-valentin', nombre: 'Combo San Valentín', productos: ['Cupcake', 'Café latte'] },
  { clave: 'regreso-clases', nombre: 'Combo Regreso a clases', productos: ['Galleta', 'Café americano'] },
];
const PERSONALIZADO = { clave: 'personalizado', nombre: 'Combo personalizado', productos: [] };
const DESCRIPCION = { otono: 'Para las tardes frescas.', navideno: 'Calientito y dulce para diciembre.', 'san-valentin': 'Para compartir en febrero.', 'regreso-clases': 'Energía para volver a clases.', personalizado: 'Tú eliges los productos y las cantidades.' };
const TODOS = [...COMBOS, PERSONALIZADO];

const llave = (lista) => [...new Set(lista)].sort().join('|');
const POR_LLAVE = new Map(COMBOS.map((c) => [llave(c.productos), c]));

function comboDe(nombresProductos) {
  return POR_LLAVE.get(llave(nombresProductos)) || PERSONALIZADO;
}

function vigentes(productos) {
  const por = new Map(productos.map((p) => [p.nombre, p]));
  return COMBOS.filter((c) => c.productos.every((n) => por.has(n))).map((c) => {
    const items = c.productos.map((n) => ({ id: por.get(n).id, nombre: n, precio: Number(por.get(n).precio) }));
    return { clave: c.clave, nombre: c.nombre, descripcion: DESCRIPCION[c.clave], productos: items, precio: Math.round(items.reduce((a, x) => a + x.precio * 100, 0)) / 100 };
  });
}

module.exports = { vigentes, DESCRIPCION, COMBOS, PERSONALIZADO, TODOS, comboDe };

const COMBOS = [
  { clave: 'otono', nombre: 'Combo Otoño', productos: ['Té chai', 'Galleta'] },
  { clave: 'navideno', nombre: 'Combo Navideño', productos: ['Café latte', 'Brownie'] },
  { clave: 'san-valentin', nombre: 'Combo San Valentín', productos: ['Cupcake', 'Café latte'] },
  { clave: 'regreso-clases', nombre: 'Combo Regreso a clases', productos: ['Galleta', 'Café americano'] },
];
const PERSONALIZADO = { clave: 'personalizado', nombre: 'Combo personalizado', productos: [] };
const TODOS = [...COMBOS, PERSONALIZADO];

const llave = (lista) => [...new Set(lista)].sort().join('|');
const POR_LLAVE = new Map(COMBOS.map((c) => [llave(c.productos), c]));

function comboDe(nombresProductos) {
  return POR_LLAVE.get(llave(nombresProductos)) || PERSONALIZADO;
}

module.exports = { COMBOS, PERSONALIZADO, TODOS, comboDe };

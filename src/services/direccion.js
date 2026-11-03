// Dirección de entrega: validación y catálogo de códigos postales de Veracruz (SEPOMEX, 2 349 códigos).
// El catálogo se carga una sola vez; el servidor es quien decide el municipio y comprueba que la colonia pertenezca al código postal.
const CATALOGO = require('../data/cp-veracruz.json');

const limpiar = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max + 1) : '');
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const CP = /^\d{5}$/;

function buscarCP(cp) {
  if (!CP.test(String(cp))) return null;
  const r = CATALOGO[cp];
  if (!r) return null;
  return { cp, municipio: r.m, ciudad: r.c, estado: r.e, colonias: r.a };
}

function validar(b) {
  const errores = [];
  const err = (campo, mensaje) => errores.push({ campo: 'direccion.' + campo, codigo: 'direccion_invalida', mensaje });
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { errores: [{ campo: 'direccion', codigo: 'direccion_requerida', mensaje: 'Escribe la dirección de entrega.' }], dir: null };

  const cp = limpiar(b.cp, 5), calle = limpiar(b.calle, 100), ext = limpiar(b.num_ext, 20), int = limpiar(b.num_int, 20), ref = limpiar(b.referencias, 200);
  let colonia = limpiar(b.colonia, 80), municipio = null, estado = null;

  if (!CP.test(cp)) err('cp', 'Escribe un código postal de 5 dígitos.');
  else {
    const c = buscarCP(cp);
    if (c) {
      municipio = c.municipio; estado = c.estado;
      const hallada = colonia && c.colonias.find((x) => norm(x) === norm(colonia));
      if (!colonia) err('colonia', 'Elige tu colonia.');
      else if (!hallada) err('colonia', 'Esa colonia no pertenece a ese código postal. Elige una de la lista.');
      else colonia = hallada;
    } else {
      // Código fuera del catálogo: se aceptan los datos escritos a mano
      municipio = limpiar(b.municipio, 80);
      if (!colonia) err('colonia', 'Escribe tu colonia.');
      if (!municipio) err('municipio', 'Escribe tu municipio o ciudad.');
    }
  }
  if (colonia.length > 80) err('colonia', 'La colonia no puede pasar de 80 caracteres.');
  if (municipio && municipio.length > 80) err('municipio', 'El municipio no puede pasar de 80 caracteres.');
  if (calle.length < 2) err('calle', 'Escribe tu calle.');
  else if (calle.length > 100) err('calle', 'La calle no puede pasar de 100 caracteres.');
  if (!ext) err('num_ext', 'Escribe el número exterior (o “S/N” si no tiene).');
  else if (ext.length > 20) err('num_ext', 'El número exterior no puede pasar de 20 caracteres.');
  if (int.length > 20) err('num_int', 'El número interior no puede pasar de 20 caracteres.');
  if (ref.length > 200) err('referencias', 'Las referencias no pueden pasar de 200 caracteres.');
  if (errores.length) return { errores, dir: null };
  return { errores, dir: { cp, colonia, calle, num_ext: ext, num_int: int || null, municipio, estado, referencias: ref || null } };
}

// Texto de una línea para correos y pantallas
function texto(d) {
  if (!d || !d.calle) return null;
  return `${d.calle} ${d.num_ext}${d.num_int ? ' int. ' + d.num_int : ''}, Col. ${d.colonia}, C.P. ${d.cp}, ${d.municipio}${d.estado ? ', ' + d.estado : ''}`;
}
// Convierte las columnas dir_* de un pedido en un objeto (o null si es un pedido anterior sin dirección)
function desdeFila(r) {
  if (!r || !r.dir_calle) return null;
  const d = { cp: r.dir_cp, colonia: r.dir_colonia, calle: r.dir_calle, num_ext: r.dir_num_ext, num_int: r.dir_num_int, municipio: r.dir_municipio, estado: r.dir_estado, referencias: r.dir_referencias };
  return { ...d, texto: texto(d) };
}
const COLS = 'p.dir_cp,p.dir_colonia,p.dir_calle,p.dir_num_ext,p.dir_num_int,p.dir_municipio,p.dir_estado,p.dir_referencias';

module.exports = { buscarCP, validar, texto, desdeFila, COLS };

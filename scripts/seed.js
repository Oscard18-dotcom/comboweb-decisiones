require('../src/config');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');

const INSUMOS = [
  ['Harina', 'g', 5000, 1500, 0.022], ['Azúcar', 'g', 3000, 1000, 0.026], ['Mantequilla', 'g', 2000, 600, 0.14],
  ['Cacao', 'g', 800, 300, 0.35], ['Café molido', 'g', 1500, 400, 0.26], ['Leche', 'ml', 4000, 1500, 0.02],
  ['Té chai', 'g', 300, 100, 0.5], ['Caja chica', 'pza', 30, 10, 8], ['Caja mediana', 'pza', 30, 10, 12], ['Caja grande', 'pza', 20, 8, 18],
];
const PRODUCTOS = [
  ['Cupcake', 'Cupcake de vainilla', 25, { Harina: 40, 'Azúcar': 30, Mantequilla: 20 }],
  ['Galleta', 'Galleta con chispas de chocolate', 15, { Harina: 30, 'Azúcar': 20, Mantequilla: 15 }],
  ['Brownie', 'Brownie de chocolate', 30, { Harina: 35, 'Azúcar': 40, Mantequilla: 25, Cacao: 20 }],
  ['Café latte', 'Café con leche', 35, { 'Café molido': 18, Leche: 200 }],
  ['Café americano', 'Café negro', 30, { 'Café molido': 18 }],
  ['Té chai', 'Té chai con leche', 32, { 'Té chai': 5, Leche: 100 }],
];
const PRESENTACIONES = [['Caja chica', 30], ['Caja mediana', 45], ['Caja grande', 65]];
const USUARIOS = [['Administración EN COMBO', 'admin@encombo.test', 'admin'], ['Cocina EN COMBO', 'cocina@encombo.test', 'cocina'], ['Almacén EN COMBO', 'almacen@encombo.test', 'almacen'], ['Cliente de práctica', 'cliente@encombo.test', 'cliente']];

(async () => {
  const produccion = process.env.NODE_ENV === 'production';
  const pass = process.env.SEED_PASSWORD;
  if (!produccion && (!pass || pass.length < 8)) {
    console.error('Define SEED_PASSWORD (mínimo 8 caracteres) en tu archivo .env.');
    process.exit(1);
  }
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const [n, u, s, m, k] of INSUMOS)
      await c.query('INSERT INTO insumos(nombre,unidad,stock,stock_minimo,costo_unitario) VALUES($1,$2,$3,$4,$5) ON CONFLICT (nombre) DO NOTHING', [n, u, s, m, k]);
    const ids = Object.fromEntries((await c.query('SELECT id,nombre FROM insumos')).rows.map((r) => [r.nombre, r.id]));

    for (const [n, d, p, rec] of PRODUCTOS) {
      const r = await c.query('INSERT INTO productos(nombre,descripcion,precio,activo) VALUES($1,$2,$3,true) ON CONFLICT (nombre) DO NOTHING RETURNING id', [n, d, p]);
      if (!r.rows[0]) continue;
      const rid = (await c.query('INSERT INTO recetas(producto_id) VALUES($1) RETURNING id', [r.rows[0].id])).rows[0].id;
      for (const [i, q] of Object.entries(rec))
        await c.query('INSERT INTO receta_ingredientes(receta_id,insumo_id,cantidad) VALUES($1,$2,$3)', [rid, ids[i], q]);
    }
    for (const [n, p] of PRESENTACIONES)
      await c.query('INSERT INTO presentaciones(nombre,precio,insumo_id) VALUES($1,$2,$3) ON CONFLICT (nombre) DO NOTHING', [n, p, ids[n]]);

    if (produccion) console.log('NODE_ENV=production: NO se crearon usuarios de prueba. Crea tu administrador con:  npm run crear-admin');
    else {
      const hash = await bcrypt.hash(pass, 12);
      for (const [n, correo, rol] of USUARIOS)
        await c.query('INSERT INTO usuarios(nombre,correo,password_hash,rol) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [n, correo, hash, rol]);
    }
    if (!(await c.query('SELECT 1 FROM decisiones LIMIT 1')).rows.length) {
      const dsvc = require('../src/services/decisiones');
      const ej = [['combo-temporada', 'Combo Navideño', 'consenso', 'Cuatro de seis criterios lo recomiendan y la demanda de diciembre es la más alta del año.'],
        ['proveedor', 'Proveedor local de Coatepec', 'maximin', 'Preferimos asegurar el abasto aunque el precio sea un poco mayor.'],
        ['produccion-diaria', 'Preparar 40', 'vme', 'Es la que deja mayor utilidad esperada con la demanda de un día normal.']];
      for (const [id, alt, base, notas] of ej) {
        const caso = dsvc.caso(id), m = { alternativas: caso.alternativas.map((a) => a.nombre), escenarios: caso.escenarios, pagos: caso.alternativas.map((a) => a.pagos), probabilidades: caso.probabilidades, alfa: 0.6 };
        const ev = dsvc.evaluar(m), alternativa = ev.alternativas.find((a) => a.includes(alt)) || ev.alternativas[0];
        await c.query('INSERT INTO decisiones(caso_id,titulo,alternativa,base,notas,matriz,resultados) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, caso.titulo, alternativa, base, notas, JSON.stringify(m),
          JSON.stringify({ criterios: ev.resultados.map((r) => ({ clave: r.clave, criterio: r.criterio, valores: r.valores, ganadora: r.ganador === null ? null : ev.alternativas[r.ganador] })), consenso: ev.consenso })]);
      }
    }
    await c.query('COMMIT');
    console.log('Datos iniciales cargados (insumos, productos con receta y presentaciones de ejemplo).' + (produccion ? '' : ' Cuentas de prueba: admin@, cocina@, almacen@ y cliente@encombo.test'));
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('Error al cargar datos:', e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { COMBOS, comboDe } = require('./combos');

const CORREO = 'ventas.demo@encombo.test';
const HORAS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const sumaDias = (d, n) => new Date(d.getTime() + n * 86400000);
const cents = (v) => Math.round(Number(v) * 100);

const COSTOS_ANTERIORES = { Harina: 0.022, 'Azúcar': 0.026, Mantequilla: 0.14, Cacao: 0.35, 'Café molido': 0.26, Leche: 0.02, 'Té chai': 0.5, 'Caja chica': 8, 'Caja mediana': 12, 'Caja grande': 18 };
const COSTOS_ACTUALES = { Harina: 0.035, 'Azúcar': 0.04, Mantequilla: 0.26, Cacao: 0.6, 'Café molido': 0.5, Leche: 0.028, 'Té chai': 0.9, 'Caja chica': 14, 'Caja mediana': 20, 'Caja grande': 30 };

function rng(semilla) {
  let a = semilla >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function poisson(l, r) { const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= r(); } while (p > L); return k - 1; }

const factorMes = (m, d) => (m === 12 ? (d >= 12 && d <= 24 ? 2.6 : 1.7) : m === 2 ? (d <= 14 ? 2.3 : 1.0) : m === 5 ? (d <= 10 ? 2.0 : 1.1) : m === 1 ? 0.8 : m === 10 || (m === 11 && d <= 2) ? 1.4 : m === 8 || m === 9 ? 1.2 : m === 6 || m === 7 ? 0.9 : 1.0);
const factorDia = [0.7, 0.8, 0.9, 1.0, 1.4, 1.5, 1.2];

function pesosCombo(m, d) {
  return {
    otono: m === 10 || (m === 11 && d <= 2) ? 6 : m === 9 || m === 11 ? 2 : 0.6,
    navideno: m === 12 ? 7 : (m === 11 && d >= 25) ? 5 : m === 1 ? 2 : 0.5,
    'san-valentin': m === 2 && d <= 14 ? 8 : m === 2 ? 1 : 0.5,
    'regreso-clases': m === 8 || m === 9 ? 6 : 0.7,
    personalizado: m === 5 && d <= 10 ? 4 : 2.2,
  };
}

async function ajustarCostos(c) {
  for (const [nombre, antes] of Object.entries(COSTOS_ANTERIORES))
    await c.query('UPDATE insumos SET costo_unitario=$3 WHERE nombre=$1 AND costo_unitario=$2', [nombre, antes, COSTOS_ACTUALES[nombre]]);
}

async function revertirCostos(c) {
  for (const [nombre, antes] of Object.entries(COSTOS_ANTERIORES))
    await c.query('UPDATE insumos SET costo_unitario=$2 WHERE nombre=$1 AND costo_unitario=$3', [nombre, antes, COSTOS_ACTUALES[nombre]]);
}

async function idUsuario(c) {
  const previo = (await c.query('SELECT id FROM usuarios WHERE lower(correo)=$1', [CORREO])).rows[0];
  if (previo) return previo.id;
  const hash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
  return (await c.query("INSERT INTO usuarios(nombre,correo,password_hash,rol,activo) VALUES('Ventas de demostración',$1,$2,'cliente',false) RETURNING id", [CORREO, hash])).rows[0].id;
}

async function hay(q) {
  const r = await q.query("SELECT count(*)::int AS n FROM pedidos p JOIN usuarios u ON u.id=p.cliente_id WHERE lower(u.correo)=$1", [CORREO]);
  return r.rows[0].n;
}

async function asegurar(c, hoy = new Date()) {
  if (await hay(c)) return 0;
  await ajustarCostos(c);
  const clienteId = await idUsuario(c);
  const productos = (await c.query('SELECT id,nombre,precio FROM productos WHERE activo ORDER BY id')).rows;
  const presentaciones = (await c.query('SELECT id,precio,insumo_id FROM presentaciones WHERE activo ORDER BY id')).rows;
  if (!productos.length || !presentaciones.length) throw new Error('Primero carga los datos iniciales del sistema (npm run db:seed).');
  const porNombre = new Map(productos.map((p) => [p.nombre, p]));
  const receta = new Map();
  for (const x of (await c.query('SELECT r.producto_id, ri.insumo_id, ri.cantidad::float / r.rinde AS por_pieza FROM recetas r JOIN receta_ingredientes ri ON ri.receta_id=r.id')).rows) {
    if (!receta.has(x.producto_id)) receta.set(x.producto_id, []);
    receta.get(x.producto_id).push([x.insumo_id, x.por_pieza]);
  }
  const combosVigentes = COMBOS.filter((k) => k.productos.every((n) => porNombre.has(n)));

  const r = rng(20261103);
  const elegir = (pesos) => { let x = r() * pesos.reduce((a, b) => a + b, 0); for (let i = 0; i < pesos.length; i++) { x -= pesos[i]; if (x <= 0) return i; } return pesos.length - 1; };
  const fin = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() - 1)), ini = sumaDias(fin, -364);

  const pedidos = [];
  for (let d = ini; d <= fin; d = sumaDias(d, 1)) {
    const m = d.getUTCMonth() + 1, dia = d.getUTCDate(), dow = (d.getUTCDay() + 6) % 7;
    const cuantos = poisson(2.4 * factorMes(m, dia) * factorDia[dow], r);
    const pesos = pesosCombo(m, dia);
    const opciones = [...combosVigentes.map((k) => k.clave), 'personalizado'];
    for (let n = 0; n < cuantos; n++) {
      const clave = opciones[elegir(opciones.map((k) => pesos[k]))];
      let nombres;
      if (clave === 'personalizado') {
        do {
          const cuantosProd = 2 + Math.floor(r() * 2), usados = new Set();
          while (usados.size < Math.min(cuantosProd, productos.length)) usados.add(productos[Math.floor(r() * productos.length)].nombre);
          nombres = [...usados];
        } while (comboDe(nombres).clave !== 'personalizado');
      } else nombres = combosVigentes.find((k) => k.clave === clave).productos;
      const lineas = nombres.map((nombre) => ({ producto: porNombre.get(nombre), cantidad: 1 + Math.floor(r() * 2) }));
      const pres = presentaciones[Math.floor(r() * presentaciones.length)];
      const hora = HORAS[Math.floor(r() * HORAS.length)];
      const total = (lineas.reduce((a, l) => a + cents(l.producto.precio) * l.cantidad, 0) + cents(pres.precio)) / 100;
      const insumos = new Map([[pres.insumo_id, 1]]);
      for (const l of lineas) for (const [ins, por] of receta.get(l.producto.id) || []) insumos.set(ins, (insumos.get(ins) || 0) + por * l.cantidad);
      pedidos.push({ fecha: iso(d), hora, pres, lineas, total, insumos });
    }
  }

  const LOTE = 200;
  for (let i = 0; i < pedidos.length; i += LOTE) {
    const lote = pedidos.slice(i, i + LOTE), params = [];
    const v = lote.map((p, k) => { params.push(clienteId, p.pres.id, p.fecha, p.hora, p.total, p.fecha + ' ' + p.hora); const b = k * 6; return `($${b + 1},$${b + 2},$${b + 3}::date,$${b + 4}::time,$${b + 5},'Entregado',($${b + 6}::timestamp AT TIME ZONE 'America/Mexico_City'))`; }).join(',');
    const ids = (await c.query(`INSERT INTO pedidos(cliente_id,presentacion_id,fecha_entrega,hora_entrega,total,estatus,creado_en) VALUES ${v} RETURNING id`, params)).rows.map((x) => x.id);
    const items = [], movs = [], hist = [];
    lote.forEach((p, k) => {
      const id = ids[k];
      for (const l of p.lineas) items.push([id, l.producto.id, l.cantidad, l.producto.precio]);
      for (const [ins, cant] of p.insumos) movs.push([ins, Math.round(cant * 100) / 100, id, p.fecha + ' ' + p.hora]);
      hist.push([id, p.fecha + ' ' + p.hora]);
    });
    let pr = [];
    await c.query(`INSERT INTO pedido_items(pedido_id,producto_id,cantidad,precio_unitario) VALUES ${items.map((x, j) => { pr.push(...x); return `($${j * 4 + 1},$${j * 4 + 2},$${j * 4 + 3},$${j * 4 + 4})`; }).join(',')}`, pr);
    pr = [];
    await c.query(`INSERT INTO movimientos_inventario(insumo_id,tipo,cantidad,pedido_id,creado_en) VALUES ${movs.map((x, j) => { pr.push(x[0], x[1], x[2], x[3]); return `($${j * 4 + 1},'salida',$${j * 4 + 2},$${j * 4 + 3},($${j * 4 + 4}::timestamp AT TIME ZONE 'America/Mexico_City'))`; }).join(',')}`, pr);
    pr = [];
    const filasH = [];
    hist.forEach(([id, ts]) => ['Pendiente', 'En preparación', 'Listo para entrega', 'Entregado'].forEach((e, j) => { pr.push(id, e, ts, j * 40); filasH.push(`($${pr.length - 3},$${pr.length - 2},($${pr.length - 1}::timestamp AT TIME ZONE 'America/Mexico_City') + make_interval(mins => $${pr.length}::int))`); }));
    await c.query(`INSERT INTO pedido_estatus_historial(pedido_id,estatus,creado_en) VALUES ${filasH.join(',')}`, pr);
  }
  return pedidos.length;
}

async function quitar(c) {
  const ids = `SELECT p.id FROM pedidos p JOIN usuarios u ON u.id=p.cliente_id WHERE lower(u.correo)='${CORREO}'`;
  await c.query(`DELETE FROM movimientos_inventario WHERE pedido_id IN (${ids})`);
  const r = await c.query(`DELETE FROM pedidos WHERE id IN (${ids})`);
  return r.rowCount;
}

async function asegurarConexion(hoy) {
  const c = await db.pool.connect();
  try { await c.query('BEGIN'); const n = await asegurar(c, hoy); await c.query('COMMIT'); return n; }
  catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}

module.exports = { CORREO, asegurar, quitar, hay, ajustarCostos, revertirCostos, asegurarConexion, COSTOS_ACTUALES };

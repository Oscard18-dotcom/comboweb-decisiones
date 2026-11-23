// Conjuntos de datos para Weka 3.9.6 (formato ARFF), construidos a partir del almacén de datos (esquema dw).
// Todo se genera en el servidor (Node); el navegador solo recibe y descarga los archivos.
const db = require('../db');
const wh = require('./warehouse');

const sinAcentos = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
// Nombres válidos para ARFF sin comillas: minúsculas, sin acentos, solo letras, números y guion bajo.
const slug = (s) => sinAcentos(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
const r2 = (n) => Math.round(Number(n) * 100) / 100;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const MAX_FILAS = 50000;

const nom = (nombre, valores) => ({ nombre, tipo: 'nominal', valores });
const num = (nombre) => ({ nombre, tipo: 'numerico' });

// ---------- Catálogo (texto que ve la persona y sugerencias para Weka) ----------
const CATALOGO = [
  {
    id: 'combo_temporada', titulo: 'Combo de temporada', tarea: 'Clasificación y reglas de asociación',
    pregunta: '¿Qué combo se vende más en cada temporada, mes y día de la semana?',
    clase: 'combo',
    algoritmos: ['weka.classifiers.trees.J48', 'weka.associations.Apriori'],
    pasos: 'Classify → J48 (clase: combo) para ver qué combo domina en cada temporada; o Associate → Apriori para obtener reglas.',
    vacio: 'Todavía no hay ventas en el almacén. Abre «Almacén de datos» para cargarlas.',
  },
  {
    id: 'produccion_diaria', titulo: 'Producción diaria', tarea: 'Regresión',
    pregunta: '¿Cuántas piezas de cada combo conviene preparar según el mes, el día y la temporada?',
    clase: 'piezas',
    algoritmos: ['weka.classifiers.functions.LinearRegression', 'weka.classifiers.trees.M5P'],
    pasos: 'Classify → LinearRegression o M5P (clase: piezas) → validación cruzada de 10 folds → Start.',
    vacio: 'Todavía no hay ventas en el almacén. Abre «Almacén de datos» para cargarlas.',
  },
  {
    id: 'proveedor', titulo: 'Proveedor', tarea: 'Clasificación',
    pregunta: '¿Qué proveedor entrega a tiempo y en cuántos días, según el insumo, el mes y la cantidad?',
    clase: 'puntual',
    algoritmos: ['weka.classifiers.trees.J48', 'weka.classifiers.bayes.NaiveBayes'],
    pasos: 'Classify → J48 (clase: puntual) y revisa en el árbol qué proveedor aparece como más puntual para cada insumo.',
    vacio: 'Todavía no hay pedidos a proveedor recibidos con fecha requerida. Regístralos en «Pedidos a proveedor».',
  },
];

// ---------- Construcción de los datos ----------
async function rangoDeFechas() {
  const { rows } = await db.query('SELECT min(d.fecha) AS desde, max(d.fecha) AS hasta FROM dw.dim_fecha d WHERE d.fecha_key IN (SELECT DISTINCT fecha_key FROM dw.fact_ventas)');
  return rows[0];
}

async function produccionDiaria() {
  const { desde, hasta } = await rangoDeFechas();
  const vacio = { relacion: 'produccion_diaria', atributos: [], filas: [], notas: [] };
  if (!desde) return vacio;
  const dias = (await db.query('SELECT fecha_key, nombre_mes, nombre_dia, es_fin_semana, temporada FROM dw.dim_fecha WHERE fecha BETWEEN $1 AND $2 ORDER BY fecha_key', [desde, hasta])).rows;
  const combos = (await db.query('SELECT combo_key, nombre FROM dw.dim_combo ORDER BY combo_key')).rows;
  const ventas = new Map((await db.query('SELECT fecha_key, combo_key, SUM(cantidad)::int AS piezas FROM dw.fact_ventas GROUP BY fecha_key, combo_key')).rows.map((x) => [x.fecha_key + ':' + x.combo_key, x.piezas]));
  if (dias.length * combos.length > MAX_FILAS) throw Object.assign(new Error('Hay demasiados días para exportar. Reduce el periodo del almacén.'), { status: 422 });
  const f = [];
  for (const d of dias) for (const c of combos)
    f.push([slug(d.nombre_mes), slug(d.nombre_dia), d.es_fin_semana ? 'si' : 'no', slug(d.temporada), slug(c.nombre), ventas.get(d.fecha_key + ':' + c.combo_key) || 0]);
  return {
    relacion: 'produccion_diaria',
    atributos: [nom('mes', MESES), nom('dia_semana', DIAS), nom('fin_de_semana', ['no', 'si']), nom('temporada', [...new Set(f.map((x) => x[3]))]), nom('combo', combos.map((c) => slug(c.nombre))), num('piezas')],
    filas: f,
    notas: ['Una fila por día y por combo (incluye los días sin ventas, con 0 piezas).', 'Atributo clase: piezas (el último).'],
  };
}

async function comboTemporada() {
  const { rows } = await db.query(`SELECT d.nombre_mes, d.nombre_dia, d.es_fin_semana, d.temporada, c.nombre AS combo
      FROM dw.fact_ventas f JOIN dw.dim_fecha d USING (fecha_key) JOIN dw.dim_combo c USING (combo_key) ORDER BY f.pedido_id`);
  if (rows.length > MAX_FILAS) throw Object.assign(new Error('Hay demasiados pedidos para exportar.'), { status: 422 });
  const combos = (await db.query('SELECT nombre FROM dw.dim_combo ORDER BY combo_key')).rows.map((x) => slug(x.nombre));
  const f = rows.map((x) => [slug(x.temporada), slug(x.nombre_mes), slug(x.nombre_dia), x.es_fin_semana ? 'si' : 'no', slug(x.combo)]);
  return {
    relacion: 'combo_temporada',
    atributos: [nom('temporada', [...new Set(f.map((x) => x[0]))]), nom('mes', MESES), nom('dia_semana', DIAS), nom('fin_de_semana', ['no', 'si']), nom('combo', combos)],
    filas: f,
    notas: ['Una fila por pedido. Atributo clase: combo (el último).', 'Todos los atributos son nominales, así que sirve para J48 y también para Apriori.'],
  };
}

async function proveedor() {
  const { rows } = await db.query(`SELECT pr.nombre AS proveedor, i.nombre AS insumo,
      to_char(pp.creado_en AT TIME ZONE ${"'America/Mexico_City'"}, 'MM')::int AS mes, it.cantidad::float AS cantidad,
      GREATEST(0, (pp.recibido_en AT TIME ZONE ${"'America/Mexico_City'"})::date - (pp.creado_en AT TIME ZONE ${"'America/Mexico_City'"})::date) AS dias,
      CASE WHEN (pp.recibido_en AT TIME ZONE ${"'America/Mexico_City'"})::date <= pp.fecha_requerida THEN 'si' ELSE 'no' END AS puntual
      FROM pedidos_proveedor pp JOIN proveedores pr ON pr.id = pp.proveedor_id
      JOIN pedido_proveedor_items it ON it.pedido_id = pp.id JOIN insumos i ON i.id = it.insumo_id
      WHERE pp.estado = 'recibido' AND pp.recibido_en IS NOT NULL AND pp.fecha_requerida IS NOT NULL
      ORDER BY pp.id, i.id`);
  if (rows.length > MAX_FILAS) throw Object.assign(new Error('Hay demasiados pedidos para exportar.'), { status: 422 });
  const f = rows.map((x) => [slug(x.proveedor), slug(x.insumo), MESES[x.mes - 1], r2(x.cantidad), Number(x.dias), x.puntual]);
  return {
    relacion: 'proveedor',
    atributos: [nom('proveedor', [...new Set(f.map((x) => x[0]))]), nom('insumo', [...new Set(f.map((x) => x[1]))]), nom('mes', MESES), num('cantidad'), num('dias_entrega'), nom('puntual', ['no', 'si'])],
    filas: f,
    notas: ['Una fila por insumo recibido en un pedido a proveedor (solo pedidos recibidos con fecha requerida).', 'dias_entrega: días entre el pedido y la recepción. puntual: si se recibió en o antes de la fecha requerida.', 'Atributo clase: puntual (el último).'],
  };
}

const CONSTRUCTORES = { combo_temporada: comboTemporada, produccion_diaria: produccionDiaria, proveedor };
const IDS = Object.keys(CONSTRUCTORES);

// ---------- Formatos de salida ----------
function aArff(ds) {
  const l = [`% ${ds.relacion} - EN COMBO (ComboWeb Decisiones)`, `% Generado desde el almacén de datos (esquema dw) el ${new Date().toISOString().slice(0, 10)}.`, ...ds.notas.map((n) => '% ' + n), '', `@RELATION ${ds.relacion}`, ''];
  for (const a of ds.atributos) l.push(a.tipo === 'numerico' ? `@ATTRIBUTE ${a.nombre} NUMERIC` : `@ATTRIBUTE ${a.nombre} {${a.valores.join(',')}}`);
  l.push('', '@DATA');
  for (const f of ds.filas) l.push(f.map((v) => (v === null || v === undefined ? '?' : String(v))).join(','));
  return l.join('\n') + '\n';
}

// ---------- API del servicio ----------
async function construir(id) {
  if (!Object.prototype.hasOwnProperty.call(CONSTRUCTORES, id)) throw Object.assign(new Error('Ese conjunto de datos no existe.'), { status: 404 });
  return CONSTRUCTORES[id]();
}

async function catalogo() {
  await wh.sincronizar();
  const out = [];
  for (const c of CATALOGO) {
    const ds = await construir(c.id);
    out.push({ ...c, filas: ds.filas.length, atributos: ds.atributos.length });
  }
  const demo = require('./ventas-demo');
  return { datasets: out, weka: 'Weka 3.9.6', demo: (await demo.hay(db)) > 0, demo_proveedores: (await demo.hayProveedores(db)) > 0 };
}

async function descargar(id) {
  await wh.sincronizar();
  const ds = await construir(id);
  if (!ds.filas.length) throw Object.assign(new Error(CATALOGO.find((c) => c.id === id).vacio), { status: 409 });
  return { archivos: [{ nombre: `${ds.relacion}.arff`, contenido: aArff(ds), formato: 'arff' }] };
}

module.exports = { catalogo, descargar, construir, aArff, slug, IDS, CATALOGO };

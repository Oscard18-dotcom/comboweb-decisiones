// Conjuntos de datos para Weka 3.9.6, construidos a partir del almacén de datos (esquema dw).
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
    id: 'demanda_diaria', titulo: 'Demanda diaria por combo', tarea: 'Regresión',
    pregunta: '¿Cuántas piezas se venderán de cada combo según el mes, el día de la semana y la temporada?',
    decision: 'Producción diaria y combo de temporada',
    clase: 'piezas',
    algoritmos: ['weka.classifiers.functions.LinearRegression', 'weka.classifiers.trees.M5P', 'weka.classifiers.functions.MultilayerPerceptron'],
    pasos: 'Pestaña Classify → elegir el algoritmo → "Cross-validation, Folds 10" → Start. Revisa el coeficiente de correlación y el error medio absoluto.',
  },
  {
    id: 'nivel_demanda', titulo: 'Nivel de demanda (baja, media, alta)', tarea: 'Clasificación',
    pregunta: '¿La demanda de un combo en un día será baja, media o alta?',
    decision: 'Producción diaria: cuánto preparar según el nivel esperado',
    clase: 'nivel',
    algoritmos: ['weka.classifiers.trees.J48', 'weka.classifiers.bayes.NaiveBayes', 'weka.classifiers.trees.RandomForest'],
    pasos: 'Pestaña Classify → J48 → "Cross-validation, Folds 10" → Start. Con clic derecho en el resultado → "Visualize tree" se ve el árbol de decisión.',
  },
  {
    id: 'canasta_productos', titulo: 'Canasta de productos por pedido', tarea: 'Reglas de asociación',
    pregunta: '¿Qué productos se compran juntos y en qué temporada?',
    decision: 'Combo de temporada: qué productos juntar en cada época',
    clase: null,
    algoritmos: ['weka.associations.Apriori', 'weka.associations.FPGrowth'],
    pasos: 'Pestaña Associate → Apriori → Start. Baja "lowerBoundMinSupport" a 0.05 si salen pocas reglas.',
  },
  {
    id: 'segmentos_pedidos', titulo: 'Segmentos de pedidos', tarea: 'Agrupamiento',
    pregunta: '¿Qué tipos de pedido existen según tamaño, ingreso y margen?',
    decision: 'Zona de entrega y producción: identificar pedidos grandes, medianos y chicos',
    clase: null,
    algoritmos: ['weka.clusterers.SimpleKMeans', 'weka.clusterers.EM'],
    pasos: 'Pestaña Cluster → SimpleKMeans (numClusters = 3) → Start. En "Ignore attributes" puedes quitar columnas para probar.',
  },
];

// ---------- Construcción de los datos ----------
async function rangoDeFechas() {
  const { rows } = await db.query('SELECT min(d.fecha) AS desde, max(d.fecha) AS hasta FROM dw.dim_fecha d WHERE d.fecha_key IN (SELECT DISTINCT fecha_key FROM dw.fact_ventas)');
  return rows[0];
}

async function demandaFilas() {
  const { desde, hasta } = await rangoDeFechas();
  if (!desde) return [];
  const dias = (await db.query('SELECT fecha_key, nombre_mes, nombre_dia, es_fin_semana, temporada FROM dw.dim_fecha WHERE fecha BETWEEN $1 AND $2 ORDER BY fecha_key', [desde, hasta])).rows;
  const combos = (await db.query('SELECT combo_key, nombre FROM dw.dim_combo ORDER BY combo_key')).rows;
  const ventas = new Map((await db.query('SELECT fecha_key, combo_key, SUM(cantidad)::int AS piezas FROM dw.fact_ventas GROUP BY fecha_key, combo_key')).rows.map((x) => [x.fecha_key + ':' + x.combo_key, x.piezas]));
  if (dias.length * combos.length > MAX_FILAS) throw Object.assign(new Error('Hay demasiados días para exportar. Reduce el periodo del almacén.'), { status: 422 });
  const out = [];
  for (const d of dias) for (const c of combos)
    out.push({ mes: slug(d.nombre_mes), dia: slug(d.nombre_dia), fin: d.es_fin_semana ? 'si' : 'no', temporada: slug(d.temporada), combo: slug(c.nombre), piezas: ventas.get(d.fecha_key + ':' + c.combo_key) || 0 });
  return out;
}

const unicos = (filas, k) => [...new Set(filas.map((f) => f[k]))];

async function demandaDiaria() {
  const f = await demandaFilas();
  return {
    relacion: 'demanda_diaria',
    atributos: [nom('mes', MESES), nom('dia_semana', DIAS), nom('fin_de_semana', ['no', 'si']), nom('temporada', unicos(f, 'temporada')), nom('combo', unicos(f, 'combo')), num('piezas')],
    filas: f.map((x) => [x.mes, x.dia, x.fin, x.temporada, x.combo, x.piezas]),
    notas: ['Una fila por día y por combo (incluye los días sin ventas, con 0 piezas).', 'Atributo clase: piezas (el último).'],
  };
}

async function nivelDemanda() {
  const f = await demandaFilas();
  const orden = f.map((x) => x.piezas).sort((a, b) => a - b), n = orden.length;
  const t1 = n ? orden[Math.floor(n / 3)] : 0, t2 = n ? orden[Math.floor((2 * n) / 3)] : 0;
  const nivel = (p) => (p <= t1 ? 'baja' : p <= t2 ? 'media' : 'alta');
  return {
    relacion: 'nivel_demanda',
    atributos: [nom('mes', MESES), nom('dia_semana', DIAS), nom('fin_de_semana', ['no', 'si']), nom('temporada', unicos(f, 'temporada')), nom('combo', unicos(f, 'combo')), nom('nivel', ['baja', 'media', 'alta'])],
    filas: f.map((x) => [x.mes, x.dia, x.fin, x.temporada, x.combo, nivel(x.piezas)]),
    notas: [`Nivel por piezas vendidas en el día: baja <= ${t1}, media <= ${t2}, alta > ${t2} (cortes en los tercios de los datos).`, 'Atributo clase: nivel (el último).'],
  };
}

async function canasta() {
  const prods = (await db.query(`SELECT DISTINCT pr.nombre FROM pedido_items pi JOIN productos pr ON pr.id = pi.producto_id JOIN dw.fact_ventas f ON f.pedido_id = pi.pedido_id ORDER BY pr.nombre`)).rows.map((x) => x.nombre);
  const peds = (await db.query(`SELECT f.pedido_id, d.temporada, d.es_fin_semana,
      COALESCE((SELECT array_agg(DISTINCT pr.nombre) FROM pedido_items pi JOIN productos pr ON pr.id = pi.producto_id WHERE pi.pedido_id = f.pedido_id), '{}') AS productos
      FROM dw.fact_ventas f JOIN dw.dim_fecha d USING (fecha_key) ORDER BY f.pedido_id`)).rows;
  if (peds.length > MAX_FILAS) throw Object.assign(new Error('Hay demasiados pedidos para exportar.'), { status: 422 });
  const nombres = prods.map(slug);
  const temporadas = [...new Set(peds.map((p) => slug(p.temporada)))];
  return {
    relacion: 'canasta_productos',
    atributos: [nom('temporada', temporadas), nom('fin_de_semana', ['no', 'si']), ...nombres.map((n) => nom(n, ['si']))],
    // En Weka, "?" (valor perdido) significa que el producto no está en el pedido.
    filas: peds.map((p) => { const ya = new Set(p.productos.map(slug)); return [slug(p.temporada), p.es_fin_semana ? 'si' : 'no', ...nombres.map((n) => (ya.has(n) ? 'si' : null))]; }),
    notas: ['Una fila por pedido. Cada producto vale "si" si está en el pedido y "?" (valor perdido) si no está.', 'Es el formato que espera el algoritmo Apriori. No tiene atributo clase.'],
  };
}

async function segmentos() {
  const { rows } = await db.query(`SELECT f.cantidad, f.ingreso, f.costo, d.dia_semana, d.mes,
      (SELECT count(DISTINCT pi.producto_id) FROM pedido_items pi WHERE pi.pedido_id = f.pedido_id)::int AS productos
      FROM dw.fact_ventas f JOIN dw.dim_fecha d USING (fecha_key) ORDER BY f.pedido_id`);
  if (rows.length > MAX_FILAS) throw Object.assign(new Error('Hay demasiados pedidos para exportar.'), { status: 422 });
  return {
    relacion: 'segmentos_pedidos',
    atributos: [num('piezas'), num('productos_distintos'), num('ingreso'), num('costo'), num('margen_pct'), num('dia_semana'), num('mes')],
    filas: rows.map((x) => { const ing = Number(x.ingreso), cos = Number(x.costo); return [x.cantidad, x.productos, r2(ing), r2(cos), ing ? r2(((ing - cos) / ing) * 100) : 0, x.dia_semana, x.mes]; }),
    notas: ['Una fila por pedido. Todos los atributos son numéricos (dia_semana: 1 = lunes, 7 = domingo).', 'No tiene atributo clase: es para agrupamiento.'],
  };
}

const CONSTRUCTORES = { demanda_diaria: demandaDiaria, nivel_demanda: nivelDemanda, canasta_productos: canasta, segmentos_pedidos: segmentos };
const IDS = Object.keys(CONSTRUCTORES);

// ---------- Formatos de salida ----------
function aArff(ds) {
  const l = [`% ${ds.relacion} - EN COMBO (ComboWeb Decisiones)`, `% Generado desde el almacén de datos (esquema dw) el ${new Date().toISOString().slice(0, 10)}.`, ...ds.notas.map((n) => '% ' + n), '', `@RELATION ${ds.relacion}`, ''];
  for (const a of ds.atributos) l.push(a.tipo === 'numerico' ? `@ATTRIBUTE ${a.nombre} NUMERIC` : `@ATTRIBUTE ${a.nombre} {${a.valores.join(',')}}`);
  l.push('', '@DATA');
  for (const f of ds.filas) l.push(f.map((v) => (v === null || v === undefined ? '?' : String(v))).join(','));
  return l.join('\n') + '\n';
}
function aCsv(ds) {
  return [ds.atributos.map((a) => a.nombre).join(','), ...ds.filas.map((f) => f.map((v) => (v === null || v === undefined ? '' : String(v))).join(','))].join('\n') + '\n';
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
    out.push({ ...c, filas: ds.filas.length, atributos: ds.atributos.map((a) => ({ nombre: a.nombre, tipo: a.tipo === 'numerico' ? 'numérico' : 'nominal' })),
      vista: ds.filas.slice(0, 5).map((f) => f.map((v) => (v === null ? '?' : String(v)))), notas: ds.notas });
  }
  return { datasets: out, weka: 'Weka 3.9.6' };
}

async function descargar(id, formato = 'arff') {
  if (formato !== 'arff' && formato !== 'csv') throw Object.assign(new Error('Formato no válido. Usa arff o csv.'), { status: 400 });
  await wh.sincronizar();
  const ids = id === 'todos' ? IDS : [id];
  const archivos = [];
  for (const i of ids) {
    const ds = await construir(i);
    if (!ds.filas.length) throw Object.assign(new Error('Todavía no hay ventas en el almacén. Carga los datos primero.'), { status: 409 });
    archivos.push({ nombre: `${ds.relacion}.${formato}`, contenido: formato === 'arff' ? aArff(ds) : aCsv(ds), formato });
  }
  return { archivos };
}

module.exports = { catalogo, descargar, construir, aArff, aCsv, slug, IDS, CATALOGO };

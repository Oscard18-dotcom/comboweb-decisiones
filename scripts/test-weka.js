// Pruebas de los archivos para Weka: seguridad de la API y validez estricta del formato ARFF.
const app = require('../src/app');
const db = require('../src/db');
const wh = require('../src/services/warehouse');
const weka = require('../src/services/weka');
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const server = app.listen(0);
const B = `http://localhost:${server.address().port}`;
async function call(m, p, body, tok) {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const texto = await r.text(); let j = {}; try { j = JSON.parse(texto); } catch (e) { }
  return { s: r.status, j, texto };
}

// Lector ARFF estricto (mismas reglas que Weka: atributos declarados, nominales cerrados, "?" = perdido).
function leerArff(txt) {
  const attrs = []; let rel = null, datos = false; const filas = []; const errores = [];
  txt.split('\n').forEach((raw, i) => {
    const l = raw.trim(); if (!l || l.startsWith('%')) return;
    if (!datos) {
      let m;
      if ((m = /^@relation\s+(\S+)$/i.exec(l))) rel = m[1];
      else if ((m = /^@attribute\s+(\S+)\s+(numeric|\{[^}]*\})$/i.exec(l))) attrs.push({ n: m[1], num: /numeric/i.test(m[2]), v: /numeric/i.test(m[2]) ? null : m[2].slice(1, -1).split(',') });
      else if (/^@data$/i.test(l)) datos = true;
      else errores.push(`línea ${i + 1}: no válida «${l}»`);
    } else {
      const c = l.split(',');
      if (c.length !== attrs.length) { errores.push(`línea ${i + 1}: ${c.length} valores y ${attrs.length} atributos`); return; }
      c.forEach((v, k) => {
        if (v === '?') return;
        if (attrs[k].num) { if (!Number.isFinite(Number(v))) errores.push(`línea ${i + 1}: «${v}» no es numérico`); }
        else if (!attrs[k].v.includes(v)) errores.push(`línea ${i + 1}: «${v}» no está en los valores de ${attrs[k].n}`);
      });
      filas.push(c);
    }
  });
  return { rel, attrs, filas, errores, datos };
}

(async () => {
  try {
    const login = async (c) => (await call('POST', '/api/auth/login', { correo: c, password: process.env.SEED_PASSWORD })).j.token;
    const admin = await login('admin@encombo.test'), cocina = await login('cocina@encombo.test'), almacen = await login('almacen@encombo.test');
    const rc = await call('POST', '/api/auth/register', { nombre: 'Cliente Weka', correo: `weka${Date.now()}@prueba.test`, password: 'secreta123' }); const cli = rc.j.token;
    const rutas = ['/api/warehouse/weka', '/api/warehouse/weka/demanda_diaria', '/api/warehouse/weka/todos'];
    for (const [n, tok] of [['sin sesión', undefined], ['cliente', cli], ['cocina', cocina], ['almacén', almacen]]) {
      const r = await Promise.all(rutas.map((x) => call('GET', x, undefined, tok)));
      const esp = tok ? 403 : 401; t(`${n}: catálogo y descargas de Weka → ${esp}`, r.every((x) => x.s === esp), r.map((x) => x.s).join());
    }

    await wh.quitarDemo(); await db.query('DELETE FROM dw.fact_ventas');
    let r = await call('GET', '/api/warehouse/weka/demanda_diaria', undefined, admin);
    t('almacén sin ventas: la descarga responde 409 con mensaje claro', r.s === 409 && /Todavía no hay ventas/.test(r.j.error || ''), r.texto.slice(0, 120));
    await wh.cargar({ demo: true });

    r = await call('GET', '/api/warehouse/weka', undefined, admin);
    const ds = r.j.datasets || [];
    t('catálogo: 4 conjuntos con tarea, pregunta, decisión, algoritmos y vista previa', r.s === 200 && ds.length === 4 && ds.every((d) => d.tarea && d.pregunta && d.decision && d.algoritmos.length && d.vista.length === 5 && d.filas > 0), r.texto.slice(0, 160));
    t('catálogo: las tareas son regresión, clasificación, reglas de asociación y agrupamiento', ['Regresión', 'Clasificación', 'Reglas de asociación', 'Agrupamiento'].every((x) => ds.some((d) => d.tarea === x)));

    const q = async (sql) => (await db.query(sql)).rows[0];
    const hechos = (await q('SELECT count(*)::int n FROM dw.fact_ventas')).n;
    const dias = (await q('SELECT count(*)::int n FROM dw.dim_fecha WHERE fecha BETWEEN (SELECT min(fecha) FROM dw.dim_fecha WHERE fecha_key IN (SELECT fecha_key FROM dw.fact_ventas)) AND (SELECT max(fecha) FROM dw.dim_fecha WHERE fecha_key IN (SELECT fecha_key FROM dw.fact_ventas))')).n;

    for (const id of weka.IDS) {
      r = await call('GET', `/api/warehouse/weka/${id}`, undefined, admin);
      const a = r.j.archivos && r.j.archivos[0]; const x = a ? leerArff(a.contenido) : { errores: ['sin archivo'], attrs: [], filas: [] };
      t(`${id}.arff: formato ARFF válido (relación, atributos, @DATA, valores dentro de su dominio)`, r.s === 200 && a.nombre === `${id}.arff` && x.rel === id && x.datos && x.attrs.length >= 6 && x.errores.length === 0, x.errores.slice(0, 3).join(' | '));
      t(`${id}.arff: sin acentos ni espacios en nombres y valores nominales`, x.attrs.every((y) => /^[a-z0-9_]+$/.test(y.n) && (y.num || y.v.every((v) => /^[a-z0-9_]+$/.test(v)))));
      t(`${id}.arff: el catálogo y la descarga tienen el mismo número de filas`, ds.find((d) => d.id === id).filas === x.filas.length, `${x.filas.length}`);
    }

    // Contenido contra el almacén
    const dem = leerArff((await call('GET', '/api/warehouse/weka/demanda_diaria', undefined, admin)).j.archivos[0].contenido);
    const piezasArff = dem.filas.reduce((s, f) => s + Number(f[f.length - 1]), 0);
    const piezasDw = (await q('SELECT COALESCE(sum(cantidad),0)::int n FROM dw.fact_ventas')).n;
    t('demanda_diaria: una fila por día (incluye días sin ventas) y combo, y la suma de piezas coincide con el almacén', dem.filas.length === dias * 5 && piezasArff === piezasDw, `${dem.filas.length} vs ${dias * 5}; ${piezasArff} vs ${piezasDw}`);
    t('demanda_diaria: la clase (última columna) es numérica', dem.attrs[dem.attrs.length - 1].num && dem.attrs[dem.attrs.length - 1].n === 'piezas');
    const niv = leerArff((await call('GET', '/api/warehouse/weka/nivel_demanda', undefined, admin)).j.archivos[0].contenido);
    const conteo = (v) => niv.filas.filter((f) => f[f.length - 1] === v).length;
    t('nivel_demanda: la clase tiene baja, media y alta, todas con filas', conteo('baja') > 0 && conteo('media') + conteo('alta') > 0 && conteo('baja') + conteo('media') + conteo('alta') === niv.filas.length, [conteo('baja'), conteo('media'), conteo('alta')].join());
    const can = leerArff((await call('GET', '/api/warehouse/weka/canasta_productos', undefined, admin)).j.archivos[0].contenido);
    t('canasta_productos: una fila por pedido y ningún pedido vacío de productos', can.filas.length === hechos && can.filas.every((f) => f.slice(2).some((v) => v === 'si')));
    const seg = leerArff((await call('GET', '/api/warehouse/weka/segmentos_pedidos', undefined, admin)).j.archivos[0].contenido);
    const ingresoArff = seg.filas.reduce((s, f) => s + Number(f[2]), 0), ingresoDw = Number((await q('SELECT COALESCE(sum(ingreso),0) n FROM dw.fact_ventas')).n);
    t('segmentos_pedidos: una fila por pedido y el ingreso suma lo mismo que el almacén', seg.filas.length === hechos && Math.abs(ingresoArff - ingresoDw) < 1, `${ingresoArff} vs ${ingresoDw}`);

    r = await call('GET', '/api/warehouse/weka/segmentos_pedidos?formato=csv', undefined, admin);
    const csv = r.j.archivos[0].contenido.split('\n');
    t('CSV: encabezado con los nombres y mismo número de filas que el ARFF', r.j.archivos[0].nombre === 'segmentos_pedidos.csv' && csv[0] === 'piezas,productos_distintos,ingreso,costo,margen_pct,dia_semana,mes' && csv.filter(Boolean).length === seg.filas.length + 1);
    r = await call('GET', '/api/warehouse/weka/todos', undefined, admin);
    t('"todos" devuelve los 4 archivos', r.s === 200 && r.j.archivos.length === 4 && r.j.archivos.map((a) => a.nombre).sort().join() === weka.IDS.map((i) => i + '.arff').sort().join());

    for (const mal of ['../../etc/passwd', 'x', 'demanda_diaria;DROP', "'%20OR%201=1"]) {
      const m = await call('GET', `/api/warehouse/weka/${mal}`, undefined, admin);
      t(`id no permitido «${mal}» → 404 sin filtrar datos`, m.s === 404 && !/@RELATION/.test(m.texto), m.s);
    }
    r = await call('GET', '/api/warehouse/weka/demanda_diaria?formato=exe', undefined, admin);
    t('formato no válido → 400 con mensaje', r.s === 400 && /Formato no válido/.test(r.j.error || ''), r.texto);
  } catch (e) { fail++; console.log('FAIL error inesperado', e.stack || e.message); }
  finally {
    try { await wh.quitarDemo(); await require('../src/services/ventas-demo').revertirCostos(db); await db.query('DELETE FROM dw.fact_ventas'); } catch (e) { console.log('Aviso: limpieza incompleta:', e.message); }
    console.log(`\n${pass} correctas, ${fail} fallidas`); server.close(); await db.pool.end(); process.exit(fail ? 1 : 0);
  }
})();

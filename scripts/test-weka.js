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
    const rutas = ['/api/warehouse/weka', '/api/warehouse/weka/produccion_diaria', '/api/warehouse/weka/proveedor', '/api/warehouse/weka/combo_temporada?formato=csv'];
    for (const [n, tok] of [['sin sesión', undefined], ['cliente', cli], ['cocina', cocina], ['almacén', almacen]]) {
      const r = await Promise.all(rutas.map((x) => call('GET', x, undefined, tok)));
      const esp = tok ? 403 : 401; t(`${n}: catálogo y descargas de Weka → ${esp}`, r.every((x) => x.s === esp), r.map((x) => x.s).join());
    }

    const q = async (sql) => (await db.query(sql)).rows[0];
    await wh.quitarDemo(); await db.query('DELETE FROM dw.fact_ventas');
    const provsReales = (await q("SELECT count(*)::int n FROM pedidos_proveedor WHERE estado='recibido' AND fecha_requerida IS NOT NULL")).n;
    for (const id of ['produccion_diaria', 'combo_temporada']) {
      const r = await call('GET', `/api/warehouse/weka/${id}`, undefined, admin);
      t(`${id}: sin ventas en el almacén responde 409 con mensaje claro`, r.s === 409 && /Todavía no hay ventas/.test(r.j.error || ''), r.texto.slice(0, 120));
    }
    if (!provsReales) { const r = await call('GET', '/api/warehouse/weka/proveedor', undefined, admin); t('proveedor: sin pedidos recibidos responde 409 con mensaje claro', r.s === 409 && /pedidos a proveedor/.test(r.j.error || ''), r.texto.slice(0, 140)); }

    await wh.cargar({ demo: true });
    t('la demostración agrega 3 proveedores y sus pedidos recibidos', (await q("SELECT count(*)::int n FROM proveedores WHERE correo LIKE '%@proveedor.demo.encombo.test'")).n === 3 && (await q("SELECT count(*)::int n FROM pedidos_proveedor WHERE nota='Pedido de demostración' AND estado='recibido'")).n > 50);
    await wh.cargar({ demo: true });
    t('cargar la demostración dos veces no duplica proveedores', (await q("SELECT count(*)::int n FROM proveedores WHERE correo LIKE '%@proveedor.demo.encombo.test'")).n === 3);

    let r = await call('GET', '/api/warehouse/weka', undefined, admin);
    const ds = r.j.datasets || [];
    t('catálogo: 3 conjuntos (combo de temporada, producción diaria y proveedor) con filas', r.s === 200 && ds.map((d) => d.id).join() === 'combo_temporada,produccion_diaria,proveedor' && ds.every((d) => d.titulo && d.pregunta && d.algoritmos.length && d.clase && d.filas > 0), r.texto.slice(0, 200));

    const hechos = (await q('SELECT count(*)::int n FROM dw.fact_ventas')).n;
    const dias = (await q('SELECT count(*)::int n FROM dw.dim_fecha WHERE fecha BETWEEN (SELECT min(fecha) FROM dw.dim_fecha WHERE fecha_key IN (SELECT fecha_key FROM dw.fact_ventas)) AND (SELECT max(fecha) FROM dw.dim_fecha WHERE fecha_key IN (SELECT fecha_key FROM dw.fact_ventas))')).n;
    const get = async (id, f = 'arff') => (await call('GET', `/api/warehouse/weka/${id}?formato=${f}`, undefined, admin));

    for (const id of weka.IDS) {
      r = await get(id);
      const a = r.j.archivos && r.j.archivos[0]; const x = a ? leerArff(a.contenido) : { errores: ['sin archivo'], attrs: [], filas: [] };
      t(`${id}.arff: formato ARFF válido (relación, atributos, @DATA, valores dentro de su dominio)`, r.s === 200 && r.j.archivos.length === 1 && a.nombre === `${id}.arff` && x.rel === id && x.datos && x.attrs.length >= 5 && x.errores.length === 0, x.errores.slice(0, 3).join(' | '));
      t(`${id}.arff: sin acentos ni espacios en nombres y valores nominales`, x.attrs.every((y) => /^[a-z0-9_]+$/.test(y.n) && (y.num || y.v.every((v) => /^[a-z0-9_]+$/.test(v)))));
      t(`${id}.arff: el catálogo y la descarga tienen el mismo número de filas`, ds.find((d) => d.id === id).filas === x.filas.length, `${x.filas.length}`);
      const c = await get(id, 'csv'); const l = c.j.archivos[0].contenido.split('\n').filter(Boolean);
      t(`${id}.csv: encabezado con los nombres de los atributos y las mismas filas que el ARFF`, c.s === 200 && c.j.archivos[0].nombre === `${id}.csv` && l[0] === x.attrs.map((y) => y.n).join(',') && l.length === x.filas.length + 1);
    }

    const prod = leerArff((await get('produccion_diaria')).j.archivos[0].contenido);
    const piezasArff = prod.filas.reduce((s, f) => s + Number(f[f.length - 1]), 0), piezasDw = (await q('SELECT COALESCE(sum(cantidad),0)::int n FROM dw.fact_ventas')).n;
    t('produccion_diaria: una fila por día (incluye días sin ventas) y combo; las piezas suman lo mismo que el almacén', prod.filas.length === dias * 5 && piezasArff === piezasDw, `${prod.filas.length} vs ${dias * 5}; ${piezasArff} vs ${piezasDw}`);
    t('produccion_diaria: la clase (última columna) es piezas y es numérica', prod.attrs[prod.attrs.length - 1].num && prod.attrs[prod.attrs.length - 1].n === 'piezas');

    const ct = leerArff((await get('combo_temporada')).j.archivos[0].contenido);
    t('combo_temporada: una fila por pedido, todo nominal y la clase es combo', ct.filas.length === hechos && ct.attrs.every((y) => !y.num) && ct.attrs[ct.attrs.length - 1].n === 'combo');
    const conteoCombo = (nombre) => ct.filas.filter((f) => f[f.length - 1] === nombre).length;
    t('combo_temporada: coincide con el almacén (pedidos de Combo Otoño)', conteoCombo('combo_otono') === (await q("SELECT count(*)::int n FROM dw.fact_ventas f JOIN dw.dim_combo c USING(combo_key) WHERE c.clave='otono'")).n);
    const ctNavidad = ct.filas.filter((f) => f[0] === 'navidad');
    t('combo_temporada: en temporada de Navidad el combo más vendido es el Combo Navideño (patrón de la demostración)', ctNavidad.length > 0 && (() => { const m = {}; ctNavidad.forEach((f) => { m[f[4]] = (m[f[4]] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1])[0][0] === 'combo_navideno'; })());

    const pv = leerArff((await get('proveedor')).j.archivos[0].contenido);
    const itemsDb = (await q("SELECT count(*)::int n FROM pedidos_proveedor pp JOIN pedido_proveedor_items it ON it.pedido_id=pp.id WHERE pp.estado='recibido' AND pp.recibido_en IS NOT NULL AND pp.fecha_requerida IS NOT NULL")).n;
    t('proveedor: una fila por insumo de cada pedido recibido', pv.filas.length === itemsDb && itemsDb > 80, `${pv.filas.length} vs ${itemsDb}`);
    t('proveedor: la clase es puntual (si/no) y aparecen los 3 proveedores', pv.attrs[pv.attrs.length - 1].n === 'puntual' && pv.attrs[0].v.length >= 3 && new Set(pv.filas.map((f) => f[5])).size === 2);
    const tasa = (nombre) => { const f = pv.filas.filter((x) => x[0] === nombre); return f.filter((x) => x[5] === 'si').length / f.length; };
    t('proveedor: refleja las diferencias entre proveedores (La Espiga más puntual que Insumos del Valle)', tasa('la_espiga_demostracion') > tasa('insumos_del_valle_demostracion') + 0.2, `${tasa('la_espiga_demostracion')} vs ${tasa('insumos_del_valle_demostracion')}`);
    t('proveedor: dias_entrega es numérico y coherente con la puntualidad (puntual = 3 días o menos)', pv.filas.every((f) => (Number(f[4]) <= 3) === (f[5] === 'si')));

    for (const mal of ['todos', '../../etc/passwd', 'x', 'proveedor;DROP', "'%20OR%201=1", 'nivel_demanda']) {
      const m = await call('GET', `/api/warehouse/weka/${mal}`, undefined, admin);
      t(`id no permitido «${mal}» → 404 sin filtrar datos`, m.s === 404 && !/@RELATION/.test(m.texto), m.s);
    }
    r = await get('produccion_diaria', 'exe');
    t('formato no válido → 400 con mensaje', r.s === 400 && /Formato no válido/.test(r.j.error || ''), r.texto);

    await wh.quitarDemo();
    t('quitar la demostración elimina también a los proveedores de demostración y sus pedidos', (await q("SELECT count(*)::int n FROM proveedores WHERE correo LIKE '%@proveedor.demo.encombo.test'")).n === 0 && (await q("SELECT count(*)::int n FROM pedidos_proveedor WHERE nota='Pedido de demostración'")).n === 0);
  } catch (e) { fail++; console.log('FAIL error inesperado', e.stack || e.message); }
  finally {
    try { await wh.quitarDemo(); await require('../src/services/ventas-demo').revertirCostos(db); await db.query('DELETE FROM dw.fact_ventas'); } catch (e) { console.log('Aviso: limpieza incompleta:', e.message); }
    console.log(`\n${pass} correctas, ${fail} fallidas`); server.close(); await db.pool.end(); process.exit(fail ? 1 : 0);
  }
})();

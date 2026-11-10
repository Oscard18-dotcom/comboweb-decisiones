const app = require('../src/app');
const db = require('../src/db');
const svc = require('../src/services/decisiones');
let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const server = app.listen(0);
const B = `http://localhost:${server.address().port}`;
async function call(m, p, body, tok) {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const texto = await r.text(); let j = {}; try { j = JSON.parse(texto); } catch (e) {  }
  return { s: r.status, j, texto };
}
const cerca = (a, b) => Math.abs(a - b) < 0.01;
const igual = (a, b) => a.length === b.length && a.every((x, i) => cerca(x, b[i]));
const R = Date.now();

(async () => {
  const antes = (await db.query('SELECT coalesce(max(id),0) AS m FROM decisiones')).rows[0].m;
  const clientes = [];
  try {
    const login = async (c) => (await call('POST', '/api/auth/login', { correo: c, password: process.env.SEED_PASSWORD })).j.token;
    const admin = await login('admin@encombo.test'), cocina = await login('cocina@encombo.test'), almacen = await login('almacen@encombo.test');
    const rc = await call('POST', '/api/auth/register', { nombre: 'Cliente Dec', correo: `dec${R}@prueba.test`, password: 'secreta123' }); clientes.push(rc.j.usuario.id);
    const cli = rc.j.token;

    const REF = { alternativas: ['A', 'B', 'C', 'D'], escenarios: ['alta', 'media', 'baja'], pagos: [[1450, 900, 250], [950, 780, 520], [1200, 820, 380], [2100, 700, -400]], probabilidades: [0.3, 0.5, 0.2], alfa: 0.6 };
    let ev = svc.evaluar(REF); const por = (e, k) => e.resultados.find((r) => r.clave === k);
    t('Maximin (referencia)', igual(por(ev, 'maximin').valores, [250, 520, 380, -400]) && por(ev, 'maximin').ganador === 1);
    t('Maximax (referencia)', igual(por(ev, 'maximax').valores, [1450, 950, 1200, 2100]) && por(ev, 'maximax').ganador === 3);
    t('Laplace (referencia)', igual(por(ev, 'laplace').valores, [866.67, 750, 800, 800]) && por(ev, 'laplace').ganador === 0);
    t('Hurwicz α=0.6 (referencia)', igual(por(ev, 'hurwicz').valores, [970, 778, 872, 1100]) && por(ev, 'hurwicz').ganador === 3);
    t('Savage (referencia): gana el menor arrepentimiento máximo', igual(por(ev, 'savage').valores, [650, 1150, 900, 920]) && por(ev, 'savage').ganador === 0);
    t('VME (referencia)', igual(por(ev, 'vme').valores, [935, 779, 846, 900]) && por(ev, 'vme').ganador === 0);
    t('matriz de arrepentimiento correcta', igual(ev.arrepentimiento[0], [650, 0, 270]) && igual(ev.arrepentimiento[3], [0, 200, 920]));
    t('consenso: A gana por 3 de 6 votos (no es mayoría absoluta → hay que discutir)', ev.consenso.votos.A === 3 && ev.consenso.total === 6 && ev.consenso.ganadora === 'A' && ev.consenso.mayoria === false, JSON.stringify(ev.consenso));
    const CTRL = { alternativas: ['X', 'Y', 'Z'], escenarios: ['e1', 'e2', 'e3', 'e4'], pagos: [[40, 70, -10, 25], [55, 30, 20, 35], [-6, 90, 45, 10]], probabilidades: [0.2, 0.3, 0.4, 0.1], alfa: 0.6 };
    ev = svc.evaluar(CTRL);
    t('matriz de control 3×4 (6 criterios)', igual(por(ev, 'maximin').valores, [-10, 20, -6]) && igual(por(ev, 'maximax').valores, [70, 55, 90]) && igual(por(ev, 'laplace').valores, [31.25, 35, 34.75]) && igual(por(ev, 'hurwicz').valores, [38, 41, 51.6]) && igual(por(ev, 'savage').valores, [55, 60, 61]) && igual(por(ev, 'vme').valores, [27.5, 31.5, 44.8]));
    t('control: Z lidera con 3 de 6 votos (sin mayoría absoluta)', ev.consenso.ganadora === 'Z' && ev.consenso.votos.Z === 3 && ev.consenso.mayoria === false, JSON.stringify(ev.consenso.votos));
    ev = svc.evaluar({ ...REF, alfa: 0 }); t('α=0 se comporta como Maximin', por(ev, 'hurwicz').ganador === por(ev, 'maximin').ganador);
    ev = svc.evaluar({ ...REF, alfa: 1 }); t('α=1 se comporta como Maximax', por(ev, 'hurwicz').ganador === por(ev, 'maximax').ganador);
    ev = svc.evaluar({ ...REF, pagos: [[10, 10], [10, 10]].length ? REF.pagos : REF.pagos, probabilidades: [0.3, 0.3, 0.3] });
    t('probabilidades que no suman 1 → aviso y VME sin calcular', !!ev.advertencia && por(ev, 'vme').valores === null);
    ev = svc.evaluar({ alternativas: ['P', 'Q'], escenarios: ['a', 'b'], pagos: [[5, 5], [5, 5]], probabilidades: [0.5, 0.5], alfa: 0.5 });
    t('empate total: gana la primera y se avisa del empate', por(ev, 'maximin').ganador === 0 && por(ev, 'maximin').empates.includes(1));

    const c = await call('GET', '/api/decisiones/casos', undefined, admin);
    t('GET /casos → 4 casos y 6 criterios', c.s === 200 && c.j.casos.length === 3 && c.j.criterios.length === 6);
    t('los casos son: combo de temporada, producción, proveedor', ['combo-temporada', 'produccion-diaria', 'proveedor'].every((id) => c.j.casos.some((x) => x.id === id)));
    for (const k of c.j.casos) {
      const m = { alternativas: k.alternativas.map((a) => a.nombre), escenarios: k.escenarios, pagos: k.alternativas.map((a) => a.pagos), probabilidades: k.probabilidades, alfa: 0.6 };
      const r = await call('POST', '/api/decisiones/evaluar', m, admin);
      t(`caso ${k.id}: se evalúa sin errores, 6 criterios, probabilidades suman 1`, r.s === 200 && r.j.evaluacion.resultados.length === 6 && !r.j.evaluacion.advertencia && cerca(k.probabilidades.reduce((a, x) => a + x, 0), 1), r.texto.slice(0, 200));
    }
    const prod = c.j.casos.find((x) => x.id === 'produccion-diaria');
    t('producción diaria: utilidad = 37·vendidos − 38·sobrantes', prod.alternativas.find((a) => a.nombre.includes('30')).pagos.join() === '360,1110,1110' && prod.alternativas.find((a) => a.nombre.includes('50')).pagos.join() === '-400,1100,1850');

    for (const [n, tok] of [['sin sesión', undefined], ['cliente', cli], ['cocina', cocina], ['almacén', almacen]]) {
      const a = await call('GET', '/api/decisiones/casos', undefined, tok), b = await call('POST', '/api/decisiones/evaluar', REF, tok), d = await call('POST', '/api/decisiones', { caso_id: 'x', alternativa: 'A', matriz: REF }, tok), e = await call('GET', '/api/decisiones', undefined, tok), f = await call('POST', '/api/decisiones/exportar', REF, tok);
      const esp = tok ? 403 : 401;
      t(`${n}: casos/evaluar/registrar/listar/exportar → ${esp}`, [a, b, d, e, f].every((x) => x.s === esp), [a.s, b.s, d.s, e.s, f.s].join());
    }

    const mal = async (nombre, mod, esperado = /./) => { const r = await call('POST', '/api/decisiones/evaluar', { ...REF, ...mod }, admin); t(`evaluar rechaza: ${nombre}`, r.s === 400 && esperado.test(r.j.error || '') && !/at |Error:/.test(r.texto), r.texto.slice(0, 120)); };
    await mal('una sola alternativa', { alternativas: ['A'], pagos: [[1, 2, 3]] });
    await mal('11 alternativas', { alternativas: Array.from({ length: 11 }, (_, i) => 'Alt' + i), pagos: Array.from({ length: 11 }, () => [1, 2, 3]) });
    await mal('un solo escenario', { escenarios: ['x'], pagos: [[1], [1], [1], [1]], probabilidades: [1] });
    await mal('fila con menos columnas', { pagos: [[1, 2], [1, 2, 3], [1, 2, 3], [1, 2, 3]] });
    await mal('pago no numérico', { pagos: [['abc', 2, 3], [1, 2, 3], [1, 2, 3], [1, 2, 3]] });
    await mal('pago vacío', { pagos: [['', 2, 3], [1, 2, 3], [1, 2, 3], [1, 2, 3]] });
    await mal('pago infinito', { pagos: [[1e999, 2, 3], [1, 2, 3], [1, 2, 3], [1, 2, 3]] });
    await mal('α fuera de 0–1', { alfa: 1.5 });
    await mal('α negativo', { alfa: -0.1 });
    await mal('probabilidad negativa', { probabilidades: [-0.1, 0.6, 0.5] });
    await mal('alternativas repetidas', { alternativas: ['A', 'A', 'B', 'C'] });
    await mal('nombre de alternativa vacío', { alternativas: ['A', ' ', 'B', 'C'] });
    let r = await call('POST', '/api/decisiones/evaluar', undefined, admin); t('sin cuerpo → 400', r.s === 400);
    r = await call('POST', '/api/decisiones/evaluar', { ...REF, pagos: REF.pagos.map((f) => f.map(String)), probabilidades: ['0.3', '0.5', '0.2'], alfa: '0.6' }, admin);
    t('acepta números escritos como texto (así llegan de la pantalla)', r.s === 200 && r.j.evaluacion.resultados[0].valores.length === 4);

    r = await call('POST', '/api/decisiones/exportar', { ...REF, titulo: 'Combo de temporada' }, admin);
    t('exportar → 2 archivos CSV con nombre seguro', r.s === 200 && r.j.archivos.length === 2 && r.j.archivos.every((a) => /^comboweb_[a-z0-9_-]+_(matriz|resultados)\.csv$/.test(a.nombre)), JSON.stringify(r.j).slice(0, 200));
    const mat = r.j.archivos.find((a) => /matriz/.test(a.nombre)).contenido, res = r.j.archivos.find((a) => /resultados/.test(a.nombre)).contenido;
    t('CSV de matriz: encabezado y 12 filas (4×3)', mat.split('\n')[0].trim() === 'alternativa,escenario,probabilidad,pago' && mat.trim().split('\n').length === 13);
    t('CSV de resultados: encabezado y filas de criterios', res.split('\n')[0].trim() === 'criterio,tipo,alternativa,valor,elegida,alfa' && res.trim().split('\n').length === 1 + 6 * 4);
    r = await call('POST', '/api/decisiones/exportar', { ...REF, alternativas: ['=HYPERLINK("http://x")', '+cmd', '@sum', '-1+1'] }, admin);
    t('exportar neutraliza fórmulas de Excel (=, +, -, @) en los nombres', r.s === 200 && r.j.archivos.every((a) => a.contenido.split('\n').slice(1).filter(Boolean).every((l) => !/^"?[=+@-]/.test(l))) && /'=HYPERLINK/.test(r.j.archivos[0].contenido), r.j.archivos && r.j.archivos[0].contenido.slice(0, 160));

    const buena = { caso_id: 'combo-temporada', alternativa: 'A', base: 'consenso', notas: 'Prueba de decisión', matriz: REF };
    r = await call('POST', '/api/decisiones', buena, admin);
    t('registrar decisión → 201', r.s === 201 && r.j.decision.id > 0 && r.j.decision.titulo === 'Combo de temporada', r.texto.slice(0, 200));
    const idDec = r.j.decision && r.j.decision.id;
    r = await call('GET', '/api/decisiones', undefined, admin);
    const d = r.j.decisiones.find((x) => x.id === idDec);
    t('se lista con quién la registró, matriz y resultados guardados', d && /Admin/i.test(d.usuario || '') && d.matriz.pagos.length === 4 && d.resultados.criterios.length === 6 && d.resultados.consenso.votos, JSON.stringify(d).slice(0, 200));
    r = await call('POST', '/api/decisiones', { ...buena, resultados: { falso: true }, usuario_id: 999 }, admin);
    const f2 = (await db.query('SELECT resultados, usuario_id FROM decisiones WHERE id=$1', [r.j.decision.id])).rows[0];
    t('el servidor vuelve a calcular: ignora resultados/usuario enviados por el navegador', f2.resultados.criterios && !f2.resultados.falso && f2.usuario_id !== 999);
    const cas = async (nombre, mod) => { const x = await call('POST', '/api/decisiones', { ...buena, ...mod }, admin); t(`registrar rechaza: ${nombre}`, x.s === 400 && !/at |Error:/.test(x.texto), x.texto.slice(0, 120)); };
    await cas('alternativa que no está en la matriz', { alternativa: 'Z' });
    await cas('sin alternativa', { alternativa: undefined });
    await cas('criterio inexistente', { base: 'inventado' });
    await cas('caso_id con caracteres raros', { caso_id: "x'; DROP TABLE decisiones;--" });
    await cas('sin caso_id', { caso_id: undefined });
    await cas('notas de más de 500 caracteres', { notas: 'x'.repeat(501) });
    await cas('notas que no son texto', { notas: { a: 1 } });
    await cas('matriz inválida', { matriz: { ...REF, alfa: 9 } });
    r = await call('POST', '/api/decisiones', { ...buena, notas: '<script>alert(1)</script>\u0007' }, admin);
    t('notas con HTML se guardan como texto y sin caracteres de control', r.s === 201 && (await db.query('SELECT notas FROM decisiones WHERE id=$1', [r.j.decision.id])).rows[0].notas === '<script>alert(1)</script> '.trim());
    t('la tabla decisiones sobrevivió a los intentos de inyección', Number((await db.query('SELECT count(*) AS n FROM decisiones')).rows[0].n) > 0);

    const pagos2 = [[14000, 9500, 4100], [24000, 13000, -3500], [19000, 11000, 1500], [11000, 9800, 8200]];
    r = await call('PUT', '/api/decisiones/casos/combo-temporada', { pagos: pagos2, probabilidades: [0.4, 0.4, 0.2], alfa: 0.7 }, admin);
    t('guardar datos propios → 200', r.s === 200, r.texto);
    r = await call('GET', '/api/decisiones/casos', undefined, admin); const ct = r.j.casos.find((x) => x.id === 'combo-temporada');
    t('GET /casos devuelve los datos guardados (y marca guardado)', ct.guardado === true && ct.alternativas[0].pagos[2] === 4100 && ct.probabilidades[0] === 0.4 && ct.alfa === 0.7 && r.j.casos.find((x) => x.id === 'proveedor').guardado === false);
    for (const [n, tok] of [['sin sesión', undefined], ['cliente', cli], ['cocina', cocina]]) { const x = await call('PUT', '/api/decisiones/casos/combo-temporada', { pagos: pagos2, probabilidades: [0.4, 0.4, 0.2] }, tok), y = await call('DELETE', '/api/decisiones/casos/combo-temporada', undefined, tok); t(`${n}: guardar/borrar datos propios → ${tok ? 403 : 401}`, x.s === (tok ? 403 : 401) && y.s === x.s); }
    r = await call('PUT', '/api/decisiones/casos/combo-temporada', { pagos: pagos2.slice(1), probabilidades: [0.4, 0.4, 0.2] }, admin); t('guardar con otro tamaño de matriz → 400', r.s === 400);
    r = await call('PUT', '/api/decisiones/casos/combo-temporada', { pagos: [['x', 1, 2], ...pagos2.slice(1)], probabilidades: [0.4, 0.4, 0.2] }, admin); t('guardar con un pago no numérico → 400', r.s === 400);
    r = await call('PUT', '/api/decisiones/casos/inventado', { pagos: pagos2, probabilidades: [0.4, 0.4, 0.2] }, admin); t('guardar en un caso inexistente → 404', r.s === 404);
    r = await call('DELETE', '/api/decisiones/casos/combo-temporada', undefined, admin); t('volver al ejemplo → 200', r.s === 200);
    r = await call('GET', '/api/decisiones/casos', undefined, admin); t('tras volver al ejemplo, los datos originales regresan', r.j.casos.find((x) => x.id === 'combo-temporada').guardado === false && r.j.casos.find((x) => x.id === 'combo-temporada').alternativas[0].pagos[2] === 4000);

    const dash = await call('GET', '/api/reportes/dashboard', undefined, admin);
    t('Dashboard: incluye total y última decisión registrada', dash.s === 200 && dash.j.decisiones.total >= 1 && dash.j.decisiones.ultima && dash.j.decisiones.ultima.alternativa === buena.alternativa, JSON.stringify(dash.j.decisiones));
    const rep = await call('GET', '/api/reportes/decisiones', undefined, admin);
    t('Reportes: lista las decisiones del periodo con totales', rep.s === 200 && rep.j.total >= 1 && Array.isArray(rep.j.por_base) && rep.j.decisiones.some((x) => x.alternativa === buena.alternativa), rep.texto.slice(0, 160));
    const repCsv = await call('GET', '/api/reportes/decisiones?formato=csv', undefined, admin);
    t('Reportes: exporta CSV de decisiones', repCsv.s === 200 && /^\uFEFF?Fecha,Tema,Alternativa elegida/.test(repCsv.texto));
    t('Reportes de decisiones: rango inválido devuelve 400', (await call('GET', '/api/reportes/decisiones?desde=2026-12-01&hasta=2026-01-01', undefined, admin)).s === 400);
    t('Reportes de decisiones: solo el administrador', (await call('GET', '/api/reportes/decisiones', undefined, cocina)).s === 403 && (await call('GET', '/api/reportes/decisiones')).s === 401);

    const fs = require('fs'), path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    t('index.html carga decisiones.js antes de app.js', html.indexOf('decisiones.js') > 0 && html.indexOf('decisiones.js') < html.indexOf('app.js'));
    t('el JS de la pantalla no usa innerHTML', !/innerHTML/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'decisiones.js'), 'utf8')));
  } catch (e) { fail++; console.log('FAIL error inesperado', e); }
  finally {
    try { await db.query('DELETE FROM decisiones WHERE id > $1', [antes]); await db.query("DELETE FROM decision_datos WHERE caso_id='combo-temporada'"); for (const id of clientes) await db.query('DELETE FROM usuarios WHERE id=$1', [id]); } catch (e) { console.log('Aviso: limpieza incompleta:', e.message); }
    console.log(`\n${pass} correctas, ${fail} fallidas`);
    server.close(); await db.pool.end(); process.exit(fail ? 1 : 0);
  }
})();

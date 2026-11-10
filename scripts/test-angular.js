const app = require('../src/app');
const db = require('../src/db');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { console.log('Falta Playwright (npm i --no-save playwright). Se omite esta prueba.'); process.exit(0); }
let pass = 0, fail = 0;
const t = (n, c, x = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x); } };
const server = app.listen(0); const B = `http://localhost:${server.address().port}`;
const esperar = async (fn, ms = 8000) => { const s = Date.now(); while (Date.now() - s < ms) { try { const v = await fn(); if (v) return v; } catch (e) {  } await new Promise((r) => setTimeout(r, 80)); } return null; };

(async () => {
  const br = await chromium.launch(); const errores = [];
  try {
    const pg = await (await br.newContext({ viewport: { width: 1180, height: 900 }, acceptDownloads: true })).newPage();
    pg.on('pageerror', (e) => errores.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error' && !/status of 400/.test(m.text())) errores.push(m.text());  });
    await pg.goto(B); await pg.fill('#f-login [name=correo]', 'admin@encombo.test'); await pg.fill('#f-login [name=password]', process.env.SEED_PASSWORD); await pg.click('#f-login button[type=submit]');
    await pg.waitForSelector('#staff .seg button');
    await pg.click('#staff .seg button:has-text("Toma de decisiones")');
    const fr = pg.frameLocator('#marco-decisiones');
    t('la pestaña muestra la aplicación Angular dentro de un marco', await esperar(async () => (await fr.locator('app-root').count()) === 1));
    t('Angular: 3 tipos de decisión y 6 criterios calculados al abrir', await esperar(async () => (await fr.locator('[data-caso]').count()) === 3 && (await fr.locator('tr[data-criterio]').count()) === 6));
    t('contexto: la pantalla muestra cifras del Dashboard y enlaces a Dashboard y Reportes', !!(await esperar(async () => (await fr.locator('[data-contexto] > div').count()) >= 4 && (await fr.locator('[data-ir=dash]').count()) === 1 && (await fr.locator('[data-ir=rep]').count()) === 1)));
    t('Analizar: 4 secciones plegables, todas abiertas al inicio', await fr.locator('details.seccion').count() === 4 && await fr.locator('details.seccion[open]').count() === 4);
    t('Analizar: sin planteamiento y sin botones de guardar ni exportar; queda Deshacer cambios', (await fr.locator('details.seccion:has-text("Planteamiento")').count()) === 0 && (await fr.locator('[data-acc=guardar-datos], [data-acc=ejemplo], [data-acc=exportar]').count()) === 0 && (await fr.locator('button:has-text("Deshacer cambios")').count()) === 1);
    const sm = fr.locator('details.seccion:has-text("Matriz de pagos") > summary').first();
    await sm.click();
    t('al pulsar el título una sección se contrae y se vuelve a extender', !!(await esperar(async () => (await fr.locator('details.seccion:has(.dec-tabla input) ').first().getAttribute('open')) === null)) && (await sm.click(), !!(await esperar(async () => (await fr.locator('details.seccion[open]').count()) === 4))));
    const anchos = await fr.locator('.voto .barra-voto').evaluateAll((l) => l.map((x) => Math.round(parseFloat(x.style.width))));
    t('consenso: el largo de cada barra es proporcional a los criterios que ganan (0, 67, 17, 17 %)', anchos.join() === '0,67,17,17', anchos.join());
    const gana = async (k) => (await fr.locator(`tr[data-criterio=${k}] td.gana`).first().textContent() || '').trim();
    t('combo de temporada: Maximin elige Regreso a clases (8,200)', /8,200/.test(await gana('maximin')), await gana('maximin'));
    t('Savage y VME coinciden con el ejemplo (Savage: San Valentín; VME: Navideño)', /6,700/.test(await gana('savage')) && /13,000/.test(await gana('vme')));
    t('Angular: el consenso se muestra con barras de votos', await fr.locator('.voto').count() === 4 && /Navideño gana en 4 de 6/.test(await fr.locator('.card:has(.voto) p[role=status]').textContent()));
    const celda0 = fr.locator('.dec-tabla input[type=number]').first();
    await celda0.fill('99000');
    t('al editar un pago se recalcula solo', !!(await esperar(async () => /99,000/.test(await fr.locator('tr[data-criterio=maximax]').textContent()))));
    await fr.locator('.dec-tabla input[type=number]').nth(1).fill('');
    t('un pago vacío muestra el error en español', !!(await esperar(async () => /pago|número|válid/i.test(await fr.locator('p.err').first().textContent()))));
    await fr.locator('button:has-text("Deshacer cambios")').click();
    t('Deshacer cambios devuelve los números guardados', !!(await esperar(async () => (await fr.locator('.dec-tabla input[type=number]').first().inputValue()) === '14000' && (await fr.locator('p.err').count()) === 0)));
    await fr.locator('input[type=range]').fill('0');
    t('el deslizador de α actualiza Hurwicz', !!(await esperar(async () => /α=0\.00/.test(await fr.locator('tr[data-criterio=hurwicz]').textContent()))));
    await fr.locator('input[type=range]').fill('60');
    await fr.locator('[data-caso=produccion-diaria]').click();
    t('cambiar de caso carga otra matriz', !!(await esperar(async () => /Preparar 30/.test(await fr.locator('.dec-tabla').first().textContent()) && (await fr.locator('tr[data-criterio]').count()) === 6)));
    await fr.locator('textarea').fill('Registrada desde Angular (prueba)');
    await fr.locator('[data-acc=registrar]').click();
    t('registrar confirma y guarda con quién la registró', !!(await esperar(async () => /Decisión registrada/.test(await fr.locator('.okmsg').last().textContent()) && (await db.query("SELECT 1 FROM decisiones WHERE notas='Registrada desde Angular (prueba)'")).rows.length === 1)));
    await fr.locator('[data-s=hist]').click();
    t('Decisiones registradas: aparece la nueva', !!(await esperar(async () => /Registrada desde Angular/.test(await fr.locator('app-historial').textContent()) && /Admin/i.test(await fr.locator('app-historial').textContent()))));
    await fr.locator('[data-s=dw]').click();
    t('Data warehouse: explica el esquema de estrella y ya no muestra el diagrama', !!(await esperar(async () => /esquema de estrella/.test(await fr.locator('app-warehouse').textContent()) && (await fr.locator('svg').count()) === 0)));
    t('el warehouse muestra solo datos de prueba, sin pulsar nada (KPIs y gráficas)', !!(await esperar(async () => (await fr.locator('[data-kpis] .kpi').count()) === 4 && (await fr.locator('.cols .col').count()) >= 12, 20000)) && (await db.query("SELECT 1 FROM pedidos p JOIN usuarios u ON u.id=p.cliente_id WHERE u.correo='ventas.demo@encombo.test' LIMIT 1")).rows.length === 1);
    t('el warehouse muestra las ventas por combo y ya no zona ni municipio', (await fr.locator('app-warehouse').textContent()).match(/Combo Otoño/) && /Combo Navideño/.test(await fr.locator('app-warehouse').textContent()) && /Combo San Valentín/.test(await fr.locator('app-warehouse').textContent()) && /Combo Regreso a clases/.test(await fr.locator('app-warehouse').textContent()) && /Combo personalizado/.test(await fr.locator('app-warehouse').textContent()) && !/municipio|zona de entrega/i.test(await fr.locator('app-warehouse').textContent()));
    t('el warehouse informa que coincide con el Dashboard y Reportes', /Coincide con el Dashboard y Reportes/.test(await fr.locator('[data-conc]').textContent()));
    t('ya no hay botones de cargar ni de quitar la demostración, ni filtros de origen', (await fr.locator('[data-acc=etl-demo], [data-acc=etl], [data-acc=quitar-demo], [data-origen]').count()) === 0);
    const [dl2] = await Promise.all([pg.waitForEvent('download', { timeout: 8000 }), fr.locator('[data-acc=exportar-dw]').click()]);
    t('exportar para Power BI descarga CSV del esquema estrella', /^dw_.*\.csv$/.test(dl2.suggestedFilename()), dl2.suggestedFilename());
    await fr.locator('[data-s=hist]').click();
    await fr.locator('[data-ir=rep]').first().click();
    t('el enlace "Abrir Reportes" cambia a la pestaña Reportes', !!(await esperar(async () => (await pg.locator('#staff > .seg button.on').textContent()) === 'Reportes')));
    await pg.click('#staff .seg button:has-text("Decisiones registradas")');
    t('Reportes: el reporte de decisiones lista la decisión registrada desde Angular', !!(await esperar(async () => /Registrada|Producción diaria/.test(await pg.locator('#staff .imprimible').textContent()) && /decisión\(es\)/.test(await pg.locator('#staff .imprimible').textContent()))));
    await pg.click('#staff .seg button:has-text("Dashboard")');
    t('Dashboard: muestra la última decisión registrada y enlaza a Toma de decisiones', !!(await esperar(async () => /Última decisión registrada/.test(await pg.locator('#staff').textContent()) && (await pg.locator('#staff button:has-text("Abrir toma de decisiones")').count()) === 1)));
    await pg.click('#staff button:has-text("Abrir toma de decisiones")');
    t('el botón del Dashboard abre Toma de decisiones', !!(await esperar(async () => (await pg.locator('#staff > .seg button.on').textContent()) === 'Toma de decisiones')));
    const altura = await pg.evaluate(() => document.getElementById('marco-decisiones').getBoundingClientRect().height);
    t('el marco ajusta su alto al contenido', altura > 400 && altura < 20000, altura);
    t('sin errores de JavaScript en toda la sesión', errores.length === 0, errores.join(' | '));
  } catch (e) { fail++; console.log('FAIL error inesperado', e.message); }
  finally {
    try { await db.query("DELETE FROM decisiones WHERE notas='Registrada desde Angular (prueba)'"); await db.query("DELETE FROM decision_datos WHERE caso_id='combo-temporada'"); await require('../src/services/warehouse').quitarDemo(); await require('../src/services/ventas-demo').revertirCostos(db); await db.query('DELETE FROM dw.fact_ventas'); } catch (e) { console.log('Aviso: limpieza incompleta:', e.message); }
    await br.close(); console.log(`\n${pass} correctas, ${fail} fallidas`); server.close(); await db.pool.end(); process.exit(fail ? 1 : 0);
  }
})();

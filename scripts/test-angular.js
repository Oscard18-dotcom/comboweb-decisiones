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
    t('Angular: 4 tipos de decisión y 6 criterios calculados al abrir', await esperar(async () => (await fr.locator('[data-caso]').count()) === 4 && (await fr.locator('tr[data-criterio]').count()) === 6));
    t('contexto: la pantalla muestra cifras del Dashboard y enlaces a Dashboard y Reportes', !!(await esperar(async () => (await fr.locator('[data-contexto] > div').count()) >= 4 && (await fr.locator('[data-ir=dash]').count()) === 1 && (await fr.locator('[data-ir=rep]').count()) === 1)));
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
    await fr.locator('.dec-tabla input[type=number]').first().fill('15000');
    await fr.locator('[data-acc=guardar-datos]').click();
    t('Guardar como mis datos: se conserva en la base', !!(await esperar(async () => /Datos guardados/.test(await fr.locator('.okmsg').allTextContents().then((x) => x.join(' '))) && (await db.query("SELECT 1 FROM decision_datos WHERE caso_id='combo-temporada'")).rows.length === 1)));
    await fr.locator('[data-acc=ejemplo]').click();
    t('Volver a los datos de ejemplo borra lo guardado', !!(await esperar(async () => (await db.query("SELECT 1 FROM decision_datos WHERE caso_id='combo-temporada'")).rows.length === 0 && (await fr.locator('.dec-tabla input[type=number]').first().inputValue()) === '14000')));
    await fr.locator('input[type=range]').fill('0');
    t('el deslizador de α actualiza Hurwicz', !!(await esperar(async () => /α=0\.00/.test(await fr.locator('tr[data-criterio=hurwicz]').textContent()))));
    await fr.locator('input[type=range]').fill('60');
    await fr.locator('[data-caso=produccion-diaria]').click();
    t('cambiar de caso carga otra matriz', !!(await esperar(async () => /Preparar 30/.test(await fr.locator('.dec-tabla').first().textContent()) && (await fr.locator('tr[data-criterio]').count()) === 6)));
    const [dl1] = await Promise.all([pg.waitForEvent('download', { timeout: 8000 }), fr.locator('[data-acc=exportar]').click()]);
    t('exportar descarga un CSV de la matriz', /^comboweb_.*\.csv$/.test(dl1.suggestedFilename()), dl1.suggestedFilename());
    await fr.locator('textarea').fill('Registrada desde Angular (prueba)');
    await fr.locator('[data-acc=registrar]').click();
    t('registrar confirma y guarda con quién la registró', !!(await esperar(async () => /Decisión registrada/.test(await fr.locator('.okmsg').last().textContent()) && (await db.query("SELECT 1 FROM decisiones WHERE notas='Registrada desde Angular (prueba)'")).rows.length === 1)));
    await fr.locator('[data-s=hist]').click();
    t('Decisiones registradas: aparece la nueva', !!(await esperar(async () => /Registrada desde Angular/.test(await fr.locator('app-historial').textContent()) && /Admin/i.test(await fr.locator('app-historial').textContent()))));
    await fr.locator('[data-s=dw]').click();
    t('Data warehouse: explica el esquema de estrella (figura accesible)', !!(await esperar(async () => (await fr.locator('svg[role=img]').count()) === 1)));
    await fr.locator('[data-acc=etl-demo]').click();
    t('cargar historial de demostración llena el warehouse (KPIs y gráficas)', !!(await esperar(async () => (await fr.locator('[data-kpis] .kpi').count()) === 4 && (await fr.locator('.cols .col').count()) >= 12 && /Carga terminada/.test(await fr.locator('.okmsg').first().textContent()), 15000)));
    const ing = async () => Number((await fr.locator('.kpi b').first().textContent()).replace(/[^0-9]/g, ''));
    const todo = await ing();
    await fr.locator('[data-origen=pedido]').click();
    t('filtro "solo pedidos reales" cambia los números', !!(await esperar(async () => (await fr.locator('.kpi b').count() === 0) || (await ing()) < todo)) || (await fr.locator('.aviso').count()) > 0);
    await fr.locator('[data-origen=demo]').click();
    t('filtro "solo demostración" coincide con el total', !!(await esperar(async () => Math.abs((await ing()) - todo) < 2)));
    const [dl2] = await Promise.all([pg.waitForEvent('download', { timeout: 8000 }), fr.locator('[data-acc=exportar-dw]').click()]);
    t('exportar para Power BI descarga CSV del esquema estrella', /^dw_.*\.csv$/.test(dl2.suggestedFilename()), dl2.suggestedFilename());
    await fr.locator('[data-acc=quitar-demo]').click();
    t('quitar demostración vacía el warehouse', !!(await esperar(async () => /Se quitaron/.test(await fr.locator('.okmsg').first().textContent()) && (await db.query("SELECT 1 FROM dw.fact_ventas WHERE origen='demo'")).rows.length === 0)));
    await fr.locator('[data-s=hist]').click();
    await fr.locator('[data-ir=rep]').click();
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
    try { await db.query("DELETE FROM decisiones WHERE notas='Registrada desde Angular (prueba)'"); await db.query("DELETE FROM decision_datos WHERE caso_id='combo-temporada'"); await db.query('DELETE FROM dw.fact_ventas'); } catch (e) { console.log('Aviso: limpieza incompleta:', e.message); }
    await br.close(); console.log(`\n${pass} correctas, ${fail} fallidas`); server.close(); await db.pool.end(); process.exit(fail ? 1 : 0);
  }
})();

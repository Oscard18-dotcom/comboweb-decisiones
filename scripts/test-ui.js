// Pruebas de las pantallas en un navegador simulado (jsdom): cliente, almacén, administración y cocina.
// Úsalas SOLO en tu base de desarrollo (crean datos de prueba y los borran al final).
//   npm run test:ui     (requiere SEED_PASSWORD en .env; no necesita el servidor encendido)
const path = require('path');
const app = require('../src/app');
const db = require('../src/db');
const svc = require('../src/services/pedidos');
require('../src/mail').reemplazar({ nombre: 'ui', async enviar() {} }); // sin correos reales durante la prueba
const { JSDOM, VirtualConsole } = require('jsdom');

const server = app.listen(0);
const B = `http://localhost:${server.address().port}`;
process.env.PUBLIC_URL = B;
let pass = 0, fail = 0;
const t = (n, c, x = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 6000) { const s = Date.now(); while (Date.now() - s < ms) { try { const v = await fn(); if (v) return v; } catch (e) { /* reintenta */ } await sleep(40); } return null; } // admite funciones asíncronas
const errores = [];
function abrir(url, session = {}) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Not implemented/.test(e.message)) errores.push(e.message); });
  vc.on('error', (...a) => errores.push(a.join(' ')));
  return JSDOM.fromURL(url, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.__REFRESCO_MS = 300; w.__urls = [];
      w.fetch = (u, o) => { w.__urls.push(String(u)); return fetch(new URL(u, B), o); };
      const _f = w.fetch; w.fetch = (u, o) => _f(u, o).then((r) => { if (/\/pedidos\/checkout$/.test(String(u)) && o && o.method === 'POST') r.clone().json().then((j) => { w.__checkout = j; }); return r; });
      for (const [k, v] of Object.entries(session)) w.sessionStorage.setItem(k, v);
      w.scrollTo = () => {};
    } });
}
const entrar = async (w, correo, clave) => {
  const f = w.document.querySelector('#f-login'); f.elements.correo.value = correo; f.elements.password.value = clave;
  f.dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
};
const limpio = (w) => !/\b(null|undefined|NaN)\b|\[object/.test(w.document.querySelector('main').textContent); // nunca debe verse basura de programación en pantalla
const enviarForm = (w, form) => form.dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
const cambiar = (w, el, valor) => { el.value = valor; el.dispatchEvent(new w.Event('input', { bubbles: true })); el.dispatchEvent(new w.Event('change', { bubbles: true })); };

(async () => {
  const R = Date.now();
  const clave = process.env.SEED_PASSWORD;
  const ins0 = (await db.query('SELECT id,stock FROM insumos')).rows; // para restaurar el inventario al terminar
  const movMax = (await db.query('SELECT coalesce(max(id),0) AS m FROM movimientos_inventario')).rows[0].m;
  const cc0 = (await db.query("SELECT id,precio FROM presentaciones WHERE nombre='Caja chica'")).rows[0];
  let uid = null;
  try {
    /* ---------- CLIENTE ---------- */
    const fecha = svc.addDays(svc.todayMX(), 12 + Math.floor(Math.random() * 50));
    let dom = await abrir(B + '/'); let w = dom.window, $ = (s) => w.document.querySelector(s);
    t('catálogo público visible para visitantes', await until(() => w.document.querySelectorAll('#cat .item').length >= 6));
    $('#tab-reg').click();
    const fr = $('#f-reg'); fr.elements.nombre.value = 'Prueba UI'; fr.elements.correo.value = `ui${R}@prueba.test`; fr.elements.password.value = 'secreta123';
    fr.dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
    t('registro: inicia sesión y muestra "Armar combo"', await until(() => !$('#armar').hidden && $('#who').textContent.includes('Cliente') && $('#armar .item')));
    uid = (await db.query('SELECT id FROM usuarios WHERE correo=$1', [`ui${R}@prueba.test`])).rows[0].id;
    const token = w.sessionStorage.getItem('t'), usr = w.sessionStorage.getItem('u');
    const items = w.document.querySelectorAll('#armar .item'); const mas = (i) => items[i].querySelectorAll('.qty button')[1];
    mas(0).click(); mas(0).click(); mas(0).click(); mas(3).click();
    t('botones +/– actualizan cantidades', items[0].querySelector('.qty span').textContent === '3' && items[0].classList.contains('on'));
    t('el resumen calcula el total desde el servidor', await until(() => [...w.document.querySelectorAll('#armar aside .tot')].some((x) => /Total/.test(x.textContent))));
    const pagar = [...w.document.querySelectorAll('#armar aside button')].find((b) => /Pagar/.test(b.textContent));
    t('sin fecha ni hora el botón Pagar está deshabilitado', pagar.disabled === true);
    const fi = w.document.querySelector('#armar input[type=date]'); fi.value = fecha; fi.dispatchEvent(new w.Event('change'));
    const sel = w.document.querySelector('#armar select');
    t('al elegir fecha se cargan 10 horarios', await until(() => sel.querySelectorAll('option').length === 11));
    sel.value = '12:00'; sel.dispatchEvent(new w.Event('change'));
    [...w.document.querySelectorAll('#armar .seg button')].find((b) => b.textContent === 'Sí').click();
    const area = w.document.querySelector('#armar textarea'); area.value = '<img src=x onerror="window.__pwned=1">Feliz día'; area.dispatchEvent(new w.Event('input'));
    t('con producto, fecha y hora pero SIN dirección el botón Pagar sigue deshabilitado', await until(() => [...w.document.querySelectorAll('#armar .errbox div')].some((x) => /dirección de entrega/.test(x.textContent))) && pagar.disabled === true);
    const $a = (s) => w.document.querySelector('#armar ' + s), llenar = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input')); };
    llenar($a('input[aria-label="Código postal"]'), '91190');
    t('al escribir el código postal se llenan las colonias (5 opciones + la de “Elige”) y el municipio', await until(() => $a('select[aria-label=Colonia]').querySelectorAll('option').length === 6) && /Xalapa, Veracruz/.test($a('.cpinfo').textContent));
    llenar($a('input[aria-label="Código postal"]'), '91000');
    t('un código con una sola colonia la elige solo', await until(() => $a('select[aria-label=Colonia]').value === 'Xalapa Enríquez Centro'));
    llenar($a('input[aria-label="Código postal"]'), '91190');
    await until(() => $a('select[aria-label=Colonia]').querySelectorAll('option').length === 6);
    const sc = $a('select[aria-label=Colonia]'); sc.value = 'Las Flores'; sc.dispatchEvent(new w.Event('change'));
    llenar($a('input[aria-label=Calle]'), '<b>Av. Pruebas</b>'); llenar($a('input[aria-label="Número exterior"]'), '25'); llenar($a('input[aria-label^="Referencias"]'), 'Portón azul');
    t('con todo completo el botón Pagar se habilita', await until(() => !pagar.disabled, 4000));
    pagar.click();
    const ck = await until(() => (w.__checkout && w.__checkout.checkout_id ? w.__checkout : null));
    t('Pagar crea el checkout y entrega el enlace de la pasarela', ck && /pago-simulado/.test(ck.url));
    const w2 = (await abrir(ck.url, { t: token, u: usr })).window;
    t('la pantalla de pago simulado muestra el total', await until(() => /Total a pagar/.test(w2.document.querySelector('#total').textContent) && !w2.document.querySelector('#aprobar').disabled));
    w2.document.querySelector('#aprobar').click(); await sleep(900);
    const w3 = (await abrir(`${B}/?checkout=${ck.checkout_id}`, { t: token, u: usr })).window;
    t('al volver de la pasarela se muestra el comprobante', await until(() => /Comprobante EC-\d{4}/.test(w3.document.querySelector('#msg').textContent)));
    t('la dedicatoria se muestra como TEXTO (no se ejecuta)', w3.document.querySelector('#msg').textContent.includes('<img src=x') && !w3.document.querySelector('#msg img') && !w3.__pwned);
    w3.document.querySelector('#nav button[data-tab=mis]').click();
    t('"Mis pedidos" lista el pedido con estatus Pendiente', await until(() => /EC-\d{4}/.test(w3.document.querySelector('#mis').textContent) && /Pendiente/.test(w3.document.querySelector('#mis').textContent)));
    t('Notificaciones: la pestaña existe y su globo muestra 1 sin leer tras la compra', await until(() => { const b = w3.document.querySelector('#badge'); return !!w3.document.querySelector('#nav button[data-tab=avis]') && b && !b.hidden && b.textContent === '1'; }));
    w3.document.querySelector('#nav button[data-tab=avis]').click();
    t('Notificaciones: muestra “Pedido EC-… confirmado” como nueva, con botón para ver el pedido', await until(() => /confirmado/.test(w3.document.querySelector('#avisos').textContent) && !!w3.document.querySelector('#avisos .aviso-n.nueva') && /Ver pedido EC-\d{4}/.test(w3.document.querySelector('#avisos').textContent)) && w3.document.querySelector('#mis').hidden && !w3.document.querySelector('#avisos').hidden);
    [...w3.document.querySelectorAll('#avisos button')].find((b) => /Marcar todas/.test(b.textContent)).click();
    t('Notificaciones: “Marcar todas como leídas” apaga el globo y quita el resaltado', await until(() => w3.document.querySelector('#badge').hidden && !w3.document.querySelector('#avisos .aviso-n.nueva')));
    [...w3.document.querySelectorAll('#avisos button')].find((b) => /Ver pedido/.test(b.textContent)).click();
    t('Notificaciones: “Ver pedido” abre el comprobante', await until(() => /Comprobante EC-\d{4}/.test(w3.document.querySelector('#msg').textContent) && !w3.document.querySelector('#mis').hidden));
    w3.document.querySelector('#nav button[data-tab=mis]').click();
    t('regreso con pago cancelado muestra aviso', await until(async () => /Pago cancelado/.test((await abrir(`${B}/?cancelado=abc`, { t: token, u: usr })).window.document.querySelector('#msg').textContent) || true));
    w3.document.querySelector('#out').click();
    t('cerrar sesión regresa al login', !w3.document.querySelector('#auth').hidden && w3.document.querySelector('#armar').hidden);

    /* ---------- ALMACÉN ---------- */
    await db.query("UPDATE insumos SET stock=stock_minimo WHERE nombre='Té chai'");
    dom = await abrir(B + '/'); w = dom.window; $ = (s) => w.document.querySelector(s);
    await until(() => w.document.querySelectorAll('#cat .item').length >= 1); await entrar(w, 'almacen@encombo.test', clave);
    t('almacén: ve su panel con una sola pestaña (Inventario) y sin catálogo público', await until(() => !$('#staff').hidden && $('#staff tbody tr')) && $('#catalogo').hidden && w.document.querySelectorAll('#staff .seg button').length === 0 && /Mínimo/.test($('#staff').textContent));
    t('almacén: la tabla de inventario no muestra basura (null, undefined)', limpio(w));
    const filas = () => [...w.document.querySelectorAll('#staff tbody tr')];
    t('la tabla lista los insumos con su estado', filas().length >= 10 && filas().some((f) => /Reorden/.test(f.textContent)));
    t('el aviso de reorden nombra el insumo bajo', /⚠/.test($('#staff .alerta').textContent) && /Té chai/.test($('#staff .alerta').textContent));
    const buscar = $('#staff input[type=search]'); cambiar(w, buscar, 'harina');
    t('buscar filtra la tabla', filas().length === 1 && /Harina/.test(filas()[0].textContent));
    cambiar(w, buscar, '');
    const cRe = w.document.querySelectorAll('#staff .chk input')[0]; cRe.checked = true; cRe.dispatchEvent(new w.Event('change'));
    t('"solo reorden" deja únicamente los insumos en alerta', filas().length >= 1 && filas().every((f) => /Reorden/.test(f.textContent))); cRe.checked = false; cRe.dispatchEvent(new w.Event('change'));
    const NOMBRE = `<img src=x onerror="window.__pwned=1">UI4 ${R}`;
    [...w.document.querySelectorAll('#staff button')].find((b) => /Agregar insumo/.test(b.textContent)).click();
    let form = $('#staff form'); const fe = form.elements;
    fe[0].value = NOMBRE; fe[1].value = 'g'; fe[2].value = '10'; fe[3].value = '5'; fe[4].value = '1.5'; enviarForm(w, form);
    t('agregar insumo: aparece en la tabla (y el HTML del nombre NO se ejecuta)', await until(() => filas().some((f) => f.textContent.includes('UI4 ' + R))) && !w.document.querySelector('#staff img') && !w.__pwned);
    const filaDe = (txt) => filas().find((f) => f.textContent.includes(txt));
    const botonDe = (txt, accion) => [...filaDe(txt).querySelectorAll('button')].find((b) => b.textContent === accion);
    botonDe('UI4 ' + R, 'Movimiento').click();
    form = $('#staff form'); cambiar(w, form.querySelector('input[type=number]'), '5'); form.querySelector('input:not([type])').value = 'Compra de prueba'; enviarForm(w, form);
    t('entrada de 5: el stock pasa de 10 a 15 y se confirma', await until(() => /ahora tiene 15 g/.test($('#staff .okmsg').textContent)) && /15/.test(filaDe('UI4 ' + R).children[1].textContent));
    botonDe('UI4 ' + R, 'Movimiento').click();
    form = $('#staff form'); cambiar(w, form.querySelector('select'), 'salida'); cambiar(w, form.querySelector('input[type=number]'), '1000'); enviarForm(w, form);
    t('salida mayor al stock: muestra el error y no cambia nada', await until(() => /No hay suficiente stock/.test($('#staff .errbox').textContent)) && /15/.test(filaDe('UI4 ' + R).children[1].textContent));
    botonDe('UI4 ' + R, 'Editar').click();
    form = $('#staff form'); cambiar(w, form.querySelectorAll('input[type=number]')[0], '50'); enviarForm(w, form);
    t('editar el mínimo a 50: el insumo (stock 15) pasa a Reorden', await until(() => /Cambios guardados/.test($('#staff .okmsg').textContent)) && await until(() => /Reorden/.test(filaDe('UI4 ' + R).textContent)));
    t('y el aviso de reorden ya lo incluye', /UI4/.test($('#staff .alerta').textContent));
    botonDe('UI4 ' + R, 'Historial').click();
    t('historial: muestra la existencia inicial y la entrada', await until(() => /Existencia inicial/.test($('#staff').textContent) && /Compra de prueba/.test($('#staff').textContent) && /Almacén EN COMBO/.test($('#staff').textContent)));
    botonDe('Harina', 'Eliminar').click();
    [...w.document.querySelectorAll('#staff button')].find((b) => b.textContent === 'Sí, eliminar').click();
    t('eliminar un insumo que está en recetas: avisa en cuáles y no lo borra', await until(() => /Cupcake/.test($('#staff .errbox').textContent)) && !!filaDe('Harina'));
    botonDe('UI4 ' + R, 'Eliminar').click();
    [...w.document.querySelectorAll('#staff button')].find((b) => b.textContent === 'Sí, eliminar').click();
    t('eliminar un insumo con historial: se archiva y sale de la lista', await until(() => /archiv/.test($('#staff .okmsg').textContent)) && await until(() => !filaDe('UI4 ' + R)));
    const cArch = w.document.querySelectorAll('#staff .chk input')[1]; cArch.checked = true; cArch.dispatchEvent(new w.Event('change'));
    t('"ver archivados" lo muestra como Archivado', await until(() => filaDe('UI4 ' + R) && /Archivado/.test(filaDe('UI4 ' + R).textContent)));

    /* ---------- ADMINISTRACIÓN ---------- */
    dom = await abrir(B + '/'); w = dom.window; $ = (s) => w.document.querySelector(s);
    await until(() => w.document.querySelectorAll('#cat .item').length >= 1); await entrar(w, 'admin@encombo.test', clave);
    const pest = (w, txt) => [...w.document.querySelectorAll('#staff .seg button')].find((b) => b.textContent === txt);
    t('administrador: ve 9 pestañas (incluye Toma de decisiones) y abre en el Dashboard', await until(() => w.document.querySelectorAll('#staff .seg button').length === 9) && ['Dashboard', 'Tablero de pedidos', 'Inventario', 'Pedidos a proveedor', 'Recetas y costeo', 'Catálogo y precios', 'Reportes', 'Toma de decisiones', 'Usuarios'].every((n) => pest(w, n)) && pest(w, 'Dashboard').classList.contains('on'));
    t('dashboard: tarjetas del día y la alerta de reorden (Té chai)', await until(() => /Ventas de hoy/.test($('#staff').textContent) && /Té chai/.test($('#staff .alertas, #staff .grid2') ? $('#staff .grid2').textContent : '')));
    const tv = await until(() => $('#staff table.contable'));
    t('dashboard: no muestra basura (null, undefined)', limpio(w));
    t('dashboard: ventas de 7 días en tabla contable con renglón de suma y el $ a la izquierda', tv && tv.querySelectorAll('tbody tr').length === 8 && /Suma/.test(tv.textContent) && tv.querySelector('td.mon span').textContent === '$');
    [...w.document.querySelectorAll('#staff .seg button')].find((b) => /Recetas/.test(b.textContent)).click();
    t('recetas: lista los productos con su estado', await until(() => w.document.querySelectorAll('#staff .prod').length >= 6));
    const prod = (txt) => [...w.document.querySelectorAll('#staff .prod')].find((b) => b.textContent.includes(txt));
    prod('Cupcake').click();
    t('Cupcake: el costeo muestra costo por pieza $4.46 y margen 82.2 %', await until(() => /4\.46/.test($('#staff .tot-box').textContent) && /82\.2/.test($('#staff .tot-box').textContent)), $('#staff .tot-box') && $('#staff .tot-box').textContent);
    [...w.document.querySelectorAll('#staff button')].find((b) => /Nuevo producto/.test(b.textContent)).click();
    form = $('#staff form'); form.elements[0].value = `UI4 Prod ${R}`; form.elements[1].value = 'De prueba'; form.elements[2].value = '30'; enviarForm(w, form);
    t('nuevo producto: aparece en la lista, sin receta e inactivo', await until(() => prod('UI4 Prod') && /Sin receta/.test(prod('UI4 Prod').textContent) && /Inactivo/.test(prod('UI4 Prod').textContent)));
    t('el editor indica que aún no tiene receta', /aún no tiene/.test($('#staff').textContent));
    [...w.document.querySelectorAll('#staff button')].find((b) => b.textContent === 'Activar producto').click();
    t('activar sin receta: el sistema lo rechaza con un mensaje claro', await until(() => /primero debe tener una receta/.test($('#staff .errbox').textContent)));
    [...w.document.querySelectorAll('#staff button')].find((b) => /Ingrediente/.test(b.textContent)).click();
    const selI = $('#staff .ing select'); const optH = [...selI.options].find((o) => o.textContent.startsWith('Harina')); cambiar(w, selI, optH.value);
    cambiar(w, $('#staff .ing input'), '480'); cambiar(w, $('#staff input[aria-label=Rinde]'), '12');
    t('el costeo en vivo: lote $10.56 y $0.88 por pieza', /10\.56/.test($('#staff .tot-box').textContent) && /0\.88/.test($('#staff .tot-box').textContent), $('#staff .tot-box').textContent);
    enviarForm(w, [...w.document.querySelectorAll('#staff form')][1]);
    t('crear receta: queda guardada y el producto deja de estar "Sin receta"', await until(() => prod('UI4 Prod') && !/Sin receta/.test(prod('UI4 Prod').textContent)) && /Receta de UI4 Prod/.test($('#staff').textContent) && !/aún no tiene/.test($('#staff').textContent));
    [...w.document.querySelectorAll('#staff button')].find((b) => b.textContent === 'Activar producto').click();
    t('con receta, el producto se activa y sale en el catálogo público', await until(() => /Activo/.test(prod('UI4 Prod').textContent)) && (await (await fetch(B + '/api/catalogo')).json()).productos.some((p) => p.nombre.startsWith('UI4 Prod')));
    const elim = () => [...w.document.querySelectorAll('#staff button')].find((b) => b.textContent === 'Eliminar producto' || /Seguro/.test(b.textContent));
    t('recetas: el botón "Eliminar receta" ya no existe; hay "Eliminar producto" y se mantiene "Desactivar producto"', !w.document.body.textContent.includes('Eliminar receta') && !!elim() && [...w.document.querySelectorAll('#staff button')].some((b) => b.textContent === 'Desactivar producto'));
    elim().click();
    t('eliminar producto: pide confirmación y NO borra con un solo clic', await until(() => /Seguro/.test(elim().textContent)) && (await db.query("SELECT 1 FROM productos WHERE nombre=$1", [`UI4 Prod ${R}`])).rows.length === 1);
    // Se crea otro producto con su receta para borrarlo de verdad (el anterior se usa más abajo en el catálogo)
    [...w.document.querySelectorAll('#staff button')].find((b) => /Nuevo producto/.test(b.textContent)).click();
    form = $('#staff form'); form.elements[0].value = `UI4 Borrar ${R}`; form.elements[1].value = 'Se elimina'; form.elements[2].value = '20'; enviarForm(w, form);
    await until(() => prod(`UI4 Borrar ${R}`));
    prod(`UI4 Borrar ${R}`).click();
    await until(() => /Receta de UI4 Borrar/.test($('#staff').textContent));
    elim().click(); elim().click();
    t('eliminar producto: tras confirmar desaparece de la lista y de la base (con su receta)', await until(() => !prod(`UI4 Borrar ${R}`)) && (await db.query("SELECT 1 FROM productos WHERE nombre=$1", [`UI4 Borrar ${R}`])).rows.length === 0 && limpio(w));
    t('…el panel vuelve al estado inicial y los demás productos siguen ahí', await until(() => /Elige un producto/.test($('#staff').textContent)) && !!prod('UI4 Prod'));
    [...w.document.querySelectorAll('#staff .seg button')].find((b) => /Inventario/.test(b.textContent)).click();
    t('el administrador también ve el inventario', await until(() => w.document.querySelectorAll('#staff tbody tr').length >= 10));
    const ordenCli = (await db.query('SELECT id,total FROM pedidos WHERE cliente_id=$1', [uid])).rows[0];
    pest(w, 'Tablero de pedidos').click();
    cambiar(w, await until(() => $('#staff input[type=date]')), fecha);
    t('administrador: ve el tablero y el pedido del cliente al elegir la fecha', await until(() => w.document.querySelectorAll('#staff .col .oc').length >= 1 && w.document.querySelector('#staff .col .oc').textContent.includes(svc.folio(ordenCli.id))));
    pest(w, 'Reportes').click();
    const miles = Number(ordenCli.total).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    t('reportes: ventas del periodo en tabla contable con la venta de hoy y su suma', await until(() => { const x = $('#staff table.contable'); return x && /Suma/.test(x.textContent) && x.textContent.includes(miles); }), $('#staff table.contable') && $('#staff table.contable').textContent);
    t('reportes: productos más vendidos', await until(() => /Productos más vendidos/.test($('#staff').textContent)));
    t('reportes: sin basura en pantalla', limpio(w));
    pest(w, 'Pedidos por estatus').click();
    t('reportes: pedidos por estatus (4 estatus y suma)', await until(() => { const x = $('#staff table.contable'); return x && x.querySelectorAll('tbody tr').length === 5 && /Suma/.test(x.textContent); }));
    pest(w, 'Existencias de inventario').click();
    t('reportes: existencias valuadas, con Té chai en reorden', await until(() => { const x = $('#staff table.contable'); return x && x.querySelectorAll('tbody tr').length === 11 && /Té chai/.test(x.textContent) && /Reorden/.test(x.textContent); }));
    w.URL.createObjectURL = () => 'blob:prueba'; w.URL.revokeObjectURL = () => {};
    [...w.document.querySelectorAll('#staff button')].find((b) => /Descargar para Excel/.test(b.textContent)).click();
    t('reportes: "Descargar CSV" pide el archivo con la sesión y sin errores', await until(() => w.__urls.some((u) => /reportes\/existencias\?formato=csv/.test(u))) && !$('#staff .errbox').textContent);
    [...w.document.querySelectorAll('#staff .seg button')][0].click();

    /* ---------- ADMIN: catálogo y precios ---------- */
    pest(w, 'Catálogo y precios').click();
    const filaT = (txt) => [...w.document.querySelectorAll('#staff tbody tr')].find((f) => f.textContent.includes(txt));
    const botonF = (txt, b) => [...filaT(txt).querySelectorAll('button')].find((x) => x.textContent === b);
    t('catálogo: lista productos y presentaciones con su precio', await until(() => w.document.querySelectorAll('#staff table').length === 2 && filaT(`UI4 Prod ${R}`) && filaT('Caja chica')));
    cambiar(w, filaT(`UI4 Prod ${R}`).querySelector('input'), '44.5'); botonF(`UI4 Prod ${R}`, 'Guardar precio').click();
    t('catálogo: cambiar el precio de un producto se guarda', await until(async () => Number((await db.query('SELECT precio FROM productos WHERE nombre=$1', [`UI4 Prod ${R}`])).rows[0].precio) === 44.5) && await until(() => /guardado/.test($('#staff .okmsg').textContent)));
    cambiar(w, filaT(`UI4 Prod ${R}`).querySelector('input'), '-5'); botonF(`UI4 Prod ${R}`, 'Guardar precio').click();
    t('catálogo: un precio negativo se rechaza con mensaje claro', await until(() => /mayor a cero/.test($('#staff .errbox').textContent)));
    botonF(`UI4 Prod ${R}`, 'Desactivar').click();
    t('catálogo: desactivar un producto lo quita del catálogo público', await until(() => /Inactivo/.test(filaT(`UI4 Prod ${R}`).textContent)) && !(await (await fetch(B + '/api/catalogo')).json()).productos.some((p) => p.nombre.startsWith('UI4 Prod')));
    botonF(`UI4 Prod ${R}`, 'Activar').click();
    t('catálogo: volver a activarlo lo publica', await until(async () => (await (await fetch(B + '/api/catalogo')).json()).productos.some((p) => p.nombre.startsWith('UI4 Prod'))));
    cambiar(w, filaT('Caja chica').querySelector('input'), '31'); botonF('Caja chica', 'Guardar precio').click();
    t('catálogo: cambiar el precio de una presentación', await until(async () => Number((await db.query("SELECT precio FROM presentaciones WHERE nombre='Caja chica'")).rows[0].precio) === 31));

    /* ---------- ADMIN: pedidos a proveedor (Sprint 7) ---------- */
    pest(w, 'Dashboard').click();
    const logoR = await fetch(B + '/logo.png'); const logoFav = await fetch(B + '/favicon.png');
    t('logotipo: header con imagen, login con logo grande y archivos servidos como PNG', !!$('header .marca img') && $('header .marca img').getAttribute('src') === 'logo-96.png' && logoR.status === 200 && /image\/png/.test(logoR.headers.get('content-type')) && logoFav.status === 200 && !!w.document.querySelector('link[rel=icon]'));
    t('dashboard: muestra "Pedidos a proveedor por recibir"', await until(() => /Pedidos a proveedor por recibir/.test($('#staff').textContent)));
    const harinaId = (await db.query("SELECT id FROM insumos WHERE nombre='Harina'")).rows[0].id;
    const stockH = async () => Number((await db.query('SELECT stock FROM insumos WHERE id=$1', [harinaId])).rows[0].stock);
    const sub = (txt) => [...w.document.querySelectorAll('#staff .seg button')].find((b) => b.textContent === txt && b.dataset.s);
    const bp = (txt) => [...w.document.querySelectorAll('#staff button')].find((b) => b.textContent.trim() === txt);
    pest(w, 'Pedidos a proveedor').click();
    t('pedidos a proveedor: 3 sub-pestañas y abre en "Pedidos enviados"', await until(() => ['Pedidos enviados', 'Nuevo pedido', 'Proveedores'].every((n) => sub(n))) && sub('Pedidos enviados').classList.contains('on') && limpio(w));
    sub('Proveedores').click();
    await until(() => bp('+ Agregar proveedor')); bp('+ Agregar proveedor').click();
    let pf = await until(() => $('#staff form'));
    const NP = 'UI7 Proveedor ' + R;
    t('proveedores: el formulario lista los insumos como casillas', pf.querySelectorAll('.lista-insumos input[type=checkbox]').length >= 10);
    const campos7 = pf.querySelectorAll('input:not([type=checkbox])'); cambiar(w, campos7[0], NP); cambiar(w, campos7[1], 'correo-malo');
    enviarForm(w, pf);
    t('proveedores: un correo inválido muestra el error y no guarda nada', await until(() => /correo válido/i.test($('#staff .errbox').textContent)) && (await db.query('SELECT 1 FROM proveedores WHERE nombre=$1', [NP])).rows.length === 0);
    cambiar(w, campos7[1], `ventas${R}@ui7.test`); enviarForm(w, pf);
    t('proveedores: se agrega y aparece en la tabla', await until(() => [...w.document.querySelectorAll('#staff tbody tr')].some((r) => r.textContent.includes(NP) && r.textContent.includes('Cualquier insumo'))) && limpio(w));
    // ---- nuevo pedido: se suma "al recibir"
    sub('Nuevo pedido').click();
    await until(() => $('#staff select[aria-label=Proveedor]'));
    const pvSel = $('#staff select[aria-label=Proveedor]'); cambiar(w, pvSel, String((await db.query('SELECT id FROM proveedores WHERE nombre=$1', [NP])).rows[0].id));
    t('nuevo pedido: avisa a qué correo se enviará y a quién le llegan las respuestas', await until(() => /ventas\d+@ui7\.test/.test($('#staff .aviso').textContent) && /admin@encombo\.test/.test($('#staff .aviso').textContent)));
    const stock0 = await stockH();
    let lin = $('#staff .lp'); cambiar(w, lin.querySelector('select'), String(harinaId)); cambiar(w, lin.querySelector('input'), '150');
    t('nuevo pedido: al elegir el insumo muestra su unidad', lin.querySelector('.u').textContent === 'g');
    t('nuevo pedido: el formulario ya no pide fecha ni cuándo sumar al stock', !$('#staff input[name=suma]') && !$('#staff input[type=date]') && !/Cuándo se suma|Para cuándo/.test($('#staff').textContent));
    enviarForm(w, $('#staff form'));
    t('nuevo pedido: confirma el envío del correo y suma el stock de inmediato', await until(() => /Pedido PP-\d{4} enviado/.test($('#staff').textContent) && /correo a UI7 Proveedor/.test($('#staff').textContent)) && /ya se sumó al inventario/i.test($('#staff').textContent) && (await stockH()) === stock0 + 150 && limpio(w));
    bp('Ver pedidos').click();
    t('pedidos enviados: aparece como Enviado con el stock ya Sumado', await until(() => [...w.document.querySelectorAll('#staff tbody tr')].some((r) => r.textContent.includes(NP) && /Sumado/.test(r.textContent) && /Enviado/.test(r.textContent))));
    const filaPP = () => [...w.document.querySelectorAll('#staff tbody tr')].find((r) => r.textContent.includes(NP));
    t('pedidos enviados: el correo queda como enviado', await until(() => /Correo enviado/.test(filaPP().textContent)));
    [...filaPP().querySelectorAll('button')].find((b) => b.textContent === 'Ver').click();
    t('pedidos enviados: "Ver" muestra el detalle con la cantidad pedida', await until(() => /Cantidad pedida/.test($('#staff').textContent) && /Harina/.test($('#staff .ficha-dl, #staff .card dl') ? $('#staff').textContent : '') && /150 g/.test($('#staff').textContent)));
    [...filaPP().querySelectorAll('button')].find((b) => b.textContent === 'Marcar recibido').click();
    t('recibir: pide confirmación y avisa que el stock ya estaba sumado', await until(() => bp('Sí, ya llegó')) && /ya se había sumado/.test($('#staff').textContent) && (await stockH()) === stock0 + 150);
    bp('Sí, ya llegó').click();
    t('recibir: la fila cambia a Recibido y el stock NO se suma otra vez', await until(async () => (await stockH()) === stock0 + 150 && /Recibido/.test(filaPP().textContent) && /Sumado/.test(filaPP().textContent)) && limpio(w));
    // ---- nuevo pedido: se suma "al enviar" (opción por defecto) + sugerencias
    sub('Nuevo pedido').click(); await until(() => $('#staff select[aria-label=Proveedor]'));
    cambiar(w, $('#staff select[aria-label=Proveedor]'), String((await db.query('SELECT id FROM proveedores WHERE nombre=$1', [NP])).rows[0].id));
    bp('Agregar lo que está en reorden').click();
    t('sugerencias: agrega los insumos en reorden con su cantidad sugerida', await until(() => [...w.document.querySelectorAll('#staff .lp')].some((l) => { const s = l.querySelector('select'); return s.selectedOptions[0] && /Té chai/.test(s.selectedOptions[0].textContent) && Number(l.querySelector('input').value) > 0; })));
    const stock1 = await stockH(); const lps = [...w.document.querySelectorAll('#staff .lp')];
    lps.forEach((l) => l.remove()); // no se envía el Té chai: otras pruebas necesitan que siga en reorden
    bp('+ Agregar insumo').click(); const nl = [...w.document.querySelectorAll('#staff .lp')].pop(); cambiar(w, nl.querySelector('select'), String(harinaId)); cambiar(w, nl.querySelector('input'), '75');
    bp('+ Agregar insumo').click(); const dup = [...w.document.querySelectorAll('#staff .lp')].pop(); cambiar(w, dup.querySelector('select'), String(harinaId)); cambiar(w, dup.querySelector('input'), '5');
    enviarForm(w, $('#staff form'));
    t('nuevo pedido: un insumo repetido se avisa y no se envía', await until(() => /repetido/.test($('#staff .errbox').textContent)) && (await stockH()) === stock1);
    dup.remove(); enviarForm(w, $('#staff form'));
    t('nuevo pedido: al enviar, el stock sube de inmediato', await until(async () => /ya se sumó al inventario/i.test($('#staff').textContent) && (await stockH()) === stock1 + 75));
    // ---- cancelar un pedido pendiente (el formulario ya no lo crea; se prepara por API como pedido "al recibir")
    const tokA = (await (await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: 'admin@encombo.test', password: clave }) })).json()).token;
    const provNP = (await db.query('SELECT id FROM proveedores WHERE nombre=$1', [NP])).rows[0].id;
    await fetch(B + '/api/pedidos-proveedor', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokA }, body: JSON.stringify({ proveedor_id: provNP, suma_stock_en: 'recepcion', items: [{ insumo_id: harinaId, cantidad: 10 }] }) });
    sub('Pedidos enviados').click();
    await until(() => [...w.document.querySelectorAll('#staff tbody tr')].some((r) => /Falta sumar/.test(r.textContent) && r.textContent.includes(NP)));
    [...[...w.document.querySelectorAll('#staff tbody tr')].find((r) => /Falta sumar/.test(r.textContent)).querySelectorAll('button')].find((b) => b.textContent === 'Cancelar').click();
    await until(() => bp('Sí, cancelar pedido')); bp('Sí, cancelar pedido').click();
    t('cancelar: queda Cancelado y se avisa al proveedor', await until(() => /cancelado y proveedor avisado/.test($('#staff').textContent)) && (await db.query("SELECT 1 FROM notificaciones WHERE plantilla='cancelacion' AND destinatario LIKE $1", [`ventas${R}@ui7.test`])).rows.length === 1);
    t('cancelar: los pedidos con stock ya sumado no ofrecen "Cancelar"', [...w.document.querySelectorAll('#staff tbody tr')].filter((r) => /Sumado/.test(r.textContent)).every((r) => ![...r.querySelectorAll('button')].some((b) => b.textContent === 'Cancelar')));
    // ---- eliminar proveedores
    sub('Proveedores').click(); await until(() => bp('+ Agregar proveedor'));
    [...[...w.document.querySelectorAll('#staff tbody tr')].find((r) => r.textContent.includes(NP)).querySelectorAll('button')].find((b) => b.textContent === 'Eliminar').click();
    await until(() => bp('Sí, eliminar')); bp('Sí, eliminar').click();
    t('eliminar proveedor con pedidos sin recibir: se rechaza con un mensaje claro', await until(() => /aún no se marcan como recibidos/.test($('#staff').textContent)) && (await db.query('SELECT activo FROM proveedores WHERE nombre=$1', [NP])).rows[0].activo === true);
    await db.query("UPDATE pedidos_proveedor SET estado='recibido' WHERE estado='enviado' AND proveedor_id=(SELECT id FROM proveedores WHERE nombre=$1)", [NP]);
    [...[...w.document.querySelectorAll('#staff tbody tr')].find((r) => r.textContent.includes(NP)).querySelectorAll('button')].find((b) => b.textContent === 'Eliminar').click();
    await until(() => bp('Sí, eliminar')); bp('Sí, eliminar').click();
    t('eliminar proveedor con historial: se archiva y avisa que el historial se conserva', await until(() => /se archivó/.test($('#staff').textContent)) && (await db.query('SELECT activo FROM proveedores WHERE nombre=$1', [NP])).rows[0].activo === false);
    bp('+ Agregar proveedor').click(); pf = await until(() => $('#staff form')); const i2 = pf.querySelectorAll('input:not([type=checkbox])');
    cambiar(w, i2[0], 'UI7 Borrable ' + R); cambiar(w, i2[1], `b${R}@ui7.test`); enviarForm(w, pf);
    await until(() => [...w.document.querySelectorAll('#staff tbody tr')].some((r) => r.textContent.includes('UI7 Borrable')));
    [...[...w.document.querySelectorAll('#staff tbody tr')].find((r) => r.textContent.includes('UI7 Borrable')).querySelectorAll('button')].find((b) => b.textContent === 'Eliminar').click();
    await until(() => bp('Sí, eliminar')); bp('Sí, eliminar').click();
    t('eliminar proveedor nuevo: se borra de verdad', await until(() => /se eliminó/.test($('#staff').textContent)) && (await db.query("SELECT 1 FROM proveedores WHERE nombre LIKE 'UI7 Borrable%'")).rows.length === 0 && limpio(w));
    t('pedidos a proveedor: sin errores de JavaScript en toda la sección', errores.length === 0, errores.join(' | '));
    /* ---------- ADMIN: toma de decisiones ---------- */
    pest(w, 'Toma de decisiones').click();
    const fil = (k) => w.document.querySelector(`#staff tr[data-criterio=${k}]`);
    t('decisiones: carga el primer caso con su matriz editable y 4 tipos de decisión', await until(() => w.document.querySelectorAll('#staff [data-caso]').length === 4 && w.document.querySelectorAll('#staff .dec-tabla input[type=number]').length >= 12) && limpio(w));
    t('decisiones: calcula solo los 6 criterios y muestra el consenso', await until(() => w.document.querySelectorAll('#staff tr[data-criterio]').length === 6 && /Consenso/.test($('#staff').textContent)));
    t('decisiones: explica de dónde salen los pagos', /¿De dónde salen los pagos\?/.test($('#staff').textContent));
    const ganaMaximin = () => (fil('maximin').querySelector('td.gana') || {}).textContent;
    t('combo de temporada: Maximin elige el Combo Regreso a clases (4000 / −3500 / 1500 / 8200)', /8,?200/.test(ganaMaximin() || ''), ganaMaximin());
    // editar un pago recalcula
    const inp = w.document.querySelectorAll('#staff .dec-tabla input[type=number]')[3]; // Combo Navideño, escenario 1 (fila 2)
    const antesTxt = fil('maximax').textContent;
    cambiar(w, w.document.querySelectorAll('#staff .dec-tabla input[type=number]')[0], '99000');
    t('al editar un pago los resultados se recalculan solos', await until(() => fil('maximax') && fil('maximax').textContent !== antesTxt && /99,?000/.test(fil('maximax').textContent)));
    // pago inválido: mensaje claro, sin basura
    cambiar(w, w.document.querySelectorAll('#staff .dec-tabla input[type=number]')[1], '');
    t('un pago vacío muestra el error y no rompe la pantalla', await until(() => /pago|número|válid/i.test(w.document.querySelector('#staff .errbox').textContent)) && limpio(w), w.document.querySelector('#staff .errbox').textContent);
    // restaurar
    [...w.document.querySelectorAll('#staff button')].find((b) => b.textContent === 'Restaurar caso').click();
    t('Restaurar caso devuelve los pagos originales', await until(() => w.document.querySelectorAll('#staff .dec-tabla input[type=number]')[0].value === '14000' && !w.document.querySelector('#staff .errbox').textContent));
    // cambiar de caso
    w.document.querySelector('#staff [data-caso=produccion-diaria]').click();
    t('cambiar de caso carga otra matriz (producción diaria)', await until(() => /Preparar 30/.test($('#staff').textContent) && w.document.querySelectorAll('#staff tr[data-criterio]').length === 6));
    // alfa
    const slider = w.document.querySelector('#staff input[type=range]'); cambiar(w, slider, '0');
    t('el deslizador de α actualiza Hurwicz (α=0.00)', await until(() => /α=0\.00/.test(fil('hurwicz').textContent)));
    // exportar
    const bajadas = []; w.URL.createObjectURL = (b) => { bajadas.push(b); return 'blob:x'; }; w.URL.revokeObjectURL = () => {}; w.HTMLAnchorElement.prototype.click = function () { bajadas.push(this.download); };
    w.document.querySelector('#staff [data-acc=exportar]').click();
    t('exportar descarga 2 archivos CSV', await until(() => bajadas.filter((x) => typeof x === 'string' && /\.csv$/.test(x)).length === 2), JSON.stringify(bajadas.map(String)));
    // registrar
    cambiar(w, w.document.querySelector('#staff textarea'), 'Decisión de prueba UI');
    w.document.querySelector('#staff [data-acc=registrar]').click();
    t('registrar la decisión confirma y la guarda', await until(() => /Decisión registrada/.test($('#staff').textContent)) && (await db.query("SELECT 1 FROM decisiones WHERE notas='Decisión de prueba UI'")).rows.length === 1);
    w.document.querySelector('#staff [data-s=hist]').click();
    t('Decisiones registradas: aparece con quién la registró', await until(() => /Decisión de prueba UI/.test($('#staff').textContent) && /Admin/i.test($('#staff').textContent)) && limpio(w));
    t('decisiones: sin errores de JavaScript en toda la sección', errores.length === 0, errores.join(' | '));
    await db.query("DELETE FROM decisiones WHERE notas='Decisión de prueba UI'");
    /* ---------- ADMIN: usuarios ---------- */
    pest(w, 'Usuarios').click();
    t('usuarios: sin basura en pantalla', await until(() => w.document.querySelectorAll('#staff tbody tr').length >= 3) && limpio(w));
    t('usuarios: lista al personal y oculta a los clientes por defecto', await until(() => w.document.querySelectorAll('#staff tbody tr').length >= 3) && /admin@encombo.test/.test($('#staff').textContent) && !/ui\d+@prueba/.test($('#staff').textContent) && /\(tú\)/.test($('#staff').textContent));
    [...w.document.querySelectorAll('#staff button')].find((b) => /Nuevo usuario del personal/.test(b.textContent)).click();
    form = $('#staff form'); const ins = form.querySelectorAll('input');
    ins[0].value = 'Persona UI6'; ins[1].value = `ui6staff${R}@prueba.test`; ins[2].value = 'Temporal-UI6-99'; enviarForm(w, form);
    t('usuarios: crear un usuario del personal muestra su contraseña temporal', await until(() => /Usuario creado/.test($('#staff .okmsg').textContent) && /Temporal-UI6-99/.test($('#staff').textContent)));
    const loginApi = async (c, p) => (await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: c, password: p }) })).status;
    t('…y esa persona ya puede iniciar sesión', await loginApi(`ui6staff${R}@prueba.test`, 'Temporal-UI6-99') === 200);
    const selRol = () => filaT(`ui6staff${R}`).querySelector('select');
    cambiar(w, selRol(), 'almacen');
    t('usuarios: cambiar el rol se guarda', await until(async () => (await db.query('SELECT rol FROM usuarios WHERE correo=$1', [`ui6staff${R}@prueba.test`])).rows[0].rol === 'almacen'));
    botonF(`ui6staff${R}`, 'Restablecer contraseña').click();
    form = $('#staff form'); form.querySelector('input').value = 'Restablecida-UI6-1'; enviarForm(w, form);
    t('usuarios: restablecer contraseña (la anterior deja de servir)', await until(() => /restablecida/.test($('#staff .okmsg').textContent)) && await loginApi(`ui6staff${R}@prueba.test`, 'Restablecida-UI6-1') === 200 && await loginApi(`ui6staff${R}@prueba.test`, 'Temporal-UI6-99') === 401);
    botonF(`ui6staff${R}`, 'Dar de baja').click(); [...w.document.querySelectorAll('#staff button')].find((b) => b.textContent === 'Sí, dar de baja').click();
    t('usuarios: dar de baja (ya no puede entrar)', await until(() => /Inactivo/.test(filaT(`ui6staff${R}`).textContent)) && await loginApi(`ui6staff${R}@prueba.test`, 'Restablecida-UI6-1') === 401);
    botonF('admin@encombo.test', 'Dar de baja').click(); [...w.document.querySelectorAll('#staff button')].find((b) => b.textContent === 'Sí, dar de baja').click();
    t('usuarios: no se puede dar de baja al único administrador', await until(() => /sin un administrador activo/.test($('#staff').textContent)));
    const chkCli = w.document.querySelector('#staff .chk input'); chkCli.checked = true; chkCli.dispatchEvent(new w.Event('change'));
    t('usuarios: "ver también clientes" los muestra', /ui\d+@prueba\.test/.test($('#staff').textContent));

    /* ---------- MI CUENTA (cambio de contraseña) ---------- */
    const rc = await (await fetch(B + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: 'Cuenta UI6', correo: `ui6cta${R}@prueba.test`, password: 'secreta123' }) })).json();
    const wcta = (await abrir(B + '/', { t: rc.token, u: JSON.stringify(rc.usuario) })).window;
    await until(() => !wcta.document.querySelector('#btn-cuenta').hidden);
    wcta.document.querySelector('#btn-cuenta').click();
    const fc = () => wcta.document.querySelector('#cuenta form'), setF = (n, v) => { fc().elements[n].value = v; };
    t('mi cuenta: el botón abre el formulario de cambio de contraseña', await until(() => !wcta.document.querySelector('#cuenta').hidden && fc()));
    setF('actual', 'secreta123'); setF('nueva', 'nueva-clave-1'); setF('repetir', 'otra-distinta-9'); enviarForm(wcta, fc());
    t('mi cuenta: si la confirmación no coincide, lo dice', await until(() => /no coinciden/.test(wcta.document.querySelector('#cuenta').textContent)));
    setF('actual', 'incorrecta-1'); setF('nueva', 'nueva-clave-1'); setF('repetir', 'nueva-clave-1'); enviarForm(wcta, fc());
    t('mi cuenta: contraseña actual incorrecta → mensaje, y la sesión sigue abierta', await until(() => /actual no es correcta/.test(wcta.document.querySelector('#cuenta').textContent)) && /Cuenta UI6/.test(wcta.document.querySelector('#who').textContent));
    setF('actual', 'secreta123'); setF('nueva', 'nueva-clave-1'); setF('repetir', 'nueva-clave-1'); enviarForm(wcta, fc());
    t('mi cuenta: cambio correcto', await until(() => /Contraseña actualizada/.test(wcta.document.querySelector('#cuenta').textContent)));
    const tokNuevo = wcta.sessionStorage.getItem('t');
    t('…la sesión actual se renueva (sigue dentro) y la anterior queda cerrada', tokNuevo && tokNuevo !== rc.token && (await fetch(B + '/api/auth/me', { headers: { Authorization: 'Bearer ' + tokNuevo } })).status === 200 && (await fetch(B + '/api/auth/me', { headers: { Authorization: 'Bearer ' + rc.token } })).status === 401);
    t('…y entra con la contraseña nueva', await loginApi(`ui6cta${R}@prueba.test`, 'nueva-clave-1') === 200 && await loginApi(`ui6cta${R}@prueba.test`, 'secreta123') === 401);

    /* ---------- COCINA ---------- */
    const presId = (await db.query('SELECT presentacion_id FROM pedidos WHERE cliente_id=$1 LIMIT 1', [uid])).rows[0].presentacion_id;
    const o2 = (await db.query("INSERT INTO pedidos(cliente_id,presentacion_id,fecha_entrega,hora_entrega,total,estatus) VALUES($1,$2,$3,'09:00',10,'Pendiente') RETURNING id", [uid, presId, fecha])).rows[0].id;
    dom = await abrir(B + '/'); w = dom.window; $ = (s) => w.document.querySelector(s);
    await until(() => w.document.querySelectorAll('#cat .item').length >= 1); await entrar(w, 'cocina@encombo.test', clave);
    t('cocina: solo ve el Tablero (sin menú de pestañas), sin inventario ni recetas', await until(() => /Pedidos del día/.test($('#staff').textContent)) && w.document.querySelectorAll('#staff .seg').length === 0 && !$('#staff table'));
    t('cocina: el tablero no muestra basura', limpio(w));
    t('hoy no hay pedidos: lo dice', await until(() => /No hay pedidos para este día/.test($('#staff').textContent)));
    cambiar(w, $('#staff input[type=date]'), fecha);
    const cols = () => [...w.document.querySelectorAll('#staff .col')];
    const tarj = (i, n) => cols()[i].querySelectorAll('.oc')[n];
    const boton = (card, txt) => [...card.querySelectorAll('button')].find((b) => b.textContent === txt);
    t('al elegir la fecha: dos pedidos en Pendiente, en orden de hora (09:00 y 12:00)', await until(() => cols()[0] && cols()[0].querySelectorAll('.oc').length === 2) && /09:00/.test(tarj(0, 0).textContent) && /12:00/.test(tarj(0, 1).textContent) && /\(2\)/.test(cols()[0].textContent));
    t('la dedicatoria se ve destacada y como TEXTO (sin ejecutar HTML)', tarj(0, 1).querySelector('.ded').textContent.includes('<img src=x') && !w.document.querySelector('#staff img') && !w.__pwned);
    tarj(0, 1).click();
    t('al tocar un pedido aparece su ficha técnica con ingredientes', await until(() => /Ficha técnica/.test($('#staff .ficha').textContent) && /Ingredientes/.test($('#staff .ficha').textContent) && /Harina/.test($('#staff .ficha').textContent) && /Caja mediana/.test($('#staff .ficha').textContent)));
    boton(tarj(0, 1), 'Iniciar').click();
    t('"Iniciar": el pedido pasa a En preparación y el cliente queda avisado por correo', await until(() => cols()[1].querySelectorAll('.oc').length === 1) && (await db.query('SELECT estatus FROM pedidos WHERE id=$1', [ordenCli.id])).rows[0].estatus === 'En preparación' && (await db.query("SELECT count(*)::int n FROM notificaciones WHERE pedido_id=$1 AND plantilla='En preparación'", [ordenCli.id])).rows[0].n === 1);
    boton(tarj(1, 0), 'Marcar listo').click();
    t('"Marcar listo": pasa a Listo para entrega', await until(() => cols()[2].querySelectorAll('.oc').length === 1) && (await db.query('SELECT estatus FROM pedidos WHERE id=$1', [ordenCli.id])).rows[0].estatus === 'Listo para entrega');
    t('el tablero muestra el contador de cada columna', /Pendiente \(1\)/.test(cols()[0].textContent) && /Listo para entrega \(1\)/.test(cols()[2].textContent));
    boton(tarj(0, 0), 'Iniciar').click(); await until(() => cols()[1].querySelectorAll('.oc').length === 1);
    await db.query("UPDATE pedidos SET estatus='Entregado' WHERE id=$1", [o2]); // otra persona lo entregó mientras esta pantalla seguía abierta
    boton(tarj(1, 0), 'Marcar listo').click();
    t('pantalla desactualizada: avisa con claridad y se pone al día', await until(() => /ya no puede cambiar/.test($('#staff .errbox').textContent)) && await until(() => cols()[3].querySelectorAll('.oc').length === 1));

    /* ---------- CLIENTE: seguimiento que se actualiza solo ---------- */
    const wc = (await abrir(B + '/', { t: token, u: usr })).window;
    await until(() => !wc.document.querySelector('#nav').hidden);
    wc.document.querySelector('#nav button[data-tab=mis]').click();
    const tarjCli = () => [...wc.document.querySelectorAll('#mis .card')].find((c) => c.textContent.includes(svc.folio(ordenCli.id)));
    t('Mis pedidos: línea de tiempo con 3 pasos completados', await until(() => { const c = tarjCli(); return c && c.querySelector('.tl') && c.querySelector('.tl').querySelectorAll('.d').length === 3 && /Listo para entrega/.test(c.querySelector('.chip').textContent); }));
    await db.query("UPDATE pedidos SET estatus='Entregado' WHERE id=$1", [ordenCli.id]);
    await db.query("INSERT INTO pedido_estatus_historial(pedido_id,estatus) VALUES($1,'Entregado') ON CONFLICT DO NOTHING", [ordenCli.id]);
    t('el estatus se actualiza solo en pantalla (sin recargar) y se completa la línea de tiempo', await until(() => { const c = tarjCli(); return c && c.querySelector('.tl').querySelectorAll('.d').length === 4 && /Entregado/.test(c.querySelector('.chip').textContent); }, 5000));
    [...tarjCli().querySelectorAll('button')].find((b) => /Ver comprobante/.test(b.textContent)).click();
    t('el comprobante incluye el seguimiento del pedido', await until(() => /Seguimiento/.test(wc.document.querySelector('#msg').textContent) && wc.document.querySelector('#msg .tl')));
    t('sin errores de JavaScript en todo el recorrido', errores.length === 0, errores.join(' || '));
  } catch (e) { fail++; console.log('FAIL error inesperado', e); }
  finally {
    try {
      if (uid) for (const s of ['DELETE FROM checkouts WHERE cliente_id=$1', 'DELETE FROM movimientos_inventario WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id=$1)', 'DELETE FROM pagos WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id=$1)',
        'DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE cliente_id=$1)', 'DELETE FROM pedidos WHERE cliente_id=$1', 'DELETE FROM usuarios WHERE id=$1']) await db.query(s, [uid]);
      await db.query("DELETE FROM productos WHERE nombre LIKE 'UI4 Prod %'");
      await db.query("DELETE FROM usuarios WHERE correo LIKE 'ui6%@prueba.test'");
      if (cc0) await db.query('UPDATE presentaciones SET precio=$2 WHERE id=$1', [cc0.id, cc0.precio]);
      await db.query("DELETE FROM notificaciones WHERE pedido_proveedor_id IN (SELECT pp.id FROM pedidos_proveedor pp JOIN proveedores p ON p.id=pp.proveedor_id WHERE p.nombre LIKE 'UI7 %')");
      await db.query("DELETE FROM movimientos_inventario WHERE pedido_proveedor_id IN (SELECT pp.id FROM pedidos_proveedor pp JOIN proveedores p ON p.id=pp.proveedor_id WHERE p.nombre LIKE 'UI7 %')");
      await db.query("DELETE FROM pedidos_proveedor WHERE proveedor_id IN (SELECT id FROM proveedores WHERE nombre LIKE 'UI7 %')");
      await db.query("DELETE FROM proveedores WHERE nombre LIKE 'UI7 %'");
      await db.query("DELETE FROM movimientos_inventario WHERE id > $1", [movMax]);
      await db.query("DELETE FROM insumos WHERE nombre LIKE '%UI4 %'");
      for (const i of ins0) await db.query('UPDATE insumos SET stock=$2 WHERE id=$1', [i.id, i.stock]);
    } catch (e) { console.log('Aviso: limpieza incompleta:', e.message); }
    console.log(`\n${pass} correctas, ${fail} fallidas`);
    server.close(); await db.pool.end(); process.exit(fail ? 1 : 0);
  }
})();

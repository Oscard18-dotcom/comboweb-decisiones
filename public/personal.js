const Personal = (() => {
  let X = null;
  const num = (n) => Number(n).toLocaleString('es-MX', { maximumFractionDigits: 4 });
  const costo = (n) => Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const fecha = (s) => new Date(s).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
  const e = (...a) => X.el(...a);
  const campo = (rotulo, input) => e('label', {}, rotulo, input);
  const chipC = (txt, color) => e('span', { class: 'chip', style: 'background:' + color }, txt);
  const enviar = (boton, caja, fn) => async (ev) => {
    ev.preventDefault(); caja.replaceChildren(); boton.disabled = true;
    try { await fn(); } catch (er) { caja.replaceChildren(e('div', {}, er.message)); }
    boton.disabled = false;
  };

  const modulos = [];
  const registrar = (k, nombre, roles, orden, fn) => modulos.push({ k, nombre, roles, orden, fn });
  let timers = [];
  const limpiar = () => { timers.forEach(clearInterval); timers = []; };
  const cada = (ms, fn) => { timers.push(setInterval(fn, ms)); };

  function iniciar(ctx) {
    X = ctx; limpiar();
    const rol = ctx.usuario.rol, r = document.querySelector('#staff');
    r.replaceChildren(); r.hidden = false;
    const H = { api: ctx.api, e, num, costo, fecha, campo, chipC, enviar, cada, usuario: ctx.usuario, money: ctx.money, descargar: ctx.descargar };
    const tabs = modulos.filter((m) => m.roles.includes(rol)).sort((a, b) => a.orden - b.orden);
    if (!tabs.length) { r.append(e('div', { class: 'card narrow' }, e('p', {}, 'Tu rol no tiene pantallas disponibles.'))); return; }
    const nav = e('div', { class: 'seg noprint' }), cont = e('div');
    const ir = (k) => { limpiar(); nav.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === k)); cont.replaceChildren(); tabs.find((m) => m.k === k).fn(cont, H); };
    tabs.forEach((m) => nav.append(e('button', { type: 'button', 'data-k': m.k, onclick: () => ir(m.k) }, m.nombre)));
    r.append(tabs.length > 1 ? nav : null, cont); ir(tabs[0].k);
  }
  function detener() { limpiar(); const r = document.querySelector('#staff'); if (r) { r.replaceChildren(); r.hidden = true; } }

  async function inventario(cont) {
    let lista = [], filtro = '', soloReorden = false, archivados = false;
    const banner = e('div', { role: 'status' }), tabla = e('div', { class: 'card tw' }), panel = e('div');
    const buscar = e('input', { type: 'search', placeholder: 'Buscar insumo…', 'aria-label': 'Buscar insumo', oninput: (ev) => { filtro = ev.target.value.toLowerCase(); pintar(); } });
    const cReorden = e('input', { type: 'checkbox', onchange: (ev) => { soloReorden = ev.target.checked; pintar(); } });
    const cArch = e('input', { type: 'checkbox', onchange: async (ev) => { archivados = ev.target.checked; await cargar(); } });
    const nuevo = e('button', { class: 'btn', type: 'button', style: 'width:auto', onclick: () => formNuevo() }, '+ Agregar insumo');
    cont.append(e('div', { class: 'two' }, e('div', {}, banner, e('div', { class: 'row filtros' }, buscar, e('label', { class: 'chk' }, cReorden, 'Solo reorden'), e('label', { class: 'chk' }, cArch, 'Ver archivados'), nuevo), tabla), panel));

    async function cargar() { try { lista = (await X.api('/inventario' + (archivados ? '?inactivos=1' : ''))).insumos; pintar(); } catch (er) { tabla.replaceChildren(e('p', { class: 'err' }, er.message)); } }
    function pintar() {
      const alerta = lista.filter((i) => i.activo && i.en_reorden);
      banner.className = alerta.length ? 'alerta' : 'mu';
      banner.replaceChildren(alerta.length ? `⚠ ${alerta.length} insumo(s) en nivel de reorden: ${alerta.map((i) => `${i.nombre} (${num(i.stock)} de ${num(i.stock_minimo)} ${i.unidad})`).join(', ')}` : 'Sin alertas de reorden.');
      const filas = lista.filter((i) => (!filtro || i.nombre.toLowerCase().includes(filtro)) && (!soloReorden || (i.en_reorden && i.activo)));
      const th = (t) => e('th', {}, t);
      tabla.replaceChildren(e('table', {}, e('thead', {}, e('tr', {}, ['Insumo', 'Stock', 'Mínimo', 'Unidad', 'Costo u.', 'Estado', 'Acciones'].map(th))),
        e('tbody', {}, filas.map((i) => e('tr', {},
          e('td', {}, i.nombre), e('td', { class: i.en_reorden ? 'bajo' : '' }, num(i.stock)), e('td', {}, num(i.stock_minimo)), e('td', {}, i.unidad), e('td', {}, costo(i.costo_unitario)),
          e('td', {}, !i.activo ? chipC('Archivado', '#7D756B') : i.en_reorden ? chipC('Reorden', '#B3261E') : chipC('OK', '#3E5B3A')),
          e('td', { class: 'acc' }, [['Movimiento', () => formMov(i)], ['Editar', () => formEditar(i)], ['Historial', () => historial(i)], ['Eliminar', () => confirmar(i)]]
            .map(([t, fn]) => e('button', { class: 'mini', type: 'button', onclick: fn, 'aria-label': `${t} ${i.nombre}` }, t))))))),
        filas.length ? null : e('p', { class: 'mu', style: 'padding:8px' }, 'No hay insumos que coincidan.'));
    }
    const titulo = (t) => e('h3', {}, t);
    const cerrar = e('button', { class: 'mini', type: 'button', onclick: () => panel.replaceChildren() }, 'Cerrar');
    const caja = () => e('div', { class: 'errbox', role: 'alert' });
    const ok = (t) => e('p', { class: 'okmsg', role: 'status' }, t);

    function formNuevo() {
      const n = e('input', { name: 'nombre', required: true, maxlength: 80 }), u = e('input', { name: 'unidad', required: true, maxlength: 10, list: 'unidades', placeholder: 'g, ml, pza…' });
      const s = e('input', { name: 'stock', type: 'number', min: '0', step: 'any', value: '0' }), m = e('input', { name: 'minimo', type: 'number', min: '0', step: 'any', value: '0' }), c = e('input', { name: 'costo', type: 'number', min: '0', step: 'any', value: '0' });
      const err = caja(), b = e('button', { class: 'btn', type: 'submit' }, 'Guardar insumo');
      const f = e('form', { onsubmit: enviar(b, err, async () => {
        const r = await X.api('/inventario', { method: 'POST', body: { nombre: n.value, unidad: u.value, stock: s.value, stock_minimo: m.value, costo_unitario: c.value } });
        await cargar(); panel.replaceChildren(e('div', { class: 'card' }, ok(`Se agregó “${r.insumo.nombre}”.`), cerrar));
      }) }, campo('Nombre', n), campo('Unidad', u), e('datalist', { id: 'unidades' }, ['g', 'kg', 'ml', 'l', 'pza'].map((x) => e('option', { value: x }))), campo('Existencia inicial', s), campo('Stock mínimo (alerta de reorden)', m), campo('Costo unitario (MXN por unidad)', c), err, b);
      panel.replaceChildren(e('div', { class: 'card' }, titulo('Nuevo insumo'), f, cerrar));
    }
    function formEditar(i) {
      const n = e('input', { value: i.nombre, required: true, maxlength: 80 }), u = e('input', { value: i.unidad, maxlength: 10 }), m = e('input', { type: 'number', min: '0', step: 'any', value: String(i.stock_minimo) }), c = e('input', { type: 'number', min: '0', step: 'any', value: String(i.costo_unitario) });
      const a = e('input', { type: 'checkbox', checked: i.activo });
      const err = caja(), b = e('button', { class: 'btn', type: 'submit' }, 'Guardar cambios');
      const f = e('form', { onsubmit: enviar(b, err, async () => {
        await X.api('/inventario/' + i.id, { method: 'PUT', body: { nombre: n.value, unidad: u.value, stock_minimo: m.value, costo_unitario: c.value, activo: a.checked } });
        await cargar(); panel.replaceChildren(e('div', { class: 'card' }, ok('Cambios guardados.'), cerrar));
      }) }, campo('Nombre', n), campo('Unidad', u), campo('Stock mínimo', m), campo('Costo unitario', c), e('label', { class: 'chk' }, a, 'Activo'), e('p', { class: 'mu' }, 'El stock no se edita aquí: usa “Movimiento” para que quede historial.'), err, b);
      panel.replaceChildren(e('div', { class: 'card' }, titulo(`Editar ${i.nombre}`), f, cerrar));
    }
    function formMov(i) {
      const t = e('select', { 'aria-label': 'Tipo de movimiento' }, e('option', { value: 'entrada' }, 'Entrada (compra o reposición)'), e('option', { value: 'salida' }, 'Salida (merma o consumo)'), e('option', { value: 'ajuste' }, 'Ajuste (conteo físico)'));
      const q = e('input', { type: 'number', min: '0', step: 'any', required: true, 'aria-label': 'Cantidad' }), nota = e('input', { maxlength: 200, placeholder: 'Opcional: proveedor, motivo…' });
      const rot = e('span', {}, `Cantidad (${i.unidad})`);
      t.onchange = () => { rot.textContent = t.value === 'ajuste' ? `Stock real contado (${i.unidad})` : `Cantidad (${i.unidad})`; };
      const err = caja(), b = e('button', { class: 'btn', type: 'submit' }, 'Registrar movimiento');
      const f = e('form', { onsubmit: enviar(b, err, async () => {
        const r = await X.api(`/inventario/${i.id}/movimientos`, { method: 'POST', body: { tipo: t.value, cantidad: q.value, nota: nota.value } });
        await cargar(); panel.replaceChildren(e('div', { class: 'card' }, ok(`Listo. “${r.insumo.nombre}” ahora tiene ${num(r.insumo.stock)} ${r.insumo.unidad}.`), cerrar));
      }) }, campo('Tipo', t), e('label', {}, rot, q), campo('Nota', nota), err, b);
      panel.replaceChildren(e('div', { class: 'card' }, titulo(`Movimiento · ${i.nombre}`), e('p', { class: 'mu' }, `Stock actual: ${num(i.stock)} ${i.unidad}`), f, cerrar));
    }
    async function historial(i) {
      panel.replaceChildren(e('div', { class: 'card' }, titulo(`Historial · ${i.nombre}`), e('p', { class: 'mu' }, 'Cargando…')));
      try {
        const { movimientos } = await X.api(`/inventario/${i.id}/movimientos`);
        const quien = (m) => (m.pedido_id ? `Pedido EC-${String(m.pedido_id).padStart(4, '0')}` : m.pedido_proveedor_id ? `Pedido a proveedor PP-${String(m.pedido_proveedor_id).padStart(4, '0')}` : m.usuario || '—');
        panel.replaceChildren(e('div', { class: 'card tw' }, titulo(`Historial · ${i.nombre}`), movimientos.length ? e('table', {}, e('thead', {}, e('tr', {}, ['Fecha', 'Tipo', 'Cantidad', 'Quién', 'Nota'].map((x) => e('th', {}, x)))),
          e('tbody', {}, movimientos.map((m) => e('tr', {}, e('td', {}, fecha(m.creado_en)), e('td', {}, m.tipo), e('td', {}, (m.tipo === 'ajuste' && m.cantidad > 0 ? '+' : '') + num(m.cantidad)), e('td', {}, quien(m)), e('td', {}, m.nota || ''))))) : e('p', { class: 'mu' }, 'Sin movimientos.'), cerrar));
      } catch (er) { panel.replaceChildren(e('div', { class: 'card' }, e('p', { class: 'err' }, er.message), cerrar)); }
    }
    function confirmar(i) {
      const err = caja();
      const si = e('button', { class: 'btn', type: 'button', onclick: async () => {
        err.replaceChildren();
        try { const r = await X.api('/inventario/' + i.id, { method: 'DELETE' }); await cargar(); panel.replaceChildren(e('div', { class: 'card' }, ok(r.archivado ? `“${i.nombre}” tenía historial, por eso se archivó (no se pierde su historial).` : `“${i.nombre}” se eliminó.`), cerrar)); }
        catch (er) { err.replaceChildren(e('div', {}, er.message)); }
      } }, 'Sí, eliminar');
      panel.replaceChildren(e('div', { class: 'card' }, titulo(`¿Eliminar “${i.nombre}”?`), e('p', {}, 'Si forma parte de recetas, el sistema no lo permitirá. Si tiene historial se archiva en lugar de borrarse.'), err, e('div', { class: 'row' }, si, cerrar)));
    }
    await cargar();
  }

  async function recetas(cont) {
    let productos = [], recs = new Map(), insumos = [], sel = null;
    const izq = e('div', { class: 'card' }), der = e('div');
    cont.append(e('div', { class: 'two inv' }, izq, der));
    async function cargar(seleccionar) {
      try {
        const [p, r, i] = await Promise.all([X.api('/admin/productos'), X.api('/recetas'), X.api('/inventario')]);
        productos = p.productos; recs = new Map(r.recetas.map((x) => [x.producto_id, x])); insumos = i.insumos;
        if (seleccionar !== undefined) sel = seleccionar;
        lista(); editor();
      } catch (er) { izq.replaceChildren(e('p', { class: 'err' }, er.message)); }
    }
    function lista() {
      izq.replaceChildren(e('h3', {}, 'Productos'), e('button', { class: 'btn s', type: 'button', onclick: () => { sel = 'nuevo'; lista(); editor(); } }, '+ Nuevo producto'),
        ...productos.map((p) => e('button', { class: 'prod' + (sel === p.id ? ' on' : ''), type: 'button', onclick: () => { sel = p.id; lista(); editor(); } },
          e('b', {}, p.nombre), e('span', { class: 'mu' }, costo(p.precio)), p.tiene_receta ? null : chipC('Sin receta', '#6A6141'), p.activo ? chipC('Activo', '#3E5B3A') : chipC('Inactivo', '#7D756B'))));
    }
    function editor() {
      if (sel === 'nuevo') return formProducto();
      const p = productos.find((x) => x.id === sel);
      if (!p) return der.replaceChildren(e('div', { class: 'card' }, e('p', { class: 'mu' }, 'Elige un producto para ver o editar su receta y su costo, o crea uno nuevo.')));
      const rec = recs.get(p.id) || null;
      const errP = e('div', { class: 'errbox', role: 'alert' }), errR = e('div', { class: 'errbox', role: 'alert' });
      const n = e('input', { value: p.nombre, required: true, maxlength: 80 }), d = e('input', { value: p.descripcion || '', maxlength: 300 }), pr = e('input', { type: 'number', min: '0', step: '0.01', value: String(p.precio) });
      const bp = e('button', { class: 'btn', type: 'submit' }, 'Guardar datos');
      const msgP = e('p', { class: 'okmsg', role: 'status' });
      const tog = e('button', { class: 'btn s', type: 'button', style: 'width:auto', onclick: async () => {
        errP.replaceChildren();
        try { await X.api(`/admin/productos/${p.id}/activo`, { method: 'PATCH', body: { activo: !p.activo } }); await cargar(p.id); } catch (er) { errP.replaceChildren(e('div', {}, er.message)); }
      } }, p.activo ? 'Desactivar producto' : 'Activar producto');
      const datos = e('form', { onsubmit: enviar(bp, errP, async () => {
        await X.api('/admin/productos/' + p.id, { method: 'PUT', body: { nombre: n.value, descripcion: d.value, precio: pr.value } }); await cargar(p.id);
      }) }, campo('Nombre', n), campo('Descripción', d), campo('Precio de venta (MXN)', pr), errP, e('div', { class: 'row' }, bp, tog));

      let ing = rec ? rec.ingredientes.map((i) => ({ insumo_id: i.insumo_id, cantidad: String(i.cantidad) })) : [];
      const rinde = e('input', { type: 'number', min: '1', max: '1000', step: '1', value: String(rec ? rec.rinde : 1), 'aria-label': 'Rinde', oninput: totales });
      const filas = e('div'), tot = e('div', { class: 'tot-box', 'aria-live': 'polite' });
      const unidad = (it) => { const i = insumos.find((x) => x.id === it.insumo_id); return i ? i.unidad : ''; };
      function totales() {
        const total = ing.reduce((a, it) => { const i = insumos.find((x) => x.id === it.insumo_id); return a + (i ? (Number(it.cantidad) || 0) * i.costo_unitario : 0); }, 0);
        const rd = Math.max(1, Number(rinde.value) || 1), pieza = total / rd, marg = p.precio > 0 ? (p.precio - pieza) / p.precio * 100 : 0;
        tot.replaceChildren(e('div', { class: 'ln' }, e('span', {}, 'Costo total del lote'), e('b', {}, costo(total))), e('div', { class: 'ln' }, e('span', {}, `Costo por pieza (÷ ${rd})`), e('b', {}, costo(pieza))),
          e('div', { class: 'ln' }, e('span', {}, `Precio de venta ${costo(p.precio)} · margen`), e('b', {}, marg.toFixed(1) + ' %')));
      }
      function pintarFilas() {
        filas.replaceChildren(...ing.map((it, idx) => {
          const u = e('span', { class: 'mu u' }, unidad(it));
          const sl = e('select', { 'aria-label': 'Insumo', onchange: (ev) => { it.insumo_id = Number(ev.target.value) || null; u.textContent = unidad(it); totales(); } },
            e('option', { value: '' }, 'Elige insumo'), ...insumos.map((i) => e('option', { value: i.id, selected: i.id === it.insumo_id }, `${i.nombre} (${i.unidad})`)));
          const q = e('input', { type: 'number', min: '0', step: 'any', value: it.cantidad, 'aria-label': 'Cantidad', oninput: (ev) => { it.cantidad = ev.target.value; totales(); } });
          return e('div', { class: 'ing' }, sl, q, u, e('button', { class: 'mini', type: 'button', 'aria-label': 'Quitar ingrediente', onclick: () => { ing.splice(idx, 1); pintarFilas(); totales(); } }, 'Quitar'));
        }));
      }
      const br = e('button', { class: 'btn', type: 'submit' }, rec ? 'Guardar receta' : 'Crear receta');
      const form = e('form', { onsubmit: enviar(br, errR, async () => {
        const cuerpo = { rinde: Number(rinde.value), ingredientes: ing.map((i) => ({ insumo_id: i.insumo_id, cantidad: Number(i.cantidad) })) };
        if (rec) await X.api('/recetas/' + rec.id, { method: 'PUT', body: cuerpo }); else await X.api('/recetas', { method: 'POST', body: { producto_id: p.id, ...cuerpo } });
        await cargar(p.id); const m = der.querySelector('.okmsg.rec'); if (m) m.textContent = 'Receta guardada.';
      }) }, e('label', {}, 'Rinde (piezas que salen de esta receta)', rinde),
        e('p', { class: 'mu' }, 'Las cantidades son para todo el lote. Al vender se descuenta cantidad ÷ rinde por cada pieza.'),
        filas, e('button', { class: 'btn s', type: 'button', style: 'width:auto', onclick: () => { ing.push({ insumo_id: null, cantidad: '' }); pintarFilas(); } }, '+ Ingrediente'), tot, errR, e('p', { class: 'okmsg rec', role: 'status' }), br);
      const acciones = [];
      {
        const errE = e('div', { class: 'errbox', role: 'alert' });
        const eliminar = e('button', { class: 'btn s', type: 'button', onclick: async () => {
          if (eliminar.dataset.c !== '1') { eliminar.dataset.c = '1'; eliminar.textContent = '¿Seguro? Se borrará el producto y su receta. Pulsa de nuevo para confirmar'; return; }
          errE.replaceChildren();
          try {
            const r = await X.api('/admin/productos/' + p.id, { method: 'DELETE' });
            await cargar(r.archivado ? p.id : null);
            if (r.archivado) { const m = der.querySelector('.okmsg'); if (m) m.textContent = 'Este producto ya tiene ventas, así que se desactivó en lugar de borrarse para conservar el historial de pedidos.'; }
          } catch (er) { errE.replaceChildren(e('div', {}, er.message)); eliminar.dataset.c = ''; eliminar.textContent = 'Eliminar producto'; }
        } }, 'Eliminar producto');
        acciones.push(errE, e('p', { class: 'mu' }, 'Eliminar borra el producto junto con su receta. Si prefieres conservarlo, usa “Desactivar producto”.'), e('div', { class: 'row' }, eliminar));
      }
      pintarFilas(); totales();
      der.replaceChildren(e('div', { class: 'card' }, e('h3', {}, 'Datos del producto'), datos, msgP),
        e('div', { class: 'card' }, e('h3', {}, rec ? `Receta de ${p.nombre}` : `Receta de ${p.nombre} (aún no tiene)`), form, ...acciones));
    }
    function formProducto() {
      const n = e('input', { required: true, maxlength: 80 }), d = e('input', { maxlength: 300 }), pr = e('input', { type: 'number', min: '0', step: '0.01', required: true });
      const err = e('div', { class: 'errbox', role: 'alert' }), b = e('button', { class: 'btn', type: 'submit' }, 'Crear producto');
      der.replaceChildren(e('div', { class: 'card' }, e('h3', {}, 'Nuevo producto'), e('p', { class: 'mu' }, 'Nace inactivo: se podrá activar cuando tenga receta.'),
        e('form', { onsubmit: enviar(b, err, async () => {
          const r = await X.api('/admin/productos', { method: 'POST', body: { nombre: n.value, descripcion: d.value, precio: pr.value } }); await cargar(r.producto.id);
        }) }, campo('Nombre', n), campo('Descripción', d), campo('Precio de venta (MXN)', pr), err, b)));
    }
    await cargar();
  }

  registrar('inv', 'Inventario', ['almacen', 'admin'], 3, (cont) => inventario(cont));
  registrar('rec', 'Recetas y costeo', ['admin'], 4, (cont) => recetas(cont));
  return { iniciar, detener, registrar };
})();

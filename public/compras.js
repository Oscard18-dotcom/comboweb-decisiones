// Pedidos a proveedor y proveedores (Sprint 7). Solo administración.
(() => {
  const fd = (f) => (f ? f.split('-').reverse().join('/') : '—');

  Personal.registrar('compras', 'Pedidos a proveedor', ['admin'], 3.5, (cont, H) => {
    const { e, api, num, fecha, campo, chipC, enviar, usuario } = H;
    const caja = () => e('div', { class: 'errbox', role: 'alert' });
    const ok = (t) => e('p', { class: 'okmsg', role: 'status' }, t);
    const nav = e('div', { class: 'seg noprint' }), panel = e('div');
    const SUBS = [['pedidos', 'Pedidos enviados'], ['nuevo', 'Nuevo pedido'], ['prov', 'Proveedores']];
    const ir = (k) => {
      nav.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.s === k));
      panel.replaceChildren(); ({ pedidos, nuevo, prov })[k]();
    };
    SUBS.forEach(([k, n]) => nav.append(e('button', { type: 'button', 'data-s': k, onclick: () => ir(k) }, n)));
    cont.append(e('h2', {}, 'Pedidos a proveedor'), nav, panel);

    // Confirmación en pantalla (sin ventanas emergentes): devuelve una tarjeta con Sí / No
    const confirmar = (mensaje, etiqueta, fn, cancelar) => {
      const err = caja(), si = e('button', { class: 'btn', type: 'button' }, etiqueta), no = e('button', { class: 'btn s', type: 'button', onclick: cancelar }, 'No, volver');
      si.onclick = enviar(si, err, fn);
      return e('div', { class: 'card', role: 'alertdialog' }, e('p', {}, mensaje), err, e('div', { class: 'row' }, si, no));
    };

    /* ===================== PEDIDOS ENVIADOS ===================== */
    async function pedidos() {
      let filtro = '', lista = [];
      const detalle = e('div'), tabla = e('div'), msg = e('div');
      const sel = e('select', { 'aria-label': 'Filtrar por estado', onchange: () => { filtro = sel.value; cargar(); } },
        e('option', { value: '' }, 'Todos'), e('option', { value: 'enviado' }, 'Enviados (por recibir)'), e('option', { value: 'recibido' }, 'Recibidos'), e('option', { value: 'cancelado' }, 'Cancelados'));
      const chipEstado = (p) => chipC({ enviado: 'Enviado', recibido: 'Recibido', cancelado: 'Cancelado' }[p.estado], { enviado: '#3F210E', recibido: '#6A6141', cancelado: '#7D756B' }[p.estado]);
      const chipCorreo = (s) => (!s ? '—' : s === 'enviada' ? chipC('Correo enviado', '#6A6141') : s === 'error' || s === 'fallida' ? chipC('Correo con error', '#B3261E') : chipC('Enviando…', '#3F210E'));
      async function cargar() {
        try {
          lista = (await api('/pedidos-proveedor' + (filtro ? '?estado=' + filtro : ''))).pedidos;
          tabla.replaceChildren(e('div', { class: 'card tw' }, lista.length ? e('table', {}, e('thead', {}, e('tr', {}, ['Folio', 'Fecha', 'Proveedor', 'Insumos', 'Estado', 'Stock', 'Correo', ''].map((x) => e('th', {}, x)))),
            e('tbody', {}, lista.map((p) => e('tr', {}, e('td', {}, e('b', {}, p.folio)), e('td', {}, fecha(p.creado_en)), e('td', {}, p.proveedor),
              e('td', {}, p.items.map((i) => `${i.nombre} ${num(i.cantidad)} ${i.unidad}`).join(', ')), e('td', {}, chipEstado(p)),
              e('td', {}, p.estado === 'cancelado' ? '—' : p.stock_aplicado ? 'Sumado' : 'Falta sumar'), e('td', {}, chipCorreo(p.correo_estado)),
              e('td', { class: 'acc' }, e('button', { class: 'mini', type: 'button', onclick: () => ver(p.id) }, 'Ver'),
                p.estado === 'enviado' ? e('button', { class: 'mini', type: 'button', onclick: () => preguntarRecibir(p) }, 'Marcar recibido') : null,
                p.estado === 'enviado' && !p.stock_aplicado ? e('button', { class: 'mini', type: 'button', onclick: () => preguntarCancelar(p) }, 'Cancelar') : null)))))
            : e('p', { class: 'mu' }, 'Todavía no hay pedidos. Crea el primero en “Nuevo pedido”.')));
        } catch (er) { tabla.replaceChildren(e('p', { class: 'err' }, er.message)); }
      }
      function ver(id) {
        const p = lista.find((x) => x.id === id); if (!p) return;
        const cerrar = e('button', { class: 'btn s', type: 'button', onclick: () => detalle.replaceChildren() }, 'Cerrar');
        detalle.replaceChildren(e('div', { class: 'card' }, e('h3', {}, `Pedido ${p.folio}`),
          e('dl', { class: 'ficha-dl' }, e('dt', {}, 'Proveedor'), e('dd', {}, `${p.proveedor} (${p.proveedor_correo})`), e('dt', {}, 'Enviado'), e('dd', {}, `${fecha(p.creado_en)} por ${p.usuario || '—'}`),
            p.fecha_requerida ? e('dt', {}, 'Lo necesitas para') : null, p.fecha_requerida ? e('dd', {}, fd(p.fecha_requerida)) : null, e('dt', {}, 'Nota'), e('dd', {}, p.nota || '—'),
            e('dt', {}, 'Estado'), e('dd', {}, chipEstado(p)), e('dt', {}, 'Stock'), e('dd', {}, p.estado === 'cancelado' ? 'No se sumó (pedido cancelado)' : p.stock_aplicado ? 'Ya se sumó al inventario' : 'Se sumará al marcar el pedido como recibido'),
            p.recibido_en ? e('dt', {}, 'Recibido') : null, p.recibido_en ? e('dd', {}, fecha(p.recibido_en)) : null, e('dt', {}, 'Correo al proveedor'), e('dd', {}, chipCorreo(p.correo_estado))),
          e('table', {}, e('thead', {}, e('tr', {}, e('th', {}, 'Insumo'), e('th', {}, 'Cantidad pedida'))), e('tbody', {}, p.items.map((i) => e('tr', {}, e('td', {}, i.nombre), e('td', {}, `${num(i.cantidad)} ${i.unidad}`))))), cerrar));
      }
      const preguntarRecibir = (p) => detalle.replaceChildren(confirmar(
        p.stock_aplicado ? `¿Marcar ${p.folio} como recibido? El stock ya se había sumado, así que no cambiará.` : `¿Ya llegó ${p.folio}? Al confirmar, los insumos se suman al stock.`, 'Sí, ya llegó',
        async () => { await api(`/pedidos-proveedor/${p.id}/recibir`, { method: 'POST' }); await cargar(); detalle.replaceChildren(e('div', { class: 'card' }, ok(`Listo: ${p.folio} recibido.`))); }, () => detalle.replaceChildren()));
      const preguntarCancelar = (p) => detalle.replaceChildren(confirmar(`¿Cancelar ${p.folio}? Se le mandará un correo a ${p.proveedor} avisando que no surta el pedido.`, 'Sí, cancelar pedido',
        async () => { await api(`/pedidos-proveedor/${p.id}/cancelar`, { method: 'POST' }); await cargar(); detalle.replaceChildren(e('div', { class: 'card' }, ok(`${p.folio} cancelado y proveedor avisado.`))); }, () => detalle.replaceChildren()));
      panel.append(e('div', { class: 'row filtros' }, e('label', { class: 'chk' }, 'Mostrar: ', sel), e('button', { class: 'btn', type: 'button', onclick: () => ir('nuevo') }, '+ Nuevo pedido')), msg, tabla, detalle);
      await cargar();
    }

    /* ===================== NUEVO PEDIDO ===================== */
    async function nuevo() {
      let provs, insumos;
      try { [provs, insumos] = await Promise.all([api('/proveedores'), api('/inventario')]); } catch (er) { panel.append(e('p', { class: 'err' }, er.message)); return; }
      provs = provs.proveedores; insumos = insumos.insumos.filter((i) => i.activo);
      if (!provs.length) { panel.append(e('div', { class: 'card narrow' }, e('p', {}, 'Primero agrega a tu proveedor: necesitamos su correo para poder mandarle el pedido.'), e('button', { class: 'btn', type: 'button', onclick: () => ir('prov') }, 'Agregar proveedor'))); return; }
      const err = caja(), lineas = e('div'), aviso = e('p', { class: 'aviso', role: 'status' });
      const pv = e('select', { 'aria-label': 'Proveedor', required: true }, e('option', { value: '' }, '— Elige un proveedor —'), ...provs.map((p) => e('option', { value: p.id }, p.nombre)));
      const nota = e('input', { maxlength: 300, placeholder: 'Opcional: horario de entrega, marca…' });
      const provActual = () => provs.find((p) => String(p.id) === pv.value);
      const opcionesInsumo = () => { const p = provActual(); const ids = p && p.insumos.length ? new Set(p.insumos.map((i) => i.id)) : null; return insumos.filter((i) => !ids || ids.has(i.id)); };
      function linea(insumoId, cantidad) {
        const s = e('select', { 'aria-label': 'Insumo' }, e('option', { value: '' }, '— Insumo —'), ...opcionesInsumo().map((i) => e('option', { value: i.id }, `${i.nombre} (hay ${num(i.stock)} ${i.unidad})`)));
        const c = e('input', { type: 'number', min: '0', step: 'any', 'aria-label': 'Cantidad', placeholder: 'Cantidad' }), u = e('span', { class: 'mu u' }, '');
        if (insumoId) s.value = String(insumoId); if (cantidad) c.value = String(cantidad);
        const act = () => { const i = insumos.find((x) => String(x.id) === s.value); u.textContent = i ? i.unidad : ''; }; s.onchange = act; act();
        const fila = e('div', { class: 'lp' }, s, c, u, e('button', { class: 'mini', type: 'button', 'aria-label': 'Quitar este insumo', onclick: () => fila.remove() }, '✕'));
        fila.leer = () => ({ insumo_id: s.value, cantidad: c.value });
        lineas.append(fila); return fila;
      }
      const filas = () => [...lineas.children];
      pv.onchange = () => {
        const p = provActual();
        aviso.textContent = p ? `Se enviará un correo a ${p.nombre} (${p.correo}). Si responde, su respuesta llegará a ${usuario.correo}. Las cantidades se suman al stock automáticamente al enviar.` : '';
        const previas = filas().map((f) => f.leer()); lineas.replaceChildren();
        const permitidos = new Set(opcionesInsumo().map((i) => String(i.id)));
        previas.filter((x) => x.insumo_id && permitidos.has(x.insumo_id)).forEach((x) => linea(x.insumo_id, x.cantidad));
        if (!filas().length) linea();
      };
      linea();
      const sug = e('button', { class: 'btn s', type: 'button' }, 'Agregar lo que está en reorden');
      sug.onclick = enviar(sug, err, async () => {
        if (!pv.value) throw new Error('Primero elige el proveedor.');
        const { sugerencias } = await api('/pedidos-proveedor/sugerencias?proveedor_id=' + pv.value);
        if (!sugerencias.length) throw new Error('No hay insumos en reorden para este proveedor: todo está por arriba del mínimo.');
        const ya = new Set(filas().map((f) => f.leer().insumo_id));
        filas().filter((f) => !f.leer().insumo_id && !f.leer().cantidad).forEach((f) => f.remove());
        sugerencias.filter((x) => !ya.has(String(x.id))).forEach((x) => linea(x.id, x.sugerido));
      });
      const b = e('button', { class: 'btn', type: 'submit' }, 'Enviar pedido al proveedor');
      const f = e('form', { onsubmit: enviar(b, err, async () => {
        if (!pv.value) throw new Error('Elige un proveedor.');
        const items = filas().map((x) => x.leer()).filter((x) => x.insumo_id || x.cantidad);
        if (!items.length) throw new Error('Agrega al menos un insumo con su cantidad.');
        if (items.some((x) => !x.insumo_id || !(Number(x.cantidad) > 0))) throw new Error('Cada renglón necesita un insumo y una cantidad mayor a 0.');
        if (new Set(items.map((x) => x.insumo_id)).size !== items.length) throw new Error('Un insumo está repetido: súmalo en un solo renglón.');
        const r = await api('/pedidos-proveedor', { method: 'POST', body: { proveedor_id: pv.value, items, nota: nota.value || undefined, suma_stock_en: 'envio' } });
        const p = r.pedido; panel.replaceChildren(e('div', { class: 'card narrow' }, e('h3', {}, `Pedido ${p.folio} enviado`),
          ok(`Se mandó un correo a ${p.proveedor} (${p.proveedor_correo}) con ${p.items.length} insumo(s).`),
          e('p', {}, 'El stock ya se sumó al inventario.'),
          e('div', { class: 'row' }, e('button', { class: 'btn', type: 'button', onclick: () => ir('pedidos') }, 'Ver pedidos'), e('button', { class: 'btn s', type: 'button', onclick: () => ir('nuevo') }, 'Hacer otro pedido'))));
      }) }, campo('Proveedor', pv), aviso, e('h3', {}, 'Qué necesitas'), lineas,
        e('div', { class: 'row' }, e('button', { class: 'btn s', type: 'button', onclick: () => linea() }, '+ Agregar insumo'), sug),
        campo('Nota para el proveedor (opcional)', nota),
        err, b);
      panel.append(e('div', { class: 'card' }, f));
    }

    /* ===================== PROVEEDORES ===================== */
    async function prov() {
      let lista = [], insumos = [], archivados = false;
      const tabla = e('div'), form = e('div');
      try { insumos = (await api('/inventario')).insumos.filter((i) => i.activo); } catch (er) { panel.append(e('p', { class: 'err' }, er.message)); return; }
      const chkArch = e('input', { type: 'checkbox', onchange: () => { archivados = chkArch.checked; cargar(); } });
      async function cargar() {
        try {
          lista = (await api('/proveedores' + (archivados ? '?inactivos=1' : ''))).proveedores;
          tabla.replaceChildren(e('div', { class: 'card tw' }, lista.length ? e('table', {}, e('thead', {}, e('tr', {}, ['Proveedor', 'Correo', 'Contacto', 'Teléfono', 'Surte', 'Pedidos', ''].map((x) => e('th', {}, x)))),
            e('tbody', {}, lista.map((p) => e('tr', {}, e('td', {}, e('b', {}, p.nombre), p.activo ? null : e('span', {}, ' ', chipC('Archivado', '#7D756B'))), e('td', {}, p.correo), e('td', {}, p.contacto || '—'), e('td', {}, p.telefono || '—'),
              e('td', {}, p.insumos.length ? p.insumos.map((i) => i.nombre).join(', ') : 'Cualquier insumo'), e('td', {}, String(p.pedidos)),
              e('td', { class: 'acc' }, e('button', { class: 'mini', type: 'button', onclick: () => editar(p) }, 'Editar'),
                p.activo ? e('button', { class: 'mini', type: 'button', onclick: () => preguntarEliminar(p) }, 'Eliminar') : null)))))
            : e('p', { class: 'mu' }, 'Aún no hay proveedores. Agrega el primero con el botón de arriba.')));
        } catch (er) { tabla.replaceChildren(e('p', { class: 'err' }, er.message)); }
      }
      function editar(p) {
        const n = e('input', { required: true, minlength: 2, maxlength: 80, value: p ? p.nombre : '' }), c = e('input', { type: 'email', required: true, maxlength: 120, value: p ? p.correo : '' }),
          ct = e('input', { maxlength: 80, value: p && p.contacto ? p.contacto : '' }), tl = e('input', { type: 'tel', maxlength: 30, value: p && p.telefono ? p.telefono : '' }), nt = e('input', { maxlength: 300, value: p && p.notas ? p.notas : '' });
        const marcados = new Set(p ? p.insumos.map((i) => i.id) : []);
        const cks = insumos.map((i) => { const k = e('input', { type: 'checkbox', value: i.id }); k.checked = marcados.has(i.id); return [i, k]; });
        const act = e('input', { type: 'checkbox' }); act.checked = p ? p.activo : true;
        const err = caja(), b = e('button', { class: 'btn', type: 'submit' }, p ? 'Guardar cambios' : 'Guardar proveedor');
        const cerrar = e('button', { class: 'btn s', type: 'button', onclick: () => form.replaceChildren() }, 'Cancelar');
        const f = e('form', { onsubmit: enviar(b, err, async () => {
          const body = { nombre: n.value, correo: c.value, contacto: ct.value, telefono: tl.value, notas: nt.value, insumos: cks.filter(([, k]) => k.checked).map(([i]) => i.id) };
          if (p) body.activo = act.checked;
          await api(p ? `/proveedores/${p.id}` : '/proveedores', { method: p ? 'PUT' : 'POST', body });
          await cargar(); form.replaceChildren(e('div', { class: 'card' }, ok(p ? 'Proveedor actualizado.' : 'Proveedor agregado.')));
        }) }, campo('Nombre del proveedor', n), campo('Correo (aquí se mandan los pedidos)', c), campo('Persona de contacto (opcional)', ct), campo('Teléfono (opcional)', tl), campo('Notas (opcional)', nt),
          e('h3', {}, '¿Qué insumos te surte?'), e('p', { class: 'mu' }, 'Si no marcas ninguno, podrás pedirle cualquier insumo.'),
          e('div', { class: 'lista-insumos' }, ...cks.map(([i, k]) => e('label', { class: 'chk' }, k, `${i.nombre} (${i.unidad})`))),
          p ? e('label', { class: 'chk' }, act, 'Proveedor activo') : null, err, e('div', { class: 'row' }, b, cerrar));
        form.replaceChildren(e('div', { class: 'card' }, e('h3', {}, p ? `Editar · ${p.nombre}` : 'Agregar proveedor'), f)); form.scrollIntoView && form.scrollIntoView({ block: 'nearest' });
      }
      const preguntarEliminar = (p) => form.replaceChildren(confirmar(
        p.pedidos ? `¿Eliminar a ${p.nombre}? Como ya tiene pedidos, se archivará: dejará de aparecer para nuevos pedidos pero tu historial se conserva.` : `¿Eliminar a ${p.nombre}? Esta acción no se puede deshacer.`, 'Sí, eliminar',
        async () => { const r = await api(`/proveedores/${p.id}`, { method: 'DELETE' }); await cargar(); form.replaceChildren(e('div', { class: 'card' }, ok(r.archivado ? `${p.nombre} se archivó (su historial se conserva).` : `${p.nombre} se eliminó.`))); }, () => form.replaceChildren()));
      panel.append(e('div', { class: 'row filtros' }, e('button', { class: 'btn', type: 'button', onclick: () => editar(null) }, '+ Agregar proveedor'), e('label', { class: 'chk' }, chkArch, 'Ver archivados')), form, tabla);
      await cargar();
    }

    ir('pedidos');
  });
})();

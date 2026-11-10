Personal.registrar('tab', 'Tablero de pedidos', ['cocina', 'admin'], 2, (cont, H) => {
  const { e, api, chipC } = H;
  const COLS = [['Pendiente', '#6A6141', 'Iniciar', 'En preparación'], ['En preparación', '#3F210E', 'Marcar listo', 'Listo para entrega'], ['Listo para entrega', '#3E5B3A', 'Entregar', 'Entregado'], ['Entregado', '#7D756B', null, null]];
  const fd = (f) => f.split('-').reverse().join('/');
  let fecha = '', datos = null, sel = null, cargando = false, pendiente = false;
  const err = e('div', { class: 'errbox', role: 'alert' }), estado = e('small', { class: 'mu' });
  const inp = e('input', { type: 'date', 'aria-label': 'Fecha del tablero', onchange: (ev) => { fecha = ev.target.value; cargar(); } });
  const tablero = e('div', { class: 'kb' }), ficha = e('div', { class: 'ficha' });
  cont.append(e('div', { class: 'row filtros noprint' }, e('h2', { style: 'margin:0' }, 'Pedidos del día'), inp,
    e('button', { class: 'mini', type: 'button', onclick: () => { fecha = ''; cargar(); } }, 'Hoy'), e('button', { class: 'mini', type: 'button', onclick: () => cargar() }, 'Actualizar'), estado), err, tablero, ficha);

  async function cargar() {
    if (cargando) { pendiente = true; return; }
    cargando = true;
    do {
      pendiente = false;
      const pedida = fecha;
      try {
        const d = await api('/cocina/pedidos' + (pedida ? '?fecha=' + encodeURIComponent(pedida) : ''));
        if (fecha !== pedida) continue;
        datos = d; fecha = d.fecha; inp.value = fecha; pintar();
        estado.textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) + ' · se actualiza solo cada 20 s';
      } catch (er) { err.replaceChildren(e('div', {}, er.message)); }
    } while (pendiente);
    cargando = false;
  }
  async function avanzar(p, objetivo, boton) {
    boton.disabled = true; err.replaceChildren();
    try { await api(`/cocina/pedidos/${p.id}/estatus`, { method: 'PATCH', body: { estatus: objetivo } }); sel = p.id; }
    catch (er) { err.replaceChildren(e('div', {}, `${p.folio}: ${er.message}`)); }
    await cargar();
  }
  function tarjeta(p, accion, siguiente) {
    const abrir = () => { sel = p.id; pintar(); };
    return e('div', { class: 'oc' + (sel === p.id ? ' on' : '') + (p.atrasado ? ' atr' : ''), role: 'button', tabindex: '0', 'aria-label': `Pedido ${p.folio}`, onclick: abrir, onkeydown: (ev) => { if (ev.key === 'Enter') abrir(); } },
      e('b', {}, p.folio), e('small', { class: 'mu' }, (p.atrasado ? `⚠ Atrasado (${fd(p.fecha)}) · ` : '') + `${p.hora} h · ${p.cliente}`),
      e('span', {}, p.items.map((i) => `${i.nombre} x${i.cantidad}`).join(', ')),
      e('span', { class: 'dir' }, p.direccion ? `📍 ${p.direccion.calle} ${p.direccion.num_ext}, Col. ${p.direccion.colonia}` : '📍 Sin dirección registrada'), p.dedicatoria ? e('span', { class: 'ded' }, '🎂 ' + p.dedicatoria) : null,
      accion ? e('button', { class: 'btn', type: 'button', onclick: (ev) => { ev.stopPropagation(); avanzar(p, siguiente, ev.currentTarget); } }, accion) : null);
  }
  function pintar() {
    tablero.replaceChildren(...COLS.map(([est, color, accion, sig]) => {
      const l = datos.pedidos.filter((p) => p.estatus === est);
      return e('div', { class: 'col' }, chipC(`${est} (${l.length})`, color), ...l.map((p) => tarjeta(p, accion, sig)));
    }));
    if (!datos.pedidos.length) tablero.append(e('p', { class: 'mu' }, 'No hay pedidos para este día.'));
    const p = datos.pedidos.find((x) => x.id === sel);
    ficha.replaceChildren(...(p ? [e('div', { class: 'card' }, e('h3', {}, `Ficha técnica · ${p.folio}`), chipC(p.estatus, (COLS.find((c) => c[0] === p.estatus) || [])[1] || '#7D756B'),
      e('dl', {}, e('dt', {}, 'Cliente'), e('dd', {}, p.cliente), e('dt', {}, 'Entrega'), e('dd', {}, `${fd(p.fecha)} a las ${p.hora} h`),
        e('dt', {}, 'Dirección'), e('dd', {}, p.direccion ? [`${p.direccion.calle} ${p.direccion.num_ext}${p.direccion.num_int ? ' int. ' + p.direccion.num_int : ''}`, e('br'), `Col. ${p.direccion.colonia}`, e('br'), `C.P. ${p.direccion.cp} · ${p.direccion.municipio}${p.direccion.estado ? ', ' + p.direccion.estado : ''}`] : 'Sin dirección registrada (pedido anterior)'),
        p.direccion && p.direccion.referencias ? [e('dt', {}, 'Referencias'), e('dd', {}, p.direccion.referencias)] : null,
        p.presentacion ? [e('dt', {}, 'Presentación'), e('dd', {}, p.presentacion)] : null,
        e('dt', {}, 'Combo'), e('dd', {}, p.items.map((i) => `${i.nombre} x${i.cantidad}`).join(', '))),
      p.dedicatoria ? e('span', { class: 'ded' }, '🎂 Dedicatoria: ' + p.dedicatoria) : e('p', { class: 'mu' }, 'Sin dedicatoria.'),
      e('h3', { style: 'margin-top:10px' }, 'Ingredientes'),
      ...(p.ingredientes.length ? p.ingredientes.map((i) => e('div', { class: 'ln' }, e('span', {}, i.nombre), e('span', {}, `${H.num(i.cantidad)} ${i.unidad}`))) : [e('p', { class: 'mu' }, 'Sin receta registrada.')]))] : []));
  }
  cargar(); H.cada(20000, cargar);
});

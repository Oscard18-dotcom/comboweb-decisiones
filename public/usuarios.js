(() => {
  const costo = (n) => Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  const ROL = { cliente: 'Cliente', cocina: 'Cocina', almacen: 'Almacén', admin: 'Administrador' };
  function generar() {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', n = new Uint32Array(12);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(n); else n.forEach((_, i) => { n[i] = Math.floor(Math.random() * 4294967295); });
    return Array.from(n, (x) => abc[x % abc.length]).join('') + '-7';
  }

  Personal.registrar('usr', 'Usuarios', ['admin'], 6, (cont, H) => {
    const { e, api, campo, enviar, chipC } = H;
    let lista = [], verClientes = false, filtro = '';
    const tabla = e('div', { class: 'card tw' }), panel = e('div'), err = e('div', { class: 'errbox', role: 'alert' });
    const cCli = e('input', { type: 'checkbox', onchange: (ev) => { verClientes = ev.target.checked; pintar(); } });
    const buscar = e('input', { type: 'search', placeholder: 'Buscar por nombre o correo…', 'aria-label': 'Buscar usuario', oninput: (ev) => { filtro = ev.target.value.toLowerCase(); pintar(); } });
    cont.append(e('div', { class: 'two' }, e('div', {}, e('div', { class: 'row filtros' }, buscar, e('label', { class: 'chk' }, cCli, 'Ver también clientes'),
      e('button', { class: 'btn', type: 'button', style: 'width:auto', onclick: () => formNuevo() }, '+ Nuevo usuario del personal')), err, tabla), panel));
    const cerrar = e('button', { class: 'mini', type: 'button', onclick: () => panel.replaceChildren() }, 'Cerrar');
    const caja = () => e('div', { class: 'errbox', role: 'alert' });
    const ok = (t) => e('p', { class: 'okmsg', role: 'status' }, t);

    async function cargar() { try { lista = (await api('/admin/usuarios')).usuarios; pintar(); } catch (er) { err.replaceChildren(e('div', {}, er.message)); } }
    function pintar() {
      const filas = lista.filter((u) => (verClientes || u.rol !== 'cliente') && (!filtro || (u.nombre + ' ' + u.correo).toLowerCase().includes(filtro)));
      const yo = H.usuario.id;
      tabla.replaceChildren(e('table', {}, e('thead', {}, e('tr', {}, ['Nombre', 'Correo', 'Rol', 'Estado', 'Acciones'].map((x) => e('th', {}, x)))),
        e('tbody', {}, filas.map((u) => {
          const sel = e('select', { 'aria-label': `Rol de ${u.nombre}`, onchange: (ev) => cambiarRol(u, ev.target.value, ev.target) }, ...['cocina', 'almacen', 'admin', 'cliente'].map((r) => e('option', { value: r, selected: u.rol === r }, ROL[r])));
          return e('tr', {}, e('td', {}, u.nombre + (u.id === yo ? ' (tú)' : '')), e('td', {}, u.correo), e('td', {}, sel), e('td', {}, u.activo ? chipC('Activo', '#3E5B3A') : chipC('Inactivo', '#7D756B')),
            e('td', { class: 'acc' }, e('button', { class: 'mini', type: 'button', onclick: () => confirmarEstado(u) }, u.activo ? 'Dar de baja' : 'Reactivar'), e('button', { class: 'mini', type: 'button', onclick: () => formClave(u) }, 'Restablecer contraseña')));
        }))), filas.length ? null : e('p', { class: 'mu', style: 'padding:8px' }, 'No hay usuarios que coincidan.'));
    }
    async function cambiarRol(u, rol, sel) {
      err.replaceChildren();
      try { await api(`/admin/usuarios/${u.id}`, { method: 'PATCH', body: { rol } }); panel.replaceChildren(e('div', { class: 'card' }, ok(`${u.nombre} ahora es ${ROL[rol]}.`), cerrar)); }
      catch (er) { err.replaceChildren(e('div', {}, er.message)); sel.value = u.rol; }
      await cargar();
    }
    function confirmarEstado(u) {
      const er = caja(), accion = u.activo ? 'dar de baja' : 'reactivar';
      const si = e('button', { class: 'btn', type: 'button', onclick: async () => {
        er.replaceChildren();
        try { await api(`/admin/usuarios/${u.id}`, { method: 'PATCH', body: { activo: !u.activo } }); await cargar(); panel.replaceChildren(e('div', { class: 'card' }, ok(`${u.nombre} quedó ${u.activo ? 'dado de baja' : 'activo'}.`), cerrar)); }
        catch (x) { er.replaceChildren(e('div', {}, x.message)); }
      } }, `Sí, ${accion}`);
      panel.replaceChildren(e('div', { class: 'card' }, e('h3', {}, `¿${accion[0].toUpperCase() + accion.slice(1)} a ${u.nombre}?`), e('p', {}, u.activo ? 'Ya no podrá iniciar sesión. Su historial se conserva.' : 'Podrá volver a iniciar sesión.'), er, e('div', { class: 'row' }, si, cerrar)));
    }
    function formClave(u) {
      const c = e('input', { type: 'text', value: generar(), autocomplete: 'off', 'aria-label': 'Contraseña temporal', required: true }), er = caja(), b = e('button', { class: 'btn', type: 'submit' }, 'Restablecer contraseña');
      const f = e('form', { onsubmit: enviar(b, er, async () => {
        await api(`/admin/usuarios/${u.id}/password`, { method: 'PATCH', body: { password: c.value } });
        panel.replaceChildren(e('div', { class: 'card' }, ok(`Contraseña de ${u.nombre} restablecida: ${c.value}`), e('p', { class: 'mu' }, 'Entrégasela en persona. Se cerraron todas sus sesiones y debe cambiarla en “Mi cuenta”.'), cerrar));
      }) }, campo('Contraseña temporal (mínimo 8 caracteres)', c), e('button', { class: 'mini', type: 'button', onclick: () => { c.value = generar(); } }, 'Generar otra'), er, b);
      panel.replaceChildren(e('div', { class: 'card' }, e('h3', {}, `Restablecer contraseña · ${u.nombre}`), f, cerrar));
    }
    function formNuevo() {
      const n = e('input', { required: true, maxlength: 80 }), co = e('input', { type: 'email', required: true, maxlength: 120 }), c = e('input', { type: 'text', value: generar(), autocomplete: 'off', required: true });
      const rol = e('select', { 'aria-label': 'Rol' }, ...['cocina', 'almacen', 'admin'].map((r) => e('option', { value: r }, ROL[r])));
      const er = caja(), b = e('button', { class: 'btn', type: 'submit' }, 'Crear usuario');
      const f = e('form', { onsubmit: enviar(b, er, async () => {
        const r = await api('/admin/usuarios', { method: 'POST', body: { nombre: n.value, correo: co.value, password: c.value, rol: rol.value } });
        await cargar(); panel.replaceChildren(e('div', { class: 'card' }, ok(`Usuario creado: ${r.usuario.correo} (${ROL[r.usuario.rol]})`), e('p', {}, `Contraseña temporal: ${c.value}`), e('p', { class: 'mu' }, 'Entrégasela en persona; debe cambiarla en “Mi cuenta” al entrar.'), cerrar));
      }) }, campo('Nombre completo', n), campo('Correo', co), campo('Rol', rol), campo('Contraseña temporal', c), e('button', { class: 'mini', type: 'button', onclick: () => { c.value = generar(); } }, 'Generar otra'), er, b);
      panel.replaceChildren(e('div', { class: 'card' }, e('h3', {}, 'Nuevo usuario del personal'), f, cerrar));
    }
    cargar();
  });

  Personal.registrar('cat', 'Catálogo y precios', ['admin'], 4.5, (cont, H) => {
    const { e, api, chipC } = H;
    const err = e('div', { class: 'errbox', role: 'alert' }), msg = e('p', { class: 'okmsg', role: 'status' }), prods = e('div', { class: 'card tw' }), combosT = e('div', { class: 'card tw' });
    cont.append(e('p', { class: 'mu' }, 'Los cambios de precio aplican a los pedidos nuevos; los pedidos ya pagados conservan su precio. Para crear productos o editar sus recetas usa “Recetas y costeo”.'), err, msg,
      e('h3', {}, 'Productos'), prods, e('h3', { style: 'margin-top:14px' }, 'Combos'), combosT);
    const ok = (t) => { msg.textContent = t; err.replaceChildren(); };
    const mal = (er) => { msg.textContent = ''; err.replaceChildren(e('div', {}, er.message)); };
    const precio = (v) => e('input', { type: 'number', min: '0', step: '0.01', value: String(v), 'aria-label': 'Precio', style: 'width:100px' });
    async function cargar() {
      try {
        const [p, ct] = await Promise.all([api('/admin/productos'), api('/catalogo')]);
        combosT.replaceChildren(e('table', {}, e('thead', {}, e('tr', {}, ['Combo', 'Productos', 'Precio (MXN)'].map((x) => e('th', {}, x)))),
          e('tbody', {}, ...ct.combos.map((c) => e('tr', {}, e('td', {}, c.nombre), e('td', {}, c.productos.map((x) => x.nombre).join(' + ')), e('td', {}, '$' + c.precio.toFixed(2)))), e('tr', {}, e('td', {}, ct.combo_personalizado.nombre), e('td', {}, 'El cliente elige los productos'), e('td', {}, 'Suma de lo que elija')))),
          e('p', { class: 'mu' }, 'El precio de cada combo es la suma de los precios de sus productos: al cambiar el precio de un producto, el combo se actualiza solo.'));
        prods.replaceChildren(e('table', {}, e('thead', {}, e('tr', {}, ['Producto', 'Precio de venta (MXN)', 'Receta', 'Estado', 'Acciones'].map((x) => e('th', {}, x)))),
          e('tbody', {}, p.productos.map((x) => {
            const inp = precio(x.precio);
            return e('tr', {}, e('td', {}, x.nombre), e('td', {}, inp), e('td', {}, x.tiene_receta ? 'Sí' : chipC('Sin receta', '#6A6141')), e('td', {}, x.activo ? chipC('Activo', '#3E5B3A') : chipC('Inactivo', '#7D756B')),
              e('td', { class: 'acc' },
                e('button', { class: 'mini', type: 'button', 'aria-label': `Guardar precio de ${x.nombre}`, onclick: async () => { try { await api('/admin/productos/' + x.id, { method: 'PUT', body: { nombre: x.nombre, descripcion: x.descripcion, precio: inp.value } }); ok(`Precio de ${x.nombre} guardado.`); await cargar(); } catch (er) { mal(er); } } }, 'Guardar precio'),
                e('button', { class: 'mini', type: 'button', onclick: async () => { try { await api(`/admin/productos/${x.id}/activo`, { method: 'PATCH', body: { activo: !x.activo } }); ok(`${x.nombre} ${x.activo ? 'desactivado' : 'activado'}.`); await cargar(); } catch (er) { mal(er); } } }, x.activo ? 'Desactivar' : 'Activar')));
          }))));
      } catch (er) { mal(er); }
    }
    cargar();
  });
})();

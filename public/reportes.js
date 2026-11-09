(() => {
  const fd = (f) => f.split('-').reverse().join('/');
  const mx = (n) => Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  const iso = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  const irA = (k) => { const b = document.querySelector(`#staff .seg button[data-k="${k}"]`); if (b) b.click(); };
  const mas = (f, n) => { const d = new Date(f + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };

  Personal.registrar('dash', 'Dashboard', ['admin'], 1, (cont, H) => {
    const { e, api, chipC } = H;
    const raiz = e('div'); cont.append(raiz);
    const kp = (t, v, color) => e('div', { class: 'card' }, e('small', { class: 'mu' }, t), e('b', { style: color ? 'color:' + color : '' }, v));
    async function cargar() {
      try {
        const d = await api('/reportes/dashboard');
        const fallos = d.notificaciones.fallidas + d.notificaciones.con_error > 0
          ? [...(await api('/notificaciones?estado=fallida')).notificaciones, ...(await api('/notificaciones?estado=error')).notificaciones] : [];
        pintar(d, fallos);
      } catch (er) { raiz.replaceChildren(e('p', { class: 'err' }, er.message)); }
    }
    function pintar(d, fallos) {
      const ST = { Pendiente: '#6A6141', 'En preparación': '#3F210E', 'Listo para entrega': '#3E5B3A', Entregado: '#7D756B' };
      const total = d.ventas_7_dias.reduce((a, x) => ({ p: a.p + x.pedidos, v: a.v + x.ventas }), { p: 0, v: 0 });
      raiz.replaceChildren(
        e('div', { class: 'kp' }, kp('Ventas de hoy', mx(d.ventas_hoy)), kp('Pedidos de hoy', String(d.pedidos_hoy)), kp('Entregas pendientes hoy', String(d.entregas_pendientes_hoy), d.entregas_pendientes_hoy ? '#6A6141' : ''),
          kp('Insumos en reorden', String(d.insumos_en_reorden), d.insumos_en_reorden ? '#B3261E' : ''), kp('Pedidos a proveedor por recibir', String(d.pedidos_proveedor_por_recibir || 0))),
        e('div', { class: 'card' }, e('h3', {}, 'Pedidos por estatus'), e('div', { class: 'row', style: 'margin:0' }, ...Object.entries(d.por_estatus).map(([k, v]) => e('span', {}, chipC(k, ST[k]), ` ${v}`)))),
        e('div', { class: 'card' }, e('h3', {}, 'Última decisión registrada'),
          d.decisiones && d.decisiones.ultima
            ? e('div', { class: 'row', style: 'margin:0;align-items:center' }, e('span', {}, `${d.decisiones.ultima.titulo} → `, e('b', {}, d.decisiones.ultima.alternativa), ` · ${new Date(d.decisiones.ultima.creado_en).toLocaleDateString('es-MX')} · ${d.decisiones.total} en total`),
              e('button', { class: 'mini', type: 'button', onclick: () => irA('dec') }, 'Abrir toma de decisiones'))
            : e('div', { class: 'row', style: 'margin:0;align-items:center' }, e('span', { class: 'mu' }, 'Aún no se registran decisiones.'), e('button', { class: 'mini', type: 'button', onclick: () => irA('dec') }, 'Abrir toma de decisiones'))),
        d.pagos_en_revision ? e('div', { class: 'alerta', role: 'alert' }, e('b', {}, `⚠ ${d.pagos_en_revision} pago(s) cobrado(s) sin pedido: requieren reembolso o atención manual desde el panel de la pasarela de pago.`),
          ...d.pagos_revision.map((x) => e('div', {}, `${x.cliente} · ${mx(x.total)} · ${x.proveedor} · ref. ${x.referencia || '—'} · ${new Date(x.creado_en).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}`))) : null,
        fallos.length ? e('div', { class: 'alerta', role: 'alert' }, e('b', {}, `⚠ ${fallos.length} aviso(s) por correo no se han podido enviar`),
          ...fallos.map((n) => e('div', { class: 'row', style: 'margin:4px 0;align-items:center' }, e('span', {}, `${n.folio} → ${n.destinatario} (${n.estado}, ${n.intentos} intentos): ${n.ultimo_error || ''}`),
            e('button', { class: 'mini', type: 'button', onclick: async (ev) => { ev.target.disabled = true; try { await api(`/notificaciones/${n.id}/reintentar`, { method: 'POST' }); } catch (er) {  } await cargar(); } }, 'Reintentar')))) : null,
        e('div', { class: 'grid2' },
          e('section', { class: 'card' }, e('h3', {}, 'Alertas de reorden'), ...(d.alertas_reorden.length ? d.alertas_reorden.map((i) => e('div', { class: 'ln' }, e('span', {}, i.nombre), e('span', { class: 'bajo' }, `${H.num(i.stock)} de ${H.num(i.stock_minimo)} ${i.unidad}`))) : [e('p', { class: 'mu' }, 'Sin alertas.')])),
          e('section', { class: 'card' }, e('h3', {}, 'Próximas entregas'), ...(d.proximas_entregas.length ? d.proximas_entregas.map((x) => e('div', { class: 'ln' }, e('span', {}, `${x.folio} · ${fd(x.fecha)} ${x.hora}`), chipC(x.estatus, ST[x.estatus]))) : [e('p', { class: 'mu' }, 'Sin entregas pendientes.')]))),
        e('section', { class: 'card tw' }, e('h3', {}, 'Ventas de los últimos 7 días'),
          e('table', { class: 'contable' }, e('thead', {}, e('tr', {}, e('th', {}, 'Fecha'), e('th', { class: 'n' }, 'Pedidos'), e('th', { class: 'n' }, 'Ventas'))),
            e('tbody', {}, ...d.ventas_7_dias.map((x) => e('tr', {}, e('td', {}, fd(x.fecha)), e('td', { class: 'n' }, String(x.pedidos)), mon(e, x.ventas))),
              e('tr', { class: 'total' }, e('td', {}, 'Suma'), e('td', { class: 'n' }, String(total.p)), mon(e, total.v))))));
    }
    cargar(); H.cada(30000, cargar);
  });

  function mon(e, n) {
    const v = Number(n), t = Math.abs(v).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return e('td', { class: 'mon' + (v < 0 ? ' neg' : '') }, e('span', {}, '$'), e('span', {}, v < 0 ? `(${t})` : t));
  }

  Personal.registrar('rep', 'Reportes', ['admin'], 5, (cont, H) => {
    const { e, api } = H;
    const hoy = iso(new Date());
    let tipo = 'ventas', desde = mas(hoy, -29), hasta = hoy, agrupar = 'dia';
    const resultado = e('div', { class: 'imprimible' }), err = e('div', { class: 'errbox', role: 'alert' });
    const tabs = e('div', { class: 'seg noprint' });
    const fDesde = e('input', { type: 'date', value: desde, 'aria-label': 'Desde', onchange: (ev) => { desde = ev.target.value; } });
    const fHasta = e('input', { type: 'date', value: hasta, 'aria-label': 'Hasta', onchange: (ev) => { hasta = ev.target.value; } });
    const fAgr = e('select', { 'aria-label': 'Agrupar por', onchange: (ev) => { agrupar = ev.target.value; } }, e('option', { value: 'dia' }, 'Por día'), e('option', { value: 'semana' }, 'Por semana'), e('option', { value: 'mes' }, 'Por mes'));
    const bGen = e('button', { class: 'btn', type: 'submit' }, 'Generar');
    const NOMBRES = { ventas: 'Ventas por periodo', estatus: 'Pedidos por estatus', existencias: 'Existencias de inventario', decisiones: 'Decisiones registradas' };
    const url = (extra = '') => tipo === 'existencias' ? '/reportes/existencias' + (extra ? '?' + extra : '')
      : `/reportes/${tipo}?desde=${desde}&hasta=${hasta}` + (tipo === 'ventas' ? `&agrupar=${agrupar}` : '') + (extra ? '&' + extra : '');
    const form = e('form', { class: 'row filtros noprint', onsubmit: (ev) => { ev.preventDefault(); generar(); } }, fDesde, fHasta, fAgr, bGen,
      e('button', { class: 'btn s', type: 'button', onclick: async () => { err.replaceChildren(); try { await H.descargar(url('formato=csv'), `${tipo}-${hasta}.csv`); } catch (er) { err.replaceChildren(e('div', {}, er.message)); } } }, 'Descargar para Excel (CSV)'),
      e('button', { class: 'btn s', type: 'button', onclick: () => window.print() }, 'Imprimir / guardar PDF'));
    const pestanas = () => tabs.replaceChildren(...Object.entries(NOMBRES).map(([k, n]) => e('button', { type: 'button', class: k === tipo ? 'on' : '', onclick: () => { tipo = k; pestanas(); fAgr.hidden = k !== 'ventas'; fDesde.hidden = fHasta.hidden = k === 'existencias'; generar(); } }, n)));
    pestanas();
    cont.append(tabs, form, err, resultado);

    const th = (t, n) => e('th', { class: n ? 'n' : '' }, t);
    const etiqueta = (p) => agrupar === 'mes' ? new Date(p + 'T12:00:00').toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }) : agrupar === 'semana' ? 'Semana del ' + fd(p) : fd(p);
    const titulo = (t, sub) => [e('h3', { class: 'reporte-tit' }, 'EN COMBO · ' + t), e('p', { class: 'reporte-tit mu' }, sub)];
    async function generar() {
      err.replaceChildren(); resultado.replaceChildren(e('p', { class: 'mu' }, 'Generando…'));
      try {
        const d = await api(url());
        if (tipo === 'ventas') {
          resultado.replaceChildren(e('div', { class: 'card tw' }, ...titulo('Ventas por periodo', `Del ${fd(d.desde)} al ${fd(d.hasta)} · cifras en pesos mexicanos (MXN)`),
            d.periodos.length ? e('table', { class: 'contable' }, e('thead', {}, e('tr', {}, th('Periodo'), th('Pedidos', 1), th('Ventas', 1), th('Costo de insumos', 1), th('Utilidad bruta', 1))),
              e('tbody', {}, ...d.periodos.map((x) => e('tr', {}, e('td', {}, etiqueta(x.periodo)), e('td', { class: 'n' }, String(x.pedidos)), mon(e, x.ventas), mon(e, x.costo), mon(e, x.utilidad))),
                e('tr', { class: 'total' }, e('td', {}, 'Suma'), e('td', { class: 'n' }, String(d.totales.pedidos)), mon(e, d.totales.ventas), mon(e, d.totales.costo), mon(e, d.totales.utilidad))))
              : e('p', { class: 'mu' }, 'No hay ventas en este periodo.'),
            d.periodos.length ? e('p', { class: 'mu' }, `Margen de utilidad bruta: ${d.totales.margen_pct} %. El costo usa los costos unitarios vigentes de los insumos.`) : null),
            d.top_productos.length ? e('div', { class: 'card tw' }, e('h3', {}, 'Productos más vendidos'), e('table', { class: 'contable' }, e('thead', {}, e('tr', {}, th('Producto'), th('Piezas', 1), th('Ventas', 1))),
              e('tbody', {}, ...d.top_productos.map((x) => e('tr', {}, e('td', {}, x.nombre), e('td', { class: 'n' }, String(x.piezas)), mon(e, x.ventas)))))) : null);
        } else if (tipo === 'decisiones') {
          const BASES = { consenso: 'Consenso', maximin: 'Maximin', maximax: 'Maximax', laplace: 'Laplace', hurwicz: 'Hurwicz', savage: 'Savage', vme: 'VME' };
          resultado.replaceChildren(e('div', { class: 'card tw' }, ...titulo('Decisiones registradas', `Del ${fd(d.desde)} al ${fd(d.hasta)}`),
            d.decisiones.length ? e('table', { class: 'contable' }, e('thead', {}, e('tr', {}, th('Fecha'), th('Tema'), th('Alternativa elegida'), th('Basada en'), th('Consenso recomendaba'), th('Registró'))),
              e('tbody', {}, ...d.decisiones.map((x) => e('tr', {}, e('td', {}, new Date(x.fecha).toLocaleDateString('es-MX')), e('td', {}, x.titulo), e('td', {}, x.alternativa), e('td', {}, BASES[x.base] || x.base), e('td', {}, x.consenso || '—'), e('td', {}, x.usuario || '—'))),
                e('tr', { class: 'total' }, e('td', {}, 'Suma'), e('td', {}, `${d.total} decisión(es)`), e('td', {}), e('td', {}), e('td', {}, `${d.siguieron_consenso} coinciden`), e('td', {}))))
              : e('p', { class: 'mu' }, 'No hay decisiones registradas en este periodo.')));
        } else if (tipo === 'estatus') {
          resultado.replaceChildren(e('div', { class: 'card tw' }, ...titulo('Pedidos por estatus', `Pedidos hechos del ${fd(d.desde)} al ${fd(d.hasta)}`),
            e('table', { class: 'contable' }, e('thead', {}, e('tr', {}, th('Estatus'), th('Pedidos', 1))), e('tbody', {}, ...d.estatus.map((x) => e('tr', {}, e('td', {}, x.estatus), e('td', { class: 'n' }, String(x.pedidos)))),
              e('tr', { class: 'total' }, e('td', {}, 'Suma'), e('td', { class: 'n' }, String(d.total)))))));
        } else {
          resultado.replaceChildren(e('div', { class: 'card tw' }, ...titulo('Existencias de inventario', `Al ${fd(hoy)} · valuadas al costo unitario vigente`),
            e('table', { class: 'contable' }, e('thead', {}, e('tr', {}, th('Insumo'), th('Unidad'), th('Existencia', 1), th('Mínimo', 1), th('Costo unitario', 1), th('Valor', 1), th('Estado'))),
              e('tbody', {}, ...d.insumos.map((x) => e('tr', {}, e('td', {}, x.nombre), e('td', {}, x.unidad), e('td', { class: 'n' }, H.num(x.stock)), e('td', { class: 'n' }, H.num(x.stock_minimo)), mon(e, x.costo_unitario), mon(e, x.valor), e('td', { class: x.estado === 'Reorden' ? 'bajo' : '' }, x.estado))),
                e('tr', { class: 'total' }, e('td', {}, 'Suma'), e('td', {}), e('td', {}), e('td', {}), e('td', {}), mon(e, d.totales.valor), e('td', {}, `${d.totales.en_reorden} en reorden`))))));
        }
      } catch (er) { resultado.replaceChildren(); err.replaceChildren(e('div', {}, er.message)); }
    }
    fDesde.hidden = false; fAgr.hidden = false; generar();
  });
})();

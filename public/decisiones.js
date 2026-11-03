// Toma de decisiones (DSS) del administrador: matriz de pagos, 6 criterios, consenso, exportación y registro de decisiones.
(() => {
  const nf = (x) => Number(x).toLocaleString('es-MX', { maximumFractionDigits: 2 });
  const fh = (f) => new Date(f).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
  const BASES = { consenso: 'Consenso de los criterios' };

  Personal.registrar('dec', 'Toma de decisiones', ['admin'], 5.5, async (cont, H) => {
    const { e, api, enviar, chipC } = H;
    const nav = e('div', { class: 'seg noprint' }), panel = e('div');
    const ir = (k) => { nav.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.s === k)); panel.replaceChildren(); (k === 'hist' ? historial : analizar)(); };
    [['analizar', 'Analizar una decisión'], ['hist', 'Decisiones registradas']].forEach(([k, n]) => nav.append(e('button', { type: 'button', 'data-s': k, onclick: () => ir(k) }, n)));
    cont.append(e('h2', {}, 'Toma de decisiones'), nav, panel);

    let info;
    try { info = await api('/decisiones/casos'); } catch (er) { panel.replaceChildren(e('p', { class: 'err' }, er.message)); return; }
    let casoId = info.casos[0].id;
    let M = null;          // matriz que se está editando
    let ultima = null;     // última evaluación recibida del servidor

    const desdeCaso = (c) => ({ alts: c.alternativas.map((a) => ({ nombre: a.nombre, detalle: a.detalle })), escs: [...c.escenarios],
      pagos: c.alternativas.map((a) => a.pagos.map(String)), prob: c.probabilidades.map(String), alfa: 0.6 });
    const cuerpo = () => ({ alternativas: M.alts.map((a) => a.nombre), escenarios: M.escs, pagos: M.pagos, probabilidades: M.prob, alfa: M.alfa });

    /* ===================== ANALIZAR ===================== */
    function analizar() {
      const caso = () => info.casos.find((c) => c.id === casoId);
      M = desdeCaso(caso());
      const err = e('div', { class: 'errbox', role: 'alert' }), aviso = e('div', { class: 'aviso', role: 'status', hidden: true });
      const zonaCasos = e('div', { class: 'seg noprint', role: 'tablist', 'aria-label': 'Tipo de decisión' });
      const intro = e('div', { class: 'card' }), matriz = e('div', { class: 'card tw' }), resultados = e('div', { class: 'card tw' }), consenso = e('div', { class: 'card' }), registro = e('div', { class: 'card' });
      let timer = null, seq = 0;

      const pintarCasos = () => { zonaCasos.replaceChildren(...info.casos.map((c) => e('button', { type: 'button', role: 'tab', class: c.id === casoId ? 'on' : '', 'aria-selected': String(c.id === casoId), 'data-caso': c.id,
        onclick: () => { casoId = c.id; M = desdeCaso(caso()); pintarCasos(); pintarIntro(); pintarMatriz(); calcular(); } }, c.titulo))); };
      const pintarIntro = () => {
        const c = caso();
        intro.replaceChildren(e('h3', {}, c.pregunta), e('p', {}, e('b', {}, '¿De dónde salen los pagos? '), c.origen),
          e('p', { class: 'mu' }, `Los pagos están en ${c.unidad}. Puedes cambiar cualquier número de la tabla: los resultados se recalculan solos.`));
      };
      const celdaNum = (valor, onin, etiqueta, paso = 'any') => e('input', { type: 'number', step: paso, value: valor, 'aria-label': etiqueta, oninput: (ev) => { onin(ev.target.value); programar(); } });
      const pintarMatriz = () => {
        const c = caso();
        const alfaTxt = e('b', {}, `α = ${M.alfa.toFixed(2)}`);
        const slider = e('input', { type: 'range', min: 0, max: 100, step: 1, value: Math.round(M.alfa * 100), 'aria-label': 'Coeficiente de optimismo de Hurwicz', oninput: (ev) => { M.alfa = Number(ev.target.value) / 100; alfaTxt.textContent = `α = ${M.alfa.toFixed(2)}`; programar(); } });
        matriz.replaceChildren(e('h3', {}, 'Matriz de pagos (editable)'),
          e('table', { class: 'dec-tabla' }, e('thead', {}, e('tr', {}, e('th', {}, 'Alternativa'), e('th', {}, c.columna_extra), ...M.escs.map((x) => e('th', {}, x[0].toUpperCase() + x.slice(1))))),
            e('tbody', {}, M.alts.map((a, i) => e('tr', {}, e('td', {}, e('b', {}, a.nombre)), e('td', { class: 'mu' }, a.detalle || ''),
              ...M.escs.map((x, j) => e('td', {}, celdaNum(M.pagos[i][j], (v) => { M.pagos[i][j] = v; }, `Pago de ${a.nombre} con ${x}`))))),
              e('tr', { class: 'fila-prob' }, e('td', { colspan: 2 }, e('b', {}, 'Probabilidad del escenario'), e('small', { class: 'mu' }, ' (solo la usa el VME; deben sumar 1)')),
                ...M.escs.map((x, j) => e('td', {}, celdaNum(M.prob[j], (v) => { M.prob[j] = v; }, `Probabilidad de ${x}`, '0.01')))))),
          e('div', { class: 'row filtros' }, e('label', { class: 'chk' }, 'Optimismo para Hurwicz:', slider), alfaTxt,
            e('button', { class: 'mini', type: 'button', onclick: () => { M = desdeCaso(caso()); pintarMatriz(); calcular(); } }, 'Restaurar caso'),
            e('button', { class: 'mini', type: 'button', 'data-acc': 'exportar', onclick: exportar }, 'Exportar a Power BI / Excel')));
      };
      const programar = () => { clearTimeout(timer); timer = setTimeout(calcular, 250); };

      async function calcular() {
        const mi = ++seq;
        try {
          const { evaluacion } = await api('/decisiones/evaluar', { method: 'POST', body: cuerpo() });
          if (mi !== seq) return;
          ultima = evaluacion; err.replaceChildren(); pintarResultados(); pintarConsenso(); pintarRegistro();
        } catch (er) { if (mi !== seq) return; ultima = null; err.replaceChildren(e('div', {}, er.message)); resultados.replaceChildren(); consenso.replaceChildren(); registro.replaceChildren(); }
      }
      function pintarResultados() {
        const ev = ultima, n = ev.alternativas.length;
        aviso.hidden = !ev.advertencia; aviso.replaceChildren(ev.advertencia ? '⚠ ' + ev.advertencia : '');
        resultados.replaceChildren(e('h3', {}, 'Resultados por criterio'),
          e('table', { class: 'dec-tabla', 'data-res': '1' }, e('thead', {}, e('tr', {}, e('th', {}, 'Criterio'), ...ev.alternativas.map((a) => e('th', {}, a)), e('th', {}, 'Recomienda'))),
            e('tbody', {}, ev.resultados.map((r) => e('tr', { 'data-criterio': r.clave },
              e('td', {}, e('b', {}, r.clave === 'hurwicz' ? `Hurwicz (α=${ev.alfa.toFixed(2)})` : r.criterio), e('br'), e('small', { class: 'mu' }, r.tipo)),
              ...(r.valores ? r.valores.map((x, i) => e('td', { class: 'n' + (i === r.ganador ? ' gana' : '') }, (i === r.ganador ? '★ ' : '') + nf(x)))
                : Array.from({ length: n }, () => e('td', { class: 'n mu' }, '—'))),
              e('td', {}, r.valores ? e('span', {}, e('b', {}, '► ' + ev.alternativas[r.ganador]), r.empates.length ? e('small', { class: 'mu' }, ' (empata con ' + r.empates.map((k) => ev.alternativas[k]).join(', ') + ')') : null) : e('small', { class: 'mu' }, r.motivo || 'Sin datos')))))),
          e('details', { class: 'detalle-arrep' }, e('summary', {}, 'Ver la matriz de arrepentimiento (la que usa Savage)'),
            e('p', { class: 'mu' }, 'Cada número es cuánto se deja de ganar, en ese escenario, por no haber elegido la mejor alternativa. Savage elige la alternativa cuyo mayor arrepentimiento sea el menor.'),
            e('table', { class: 'dec-tabla' }, e('thead', {}, e('tr', {}, e('th', {}, 'Alternativa'), ...ev.escenarios.map((x) => e('th', {}, x)))),
              e('tbody', {}, ev.alternativas.map((a, i) => e('tr', {}, e('td', {}, a), ...ev.arrepentimiento[i].map((x) => e('td', { class: 'n' }, nf(x)))))))),
          e('details', { class: 'detalle-ayuda' }, e('summary', {}, '¿Cómo se lee cada criterio?'),
            e('ul', {}, info.criterios.map((c) => e('li', {}, e('b', {}, c.nombre + ': '), c.idea)))));
      }
      function pintarConsenso() {
        const c = ultima.consenso, total = c.total || 1;
        consenso.replaceChildren(e('h3', {}, 'Consenso de los criterios'),
          ...Object.entries(c.votos).map(([a, v]) => e('div', { class: 'voto' }, e('span', {}, a), e('span', { class: 'barra', 'aria-hidden': 'true' }, e('i', { style: `width:${Math.round((v / total) * 100)}%` })), e('b', {}, `${v} de ${c.total}`))),
          e('p', { class: c.mayoria ? 'okmsg' : 'aviso', role: 'status' }, c.mensaje));
      }
      function pintarRegistro() {
        const ev = ultima, c = ev.consenso;
        const sel = e('select', { 'aria-label': 'Alternativa elegida' }, ev.alternativas.map((a) => e('option', { value: a }, a)));
        sel.value = c.ganadora || ev.alternativas[0];
        const base = e('select', { 'aria-label': 'En qué se basó la decisión' }, e('option', { value: 'consenso' }, BASES.consenso), ...info.criterios.map((k) => e('option', { value: k.clave }, k.nombre)));
        const notas = e('textarea', { rows: 2, maxlength: 500, placeholder: 'Por qué se tomó esta decisión (opcional)', 'aria-label': 'Notas de la decisión' });
        const caja = e('div', { class: 'errbox', role: 'alert' }), ok = e('p', { class: 'okmsg', role: 'status' });
        const b = e('button', { class: 'btn', type: 'button', 'data-acc': 'registrar', style: 'width:auto' }, 'Registrar decisión');
        b.onclick = enviar(b, caja, async () => {
          ok.textContent = '';
          const r = await api('/decisiones', { method: 'POST', body: { caso_id: casoId, alternativa: sel.value, base: base.value, notas: notas.value, matriz: cuerpo() } });
          ok.textContent = `Decisión registrada: ${r.decision.titulo} → ${r.decision.alternativa}. La encuentras en “Decisiones registradas”.`; notas.value = '';
        });
        registro.replaceChildren(e('h3', {}, 'Registrar la decisión'), e('p', { class: 'mu' }, 'El sistema recomienda con base en los criterios, pero la decisión final es de quien administra. Queda guardada con la matriz y los resultados de este momento.'),
          e('label', {}, 'Alternativa elegida', sel), e('label', {}, 'Decisión basada en', base), e('label', {}, 'Notas', notas), caja, ok, b);
      }
      async function exportar(ev) {
        const b = ev.currentTarget; b.disabled = true; err.replaceChildren();
        try {
          const r = await api('/decisiones/exportar', { method: 'POST', body: { ...cuerpo(), titulo: caso().titulo } });
          for (const f of r.archivos) {
            const url = URL.createObjectURL(new Blob(['﻿' + f.contenido], { type: 'text/csv;charset=utf-8' }));
            const a = e('a', { href: url, download: f.nombre }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          }
        } catch (er) { err.replaceChildren(e('div', {}, er.message)); }
        b.disabled = false;
      }

      panel.append(zonaCasos, intro, err, aviso, matriz, resultados, consenso, registro);
      pintarCasos(); pintarIntro(); pintarMatriz(); calcular();
    }

    /* ===================== DECISIONES REGISTRADAS ===================== */
    async function historial() {
      const lista = e('div'); panel.append(e('p', { class: 'mu' }, 'Las decisiones que registras quedan guardadas aquí, con lo que decía cada criterio en ese momento.'), lista);
      try {
        const { decisiones } = await api('/decisiones');
        lista.replaceChildren(...(decisiones.length ? decisiones.map((d) => e('div', { class: 'card', 'data-decision': d.id },
          e('div', { class: 'row', style: 'margin:0;justify-content:space-between;align-items:baseline' }, e('b', {}, `${d.titulo} → ${d.alternativa}`), e('small', {}, fh(d.creado_en))),
          e('p', { class: 'mu', style: 'margin:4px 0' }, `Basada en: ${BASES[d.base] || (info.criterios.find((k) => k.clave === d.base) || {}).nombre || d.base} · Registró: ${d.usuario || '—'}`),
          d.notas ? e('p', {}, 'Notas: ' + d.notas) : null,
          e('details', {}, e('summary', {}, 'Ver qué decía cada criterio'),
            e('ul', {}, d.resultados.criterios.map((r) => e('li', {}, e('b', {}, r.criterio + ': '), r.ganadora ? r.ganadora : 'sin resultado'))),
            e('p', { class: 'mu' }, d.resultados.consenso.mensaje)))) : [e('p', { class: 'mu' }, 'Aún no has registrado decisiones.')]));
      } catch (er) { lista.replaceChildren(e('p', { class: 'err' }, er.message)); }
    }

    ir('analizar');
  });
})();

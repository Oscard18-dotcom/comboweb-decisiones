(() => {
  let escuchando = false;
  function escuchar() {
    if (escuchando) return; escuchando = true;
    window.addEventListener('message', (ev) => {
      if (ev.origin !== window.location.origin) return;
      const d = ev.data || {}, marco = document.getElementById('marco-decisiones');
      if (d.tipo === 'altura-decisiones' && marco && ev.source === marco.contentWindow && Number.isFinite(d.px)) marco.style.height = Math.max(400, Math.min(20000, Math.ceil(d.px) + 8)) + 'px';
      if (d.tipo === 'abrir-pestana' && marco && ev.source === marco.contentWindow && /^[a-z]{2,5}$/.test(d.k || '')) { const b = document.querySelector(`#staff .seg button[data-k="${d.k}"]`); if (b) b.click(); }
      if (d.tipo === 'sesion-expirada') { try { sessionStorage.removeItem('t'); sessionStorage.removeItem('u'); } catch (e) {  } window.location.reload(); }
    });
  }
  Personal.registrar('dec', 'Toma de decisiones', ['admin'], 5.5, (cont, H) => {
    escuchar();
    cont.append(H.e('iframe', { id: 'marco-decisiones', src: '/decisiones-ng/', title: 'Toma de decisiones y data warehouse', style: 'width:100%;height:900px;border:0;display:block;background:transparent', loading: 'eager' }));
  });
})();

const $ = (s) => document.querySelector(s);
const id = new URLSearchParams(location.search).get('checkout');
let token = null;
try { token = sessionStorage.getItem('t'); } catch (e) { /* sin almacenamiento */ }
async function api(path, method = 'GET') {
  const r = await fetch('/api' + path, { method, headers: { Authorization: 'Bearer ' + token } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Ocurrió un error.');
  return j;
}
(async () => {
  if (!id || !token) { $('#err').textContent = 'Inicia sesión en el sitio y vuelve a intentar el pago.'; return; }
  try {
    const { checkout } = await api('/pedidos/checkout/' + encodeURIComponent(id));
    $('#total').textContent = 'Total a pagar: ' + Number(checkout.total).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
    $('#aprobar').disabled = $('#rechazar').disabled = checkout.estado !== 'creado';
    if (checkout.estado !== 'creado') $('#err').textContent = 'Este pago ya fue procesado.';
  } catch (e) { $('#err').textContent = e.message; return; }
  $('#aprobar').onclick = async () => { try { await api(`/pagos/simulado/${id}/aprobar`, 'POST'); location.assign('/?checkout=' + id); } catch (e) { $('#err').textContent = e.message; } };
  $('#rechazar').onclick = async () => { try { await api(`/pagos/simulado/${id}/rechazar`, 'POST'); location.assign('/?cancelado=' + id); } catch (e) { $('#err').textContent = e.message; } };
})();

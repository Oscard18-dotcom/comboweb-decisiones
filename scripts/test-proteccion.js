require('../src/config');
const fs = require('fs');
const path = require('path');
const app = require('../src/app');
const { disponible } = require('../src/middleware/minificar');

let ok = 0, mal = 0;
const t = (n, c, d = '') => { if (c) { ok++; console.log('PASS ' + n); } else { mal++; console.log('FAIL ' + n + (d ? ' → ' + d : '')); } };

(async () => {
  const srv = app.listen(0), B = 'http://localhost:' + srv.address().port;
  t('esbuild está disponible', disponible());
  const publico = path.join(__dirname, '..', 'public');
  const archivos = fs.readdirSync(publico).filter((f) => /\.(js|css)$/.test(f));
  for (const f of archivos) {
    const original = fs.readFileSync(path.join(publico, f), 'utf8');
    const r = await fetch(B + '/' + f), cuerpo = await r.text();
    t(`/${f} se entrega minificado (${original.length} → ${cuerpo.length} bytes)`, r.status === 200 && cuerpo.length < original.length * (f.endsWith('.css') ? 1 : 0.85) && cuerpo.split('\n').length <= 3);
    t(`/${f} no trae comentarios ni mapa de código`, !/\/\*|^\s*\/\/|sourceMappingURL/m.test(cuerpo));
    if (f.endsWith('.js')) { let valido = true; try { new Function(cuerpo); } catch (e) { valido = false; } t(`/${f} sigue siendo JavaScript válido`, valido); }
  }
  const a = await fetch(B + '/app.js'), etag = a.headers.get('etag');
  t('responde 304 si el archivo no cambió', !!etag && (await fetch(B + '/app.js', { headers: { 'If-None-Match': etag } })).status === 304);
  t('el mapa de código no existe', (await fetch(B + '/app.js.map')).status === 404);
  t('la página principal sigue sirviéndose', (await fetch(B + '/')).status === 200);
  srv.close();
  console.log(`\n${ok} correctas, ${mal} fallidas`);
  process.exit(mal ? 1 : 0);
})();

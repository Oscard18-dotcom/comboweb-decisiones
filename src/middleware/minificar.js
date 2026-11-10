const fs = require('fs');
const path = require('path');

let esbuild = null;
try { esbuild = require('esbuild'); } catch (e) { esbuild = null; }

const TIPOS = { '.js': ['js', 'application/javascript; charset=utf-8'], '.css': ['css', 'text/css; charset=utf-8'] };

function minificar(carpeta) {
  const cache = new Map();
  return (req, res, next) => {
    if (!esbuild || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
    const tipo = TIPOS[path.extname(req.path).toLowerCase()];
    if (!tipo || req.path.includes('..') || req.path.split('/').filter(Boolean).length !== 1) return next();
    const archivo = path.join(carpeta, path.basename(req.path));
    let stat;
    try { stat = fs.statSync(archivo); } catch (e) { return next(); }
    if (!stat.isFile()) return next();
    const marca = `${stat.mtimeMs}:${stat.size}`;
    let hit = cache.get(archivo);
    if (!hit || hit.marca !== marca) {
      try {
        const codigo = esbuild.transformSync(fs.readFileSync(archivo, 'utf8'), { loader: tipo[0], minify: true, legalComments: 'none', charset: 'utf8', target: 'es2019' }).code;
        hit = { marca, codigo, etag: 'W/"' + require('crypto').createHash('sha1').update(codigo).digest('hex').slice(0, 20) + '"' };
        cache.set(archivo, hit);
      } catch (e) { return next(); }
    }
    res.set({ 'Content-Type': tipo[1], ETag: hit.etag, 'Cache-Control': 'no-cache' });
    if (req.headers['if-none-match'] === hit.etag) return res.status(304).end();
    res.send(hit.codigo);
  };
}

module.exports = { minificar, disponible: () => !!esbuild };

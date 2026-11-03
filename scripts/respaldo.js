// Copia de seguridad de la base de datos en un archivo (carpeta "respaldos"). Se conservan las últimas 14.
//   node scripts/respaldo.js            (manual)        node scripts/respaldo.js --silencioso   (lo usa iniciar.bat)
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const RAIZ = path.join(__dirname, '..');
// Lee el archivo .env sin depender de ningún paquete
try { for (const l of fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim(); } } catch (e) { /* sin .env */ }
const silencioso = process.argv.includes('--silencioso');
const avisar = (t) => { console.log((silencioso ? '  ' : '') + t); };
const fallar = (t) => { avisar('AVISO - No se pudo guardar la copia de seguridad: ' + t); process.exit(silencioso ? 0 : 1); };

if (!process.env.DATABASE_URL) fallar('el sistema no está instalado todavía.');
let u; try { u = new URL(process.env.DATABASE_URL); } catch (e) { fallar('la configuración está dañada.'); }

function buscarPgDump() {
  const cand = [process.env.PG_DUMP, 'pg_dump'].filter(Boolean);
  for (const base of ['C:\\Program Files\\PostgreSQL', '/usr/lib/postgresql', '/opt/homebrew/opt', '/Applications/Postgres.app/Contents/Versions']) {
    try { for (const d of fs.readdirSync(base).sort().reverse()) cand.push(path.join(base, d, 'bin', process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump')); } catch (e) { /* no existe */ }
  }
  return cand.find((x) => spawnSync(x, ['--version']).status === 0);
}
const pgDump = buscarPgDump();
if (!pgDump) fallar('no encuentro el programa de copias de PostgreSQL (pg_dump).');

const dir = path.join(RAIZ, 'respaldos'); fs.mkdirSync(dir, { recursive: true });
const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
const archivo = path.join(dir, `respaldo-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.sql`);
const r = spawnSync(pgDump, ['--no-owner', '--no-privileges', '-h', u.hostname, '-p', u.port || '5432', '-U', decodeURIComponent(u.username), '-d', u.pathname.slice(1), '-f', archivo],
  { env: { ...process.env, PGPASSWORD: decodeURIComponent(u.password) }, encoding: 'utf8' });
if (r.status !== 0 || !fs.existsSync(archivo) || fs.statSync(archivo).size < 500) { try { fs.unlinkSync(archivo); } catch (e) { /* nada */ } fallar((r.stderr || 'el archivo salió vacío').trim().split('\n')[0]); }
const viejos = fs.readdirSync(dir).filter((f) => /^respaldo-.*\.sql$/.test(f)).sort();
for (const f of viejos.slice(0, Math.max(0, viejos.length - 14))) fs.unlinkSync(path.join(dir, f));
avisar(`OK - Copia de seguridad guardada: respaldos${path.sep}${path.basename(archivo)}`);

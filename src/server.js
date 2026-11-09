const app = require('./app');
const db = require('./db');
const notif = require('./services/notificaciones');

const port = process.env.PORT || 3000;
const servidor = app.listen(port, () => console.log(`ComboWeb Decisiones escuchando en http://localhost:${port}`));
servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\nPROBLEMA - El puerto ${port} ya está en uso. Probablemente ComboWeb Decisiones ya está encendida en otra ventana negra: ciérrela, o reinicie la computadora, e intente de nuevo.\n`);
  else console.error('\nPROBLEMA - El sistema no pudo encenderse:', e.message, '\n');
  process.exit(1);
});
const trabajo = notif.iniciarTrabajo();

function cerrar(senal) {
  console.log(`${senal} recibido: cerrando…`);
  clearInterval(trabajo);
  servidor.close(async () => { await db.pool.end().catch(() => {}); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => cerrar('SIGTERM'));
process.on('SIGINT', () => cerrar('SIGINT'));

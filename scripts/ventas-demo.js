require('../src/config');
const { pool } = require('../src/db');
const demo = require('../src/services/ventas-demo');
const wh = require('../src/services/warehouse');

(async () => {
  if (process.argv.includes('--quitar')) {
    const n = await wh.quitarDemo();
    console.log(`Se quitaron ${n} ventas de demostración.`);
  } else {
    const r = await wh.cargar({ demo: true });
    console.log(r.demo ? `Se registraron ${r.demo} ventas de demostración.` : 'Las ventas de demostración ya estaban registradas.', `Pedidos en el almacén de datos: ${r.pedidos}.`);
  }
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

// Correo SIMULADO: solo imprime en la consola. Solo para desarrollo (el servidor no arranca en producción con este modo).
module.exports = { nombre: 'consola', async enviar({ a, asunto }) { console.log(`[CORREO simulado] a=${a} asunto="${asunto}"`); } };

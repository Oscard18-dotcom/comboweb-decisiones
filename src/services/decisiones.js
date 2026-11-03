// Toma de decisiones (DSS) del administrador de EN COMBO.
// Matriz de pagos: pagos[i][j] = utilidad de la alternativa i si ocurre el escenario j (filas = alternativas, columnas = escenarios).
// Seis criterios: cuatro de incertidumbre (maximin, maximax, Laplace, Hurwicz), uno de arrepentimiento (Savage) y uno de riesgo (VME).
// La alternativa ganadora es la de mayor valor, salvo en Savage, donde gana el MENOR arrepentimiento máximo.
const CASOS = require('../data/casos-decision.json').casos;

const CRITERIOS = [
  { clave: 'maximin', nombre: 'Maximin (Wald)', tipo: 'Incertidumbre', menorEsMejor: false,
    idea: 'Pesimista: mira el peor resultado de cada alternativa y elige la que tiene el mejor “peor caso”.' },
  { clave: 'maximax', nombre: 'Maximax', tipo: 'Incertidumbre', menorEsMejor: false,
    idea: 'Optimista: mira el mejor resultado de cada alternativa y elige la que tiene el mejor “mejor caso”.' },
  { clave: 'laplace', nombre: 'Laplace', tipo: 'Incertidumbre', menorEsMejor: false,
    idea: 'Razón insuficiente: como no sabemos qué escenario ocurrirá, los trata como igual de probables y elige el mejor promedio.' },
  { clave: 'hurwicz', nombre: 'Hurwicz', tipo: 'Incertidumbre', menorEsMejor: false,
    idea: 'Realista: mezcla el mejor y el peor caso según un coeficiente de optimismo α (0 = pesimista, 1 = optimista).' },
  { clave: 'savage', nombre: 'Savage (arrepentimiento)', tipo: 'Incertidumbre', menorEsMejor: true,
    idea: 'Minimiza el arrepentimiento: mide cuánto se pierde por no haber elegido la mejor alternativa en cada escenario y elige la que tiene el menor arrepentimiento máximo.' },
  { clave: 'vme', nombre: 'VME (valor monetario esperado)', tipo: 'Riesgo', menorEsMejor: false,
    idea: 'Con probabilidades conocidas: promedia los pagos ponderados por la probabilidad de cada escenario y elige el mayor.' },
];

/* ---------- Criterios (cada uno regresa un valor por alternativa) ---------- */
const minimo = (f) => Math.min(...f), maximo = (f) => Math.max(...f);
const maximin = (p) => p.map(minimo);
const maximax = (p) => p.map(maximo);
const laplace = (p) => p.map((f) => f.reduce((a, x) => a + x, 0) / f.length);
const hurwicz = (p, alfa) => p.map((f) => alfa * maximo(f) + (1 - alfa) * minimo(f));
const arrepentimiento = (p) => {
  const mejorCol = p[0].map((_, j) => Math.max(...p.map((f) => f[j])));
  return p.map((f) => f.map((x, j) => mejorCol[j] - x));
};
const savage = (p) => arrepentimiento(p).map(maximo);
const vme = (p, prob) => p.map((f) => f.reduce((a, x, j) => a + prob[j] * x, 0));

const mejorIndice = (v, menorEsMejor) => { let m = 0; for (let i = 1; i < v.length; i++) if (menorEsMejor ? v[i] < v[m] : v[i] > v[m]) m = i; return m; };
const iguales = (v, i) => v.map((x, k) => k).filter((k) => Math.abs(v[k] - v[i]) < 1e-9);

/* ---------- Validación de la matriz que llega del navegador ---------- */
function validar(b) {
  const err = (m) => ({ error: m });
  if (!b || typeof b !== 'object') return err('Envía la matriz de decisión.');
  const { alternativas, escenarios, pagos, probabilidades } = b;
  const alfa = b.alfa === undefined ? 0.6 : Number(b.alfa);
  if (!Array.isArray(alternativas) || alternativas.length < 2 || alternativas.length > 10) return err('Se necesitan entre 2 y 10 alternativas.');
  if (!Array.isArray(escenarios) || escenarios.length < 2 || escenarios.length > 6) return err('Se necesitan entre 2 y 6 escenarios.');
  const txt = (x) => (typeof x === 'string' ? x.replace(/[\u0000-\u001F\u007F]/g, ' ').trim() : '');
  const alts = alternativas.map(txt), escs = escenarios.map(txt);
  if (alts.some((a) => !a || a.length > 80) || escs.some((a) => !a || a.length > 80)) return err('Cada alternativa y cada escenario necesita un nombre (máximo 80 caracteres).');
  if (new Set(alts.map((a) => a.toLowerCase())).size !== alts.length) return err('Los nombres de las alternativas no pueden repetirse.');
  if (!Array.isArray(pagos) || pagos.length !== alts.length || pagos.some((f) => !Array.isArray(f) || f.length !== escs.length)) return err('La matriz de pagos debe tener una fila por alternativa y una columna por escenario.');
  const P = pagos.map((f) => f.map((x) => (typeof x === 'number' || (typeof x === 'string' && x.trim() !== '') ? Number(x) : NaN)));
  if (P.some((f) => f.some((x) => !Number.isFinite(x) || Math.abs(x) > 1e9))) return err('Todos los pagos deben ser números (máximo 1 000 000 000 en valor absoluto).');
  if (!Number.isFinite(alfa) || alfa < 0 || alfa > 1) return err('El coeficiente de optimismo α debe estar entre 0 y 1.');
  let prob = null, advertencia = null;
  if (probabilidades !== undefined && probabilidades !== null) {
    if (!Array.isArray(probabilidades) || probabilidades.length !== escs.length) return err('Debe haber una probabilidad por escenario.');
    prob = probabilidades.map((x) => (typeof x === 'number' || (typeof x === 'string' && x.trim() !== '') ? Number(x) : NaN));
    if (prob.some((x) => !Number.isFinite(x) || x < 0 || x > 1)) return err('Cada probabilidad debe ser un número entre 0 y 1.');
    const s = prob.reduce((a, x) => a + x, 0);
    if (Math.abs(s - 1) > 1e-6) { advertencia = `Las probabilidades suman ${Math.round(s * 1e6) / 1e6}; deben sumar 1 para calcular el VME.`; }
  } else advertencia = 'Sin probabilidades no se puede calcular el VME.';
  return { alts, escs, P, prob, alfa, advertencia };
}

/* ---------- Evaluación completa: los 6 criterios, el arrepentimiento y el consenso ---------- */
function evaluar(entrada) {
  const v = validar(entrada);
  if (v.error) return v;
  const { alts, escs, P, prob, alfa, advertencia } = v;
  const puedeVME = prob && !advertencia;
  const resultados = CRITERIOS.map((c) => {
    const base = { clave: c.clave, criterio: c.nombre, tipo: c.tipo, idea: c.idea, menorEsMejor: c.menorEsMejor };
    if (c.clave === 'vme' && !puedeVME) return { ...base, valores: null, ganador: null, empates: [], motivo: advertencia };
    const valores = c.clave === 'maximin' ? maximin(P) : c.clave === 'maximax' ? maximax(P) : c.clave === 'laplace' ? laplace(P)
      : c.clave === 'hurwicz' ? hurwicz(P, alfa) : c.clave === 'savage' ? savage(P) : vme(P, prob);
    const g = mejorIndice(valores, c.menorEsMejor);
    return { ...base, ...(c.clave === 'hurwicz' ? { alfa } : {}), valores, ganador: g, empates: iguales(valores, g).filter((k) => k !== g) };
  });
  const votos = Object.fromEntries(alts.map((a) => [a, 0]));
  for (const r of resultados) if (r.ganador !== null) votos[alts[r.ganador]]++;
  const total = Object.values(votos).reduce((a, x) => a + x, 0), max = Math.max(...Object.values(votos));
  const lideres = alts.filter((a) => votos[a] === max);
  const mayoria = max * 2 > total;
  const consenso = { votos, total, ganadora: lideres.length === 1 ? lideres[0] : null, empate: lideres.length > 1 ? lideres : [], mayoria,
    mensaje: mayoria ? `Hay una mayoría clara: ${lideres[0]} gana en ${max} de ${total} criterios.`
      : lideres.length > 1 ? `Los criterios no coinciden (empatan ${lideres.join(' y ')}): la decisión necesita que el equipo la discuta.`
      : `Los criterios no coinciden: ${lideres[0]} lidera con ${max} de ${total}, pero sin mayoría. Conviene discutirlo en equipo.` };
  return { alternativas: alts, escenarios: escs, probabilidades: prob, alfa, advertencia, resultados, arrepentimiento: arrepentimiento(P), consenso };
}

/* ---------- Exportación a Power BI / Excel (dos archivos, como en el sistema de referencia) ---------- */
const celda = (x) => { const s = String(x ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
// Texto que empieza con = + - @ lo tomaría Excel como fórmula: se le antepone un apóstrofo.
const txtSeguro = (x) => { const s = String(x ?? ''); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; };
const linea = (...c) => c.map(celda).join(',');
function exportar(entrada, titulo = 'decision') {
  const v = validar(entrada), ev = evaluar(entrada);
  if (ev.error) return ev;
  const matriz = ['alternativa,escenario,probabilidad,pago'], res = ['criterio,tipo,alternativa,valor,elegida,alfa'];
  ev.alternativas.forEach((a, i) => ev.escenarios.forEach((e, j) => matriz.push(linea(txtSeguro(a), txtSeguro(e), ev.probabilidades ? ev.probabilidades[j] : '', v.P[i][j]))));
  for (const r of ev.resultados) if (r.valores) r.valores.forEach((x, i) => res.push(linea(r.criterio, r.tipo, txtSeguro(ev.alternativas[i]), Math.round(x * 1e6) / 1e6, i === r.ganador ? 1 : 0, r.alfa ?? '')));
  const slug = String(titulo).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'decision';
  return { archivos: [{ nombre: `comboweb_${slug}_matriz.csv`, contenido: matriz.join('\n') + '\n' }, { nombre: `comboweb_${slug}_resultados.csv`, contenido: res.join('\n') + '\n' }] };
}

const casoPublico = (c) => ({ id: c.id, titulo: c.titulo, pregunta: c.pregunta, unidad: c.unidad, origen: c.origen, columna_extra: c.columna_extra,
  escenarios: c.escenarios, probabilidades: c.probabilidades, alternativas: c.alternativas.map((a) => ({ nombre: a.nombre, detalle: a.detalle, pagos: a.pagos })) });

module.exports = { CRITERIOS, CASOS, casos: () => CASOS.map(casoPublico), caso: (id) => { const c = CASOS.find((x) => x.id === id); return c ? casoPublico(c) : null; },
  evaluar, exportar, validar, maximin, maximax, laplace, hurwicz, arrepentimiento, savage, vme, mejorIndice };

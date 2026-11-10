export interface Alternativa { nombre: string; detalle?: string; pagos: number[]; }
export interface Caso {
  id: string; titulo: string; pregunta: string; unidad: string; origen: string; columna_extra: string;
  escenarios: string[]; probabilidades: number[]; alfa: number; guardado: boolean; actualizado_en?: string;
  alternativas: Alternativa[];
}
export interface Criterio { clave: string; nombre: string; tipo: string; idea: string; }
export interface Resultado {
  clave: string; criterio: string; tipo: string; idea: string; valores: number[] | null;
  ganador: number | null; empates: number[]; alfa?: number; motivo?: string;
}
export interface Consenso { votos: Record<string, number>; total: number; ganadora: string | null; empate: string[]; mayoria: boolean; mensaje: string; }
export interface Evaluacion {
  alternativas: string[]; escenarios: string[]; probabilidades: number[] | null; alfa: number; advertencia?: string | null;
  resultados: Resultado[]; arrepentimiento: number[][]; consenso: Consenso;
}
export interface Matriz { alternativas: string[]; escenarios: string[]; pagos: (number | string)[][]; probabilidades: (number | string)[]; alfa: number; }
export interface DecisionRegistrada {
  id: number; caso_id: string; titulo: string; alternativa: string; base: string; notas: string | null; creado_en: string; usuario: string | null;
  resultados: { criterios: { clave: string; criterio: string; ganadora: string | null }[]; consenso: Consenso };
}
export interface Archivo { nombre: string; contenido: string; }

export interface ResumenWarehouse {
  filas: { pedidos: number }; ultima_carga: { creado_en: string; tipo: string; filas: number; detalle: string } | null;
  conciliacion: { sistema: { pedidos: number; ventas: number }; almacen: { pedidos: number; ventas: number }; coincide: boolean };
  kpis: { ingreso: number; utilidad: number; margen: number; piezas: number; pedidos: number };
  meses: { etiqueta: string; ingreso: number; utilidad: number; piezas: number }[];
  combos: { nombre: string; productos: string; pedidos: number; piezas: number; ingreso: number; utilidad: number }[];
  dias: { dia: string; ingreso: number; piezas: number }[];
  temporadas: { temporada: string; ingreso: number; piezas: number; dias: number; ingreso_por_dia: number }[];
}

export interface DashboardSistema {
  hoy: string; ventas_hoy: number; pedidos_hoy: number; insumos_en_reorden: number; entregas_pendientes_hoy: number;
  decisiones: { total: number; ultima: { id: number; titulo: string; alternativa: string; creado_en: string } | null };
}
export interface VentasSistema {
  desde: string; hasta: string;
  totales: { pedidos: number; ventas: number; costo: number; utilidad: number; margen_pct: number };
  top_productos: { nombre: string; piezas: number; ventas: number }[];
}

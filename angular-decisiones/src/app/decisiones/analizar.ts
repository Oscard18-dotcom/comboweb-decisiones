import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Api, descargar, fechaHora } from '../core/api';
import { Caso, Criterio, Evaluacion, Matriz } from '../core/modelos';

@Component({
  selector: 'app-analizar',
  imports: [DecimalPipe],
  templateUrl: './analizar.html',
})
export class Analizar implements OnInit {
  private api = inject(Api);
  readonly fh = fechaHora;

  casos = signal<Caso[]>([]);
  criterios = signal<Criterio[]>([]);
  casoId = signal('');
  caso = computed(() => this.casos().find((c) => c.id === this.casoId()) ?? null);
  pagos = signal<string[][]>([]);
  prob = signal<string[]>([]);
  alfa = signal(0.6);
  ev = signal<Evaluacion | null>(null);
  error = signal('');
  exito = signal('');
  ocupado = signal(false);
  cargando = signal(true);

  elegida = signal('');
  base = signal('consenso');
  notas = signal('');
  errorRegistro = signal('');
  registrada = signal('');
  private tocada = false;

  private temporizador: ReturnType<typeof setTimeout> | undefined;
  private secuencia = 0;

  async ngOnInit() {
    try {
      const r = await this.api.casos();
      this.casos.set(r.casos); this.criterios.set(r.criterios);
      this.abrir(r.casos[0].id);
    } catch (e) { this.error.set((e as Error).message); }
    this.cargando.set(false);
  }

  abrir(id: string) {
    this.casoId.set(id); this.exito.set(''); this.registrada.set(''); this.tocada = false; this.error.set('');
    this.restablecer();
  }
  restablecer() {
    const c = this.caso(); if (!c) return;
    this.pagos.set(c.alternativas.map((a) => a.pagos.map(String)));
    this.prob.set(c.probabilidades.map(String));
    this.alfa.set(c.alfa ?? 0.6);
    this.calcular();
  }

  setPago(i: number, j: number, v: string) { this.pagos.update((p) => p.map((f, a) => (a === i ? f.map((x, b) => (b === j ? v : x)) : f))); this.programar(); }
  setProb(j: number, v: string) { this.prob.update((p) => p.map((x, b) => (b === j ? v : x))); this.programar(); }
  setAlfa(v: string) { this.alfa.set(Number(v) / 100); this.programar(); }
  private programar() { clearTimeout(this.temporizador); this.temporizador = setTimeout(() => this.calcular(), 250); }

  matriz(): Matriz {
    const c = this.caso()!;
    return { alternativas: c.alternativas.map((a) => a.nombre), escenarios: c.escenarios, pagos: this.pagos(), probabilidades: this.prob(), alfa: this.alfa() };
  }

  async calcular() {
    const c = this.caso(); if (!c) return;
    const mi = ++this.secuencia;
    try {
      const { evaluacion } = await this.api.evaluar(this.matriz());
      if (mi !== this.secuencia) return;
      this.ev.set(evaluacion); this.error.set('');
      if (!this.tocada || !evaluacion.alternativas.includes(this.elegida())) this.elegida.set(evaluacion.consenso.ganadora ?? evaluacion.alternativas[0]);
    } catch (e) { if (mi !== this.secuencia) return; this.ev.set(null); this.error.set((e as Error).message); }
  }

  async guardar() { await this.accion(async () => { await this.api.guardarDatos(this.casoId(), this.matriz()); await this.recargar('Datos guardados. Así aparecerán cada vez que abras este tipo de decisión.'); }); }
  async ejemplo() { await this.accion(async () => { await this.api.restaurarDatos(this.casoId()); await this.recargar('Se restauraron los datos de ejemplo.'); }); }
  private async recargar(mensaje: string) {
    const r = await this.api.casos(); this.casos.set(r.casos); this.restablecer(); this.exito.set(mensaje);
  }
  async exportar() {
    await this.accion(async () => { const r = await this.api.exportar(this.matriz(), this.caso()!.titulo); descargar(r.archivos); });
  }
  private async accion(fn: () => Promise<void>) {
    this.ocupado.set(true); this.error.set(''); this.exito.set('');
    try { await fn(); } catch (e) { this.error.set((e as Error).message); }
    this.ocupado.set(false);
  }

  async registrar() {
    this.ocupado.set(true); this.errorRegistro.set(''); this.registrada.set('');
    try {
      const r = await this.api.registrar({ caso_id: this.casoId(), alternativa: this.elegida(), base: this.base(), notas: this.notas(), matriz: this.matriz() });
      this.registrada.set(`Decisión registrada: ${r.decision.titulo} → ${r.decision.alternativa}. La encuentras en “Decisiones registradas”, en el Dashboard y en Reportes.`);
      this.notas.set('');
    } catch (e) { this.errorRegistro.set((e as Error).message); }
    this.ocupado.set(false);
  }

  elegir(v: string) { this.tocada = true; this.elegida.set(v); }
  marcas(total: number) { return Array.from({ length: total }); }
  votos(e: Evaluacion) { return Object.entries(e.consenso.votos); }
  ganaAlgo(i: number, g: number | null) { return g === i; }
  txtEmpate(e: Evaluacion, r: { empates: number[] }) { return r.empates.map((k) => e.alternativas[k]).join(', '); }
}

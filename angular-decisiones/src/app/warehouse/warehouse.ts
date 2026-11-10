import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe, PercentPipe } from '@angular/common';
import { Api, descargar, fechaHora, irA } from '../core/api';
import { ResumenWarehouse } from '../core/modelos';
import { Barras } from '../compartido/barras';

@Component({
  selector: 'app-warehouse',
  imports: [DecimalPipe, PercentPipe, Barras],
  templateUrl: './warehouse.html',
})
export class Warehouse implements OnInit {
  private api = inject(Api);
  readonly fh = fechaHora;
  readonly ir = irA;
  r = signal<ResumenWarehouse | null>(null);
  error = signal('');
  exito = signal('');
  ocupado = signal(false);
  cargando = signal(true);
  vacio = computed(() => { const x = this.r(); return !x || x.filas.pedidos === 0; });

  meses = computed(() => (this.r()?.meses ?? []).map((m) => ({ etiqueta: m.etiqueta.replace(/^(\w{3})\w*/, (_, a) => a[0].toUpperCase() + a.slice(1)).replace(' 20', " '"), valor: m.ingreso })));
  dias = computed(() => (this.r()?.dias ?? []).map((d) => ({ etiqueta: d.dia.slice(0, 3), valor: d.ingreso })));
  temporadas = computed(() => (this.r()?.temporadas ?? []).map((t) => ({ etiqueta: t.temporada, valor: Math.round(t.ingreso_por_dia) })).sort((a, b) => b.valor - a.valor));
  combos = computed(() => (this.r()?.combos ?? []).map((c) => ({ etiqueta: c.nombre, valor: c.ingreso })));

  async ngOnInit() { await this.cargar(); if (!this.error() && this.r() && this.r()!.filas.pedidos === 0) await this.preparar(); }

  private async preparar() {
    try { await this.api.cargarWarehouse(true); await this.cargar(); } catch (e) { this.error.set((e as Error).message); }
  }

  async cargar() {
    this.cargando.set(true);
    try { this.r.set(await this.api.resumen()); this.error.set(''); } catch (e) { this.error.set((e as Error).message); }
    this.cargando.set(false);
  }

  private async accion(fn: () => Promise<string>) {
    this.ocupado.set(true); this.error.set(''); this.exito.set('');
    try { const msg = await fn(); await this.cargar(); this.exito.set(msg); } catch (e) { this.error.set((e as Error).message); }
    this.ocupado.set(false);
  }
  exportar() { return this.accion(async () => { const x = await this.api.exportarWarehouse(); descargar(x.archivos); return `Se descargaron ${x.archivos.length} archivos CSV (3 dimensiones y la tabla de hechos) para Power BI o Excel.`; }); }
}

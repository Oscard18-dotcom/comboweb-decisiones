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
  origen = signal<'todos' | 'pedido' | 'demo'>('todos');
  r = signal<ResumenWarehouse | null>(null);
  error = signal('');
  exito = signal('');
  ocupado = signal(false);
  cargando = signal(true);
  vacio = computed(() => { const x = this.r(); return !x || x.filas.pedido + x.filas.demo === 0; });

  meses = computed(() => (this.r()?.meses ?? []).map((m) => ({ etiqueta: m.etiqueta.replace(/^(\w{3})\w*/, (_, a) => a[0].toUpperCase() + a.slice(1)).replace(' 20', " '"), valor: m.ingreso })));
  dias = computed(() => (this.r()?.dias ?? []).map((d) => ({ etiqueta: d.dia.slice(0, 3), valor: d.ingreso })));
  temporadas = computed(() => (this.r()?.temporadas ?? []).map((t) => ({ etiqueta: t.temporada, valor: Math.round(t.ingreso_por_dia) })).sort((a, b) => b.valor - a.valor));
  productos = computed(() => (this.r()?.productos ?? []).map((p) => ({ etiqueta: p.nombre, valor: p.ingreso })));
  zonas = computed(() => (this.r()?.zonas ?? []).map((z) => ({ etiqueta: z.municipio, valor: z.ingreso })));

  ngOnInit() { this.cargar(); }

  async cargar() {
    this.cargando.set(true);
    try { this.r.set(await this.api.resumen(this.origen())); this.error.set(''); } catch (e) { this.error.set((e as Error).message); }
    this.cargando.set(false);
  }
  async filtrar(o: string) { this.origen.set(o as 'todos' | 'pedido' | 'demo'); await this.cargar(); }

  private async accion(fn: () => Promise<string>) {
    this.ocupado.set(true); this.error.set(''); this.exito.set('');
    try { const msg = await fn(); await this.cargar(); this.exito.set(msg); } catch (e) { this.error.set((e as Error).message); }
    this.ocupado.set(false);
  }
  etl(demo: boolean) {
    return this.accion(async () => {
      const x = await this.api.cargarWarehouse(demo);
      return demo ? `Carga terminada: ${x.pedidos} ventas de pedidos reales y ${x.demo} ventas de demostración (12 meses).` : `Carga terminada: ${x.pedidos} ventas de pedidos reales copiadas al warehouse.`;
    });
  }
  quitarDemo() { return this.accion(async () => `Se quitaron ${(await this.api.quitarDemo()).borradas} ventas de demostración.`); }
  exportar() { return this.accion(async () => { const x = await this.api.exportarWarehouse(); descargar(x.archivos); return `Se descargaron ${x.archivos.length} archivos CSV (4 dimensiones y la tabla de hechos) para Power BI o Excel.`; }); }
}

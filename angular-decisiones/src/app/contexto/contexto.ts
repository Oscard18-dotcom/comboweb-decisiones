import { Component, OnInit, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Api, irA } from '../core/api';
import { DashboardSistema, VentasSistema } from '../core/modelos';

@Component({
  selector: 'app-contexto',
  imports: [DecimalPipe],
  template: `
    <section class="contexto" aria-label="Datos actuales del sistema">
      <div class="contexto-cab">
        <h2 class="rotulo">Situación actual del negocio</h2>
        <p class="atajos">
          <button type="button" class="vinculo" data-ir="dash" (click)="ir('dash')">Abrir Dashboard</button>
          <button type="button" class="vinculo" data-ir="rep" (click)="ir('rep')">Abrir Reportes</button>
        </p>
      </div>
      @if (d(); as x) {
        <dl class="cifras" data-contexto="1">
          <div><dt>Ventas de hoy</dt><dd>\${{ x.ventas_hoy | number:'1.0-0' }}</dd></div>
          @if (v(); as y) {
            <div><dt>Ventas, últimos 30 días</dt><dd>\${{ y.totales.ventas | number:'1.0-0' }}</dd></div>
            <div><dt>Margen bruto, 30 días</dt><dd>{{ y.totales.margen_pct }} %</dd></div>
          }
          <div><dt>Insumos en reorden</dt><dd>{{ x.insumos_en_reorden }}</dd></div>
          <div><dt>Decisiones registradas</dt><dd>{{ x.decisiones.total }}</dd></div>
        </dl>
        @if (v(); as y) {
          @if (y.top_productos.length) { <p class="pie">Producto más vendido del periodo: {{ y.top_productos[0].nombre }} ({{ y.top_productos[0].piezas }} piezas). Cifras del Dashboard y de Reportes al día de hoy.</p> }
        }
      } @else if (falla()) {
        <p class="mu">No se pudieron leer los datos del Dashboard en este momento.</p>
      } @else {
        <p class="mu" role="status">Leyendo datos del sistema…</p>
      }
    </section>
  `,
})
export class Contexto implements OnInit {
  private api = inject(Api);
  readonly ir = irA;
  d = signal<DashboardSistema | null>(null);
  v = signal<VentasSistema | null>(null);
  falla = signal(false);

  async ngOnInit() {
    const [a, b] = await Promise.allSettled([this.api.dashboard(), this.api.ventasRecientes()]);
    if (a.status === 'fulfilled') this.d.set(a.value); else this.falla.set(true);
    if (b.status === 'fulfilled') this.v.set(b.value);
  }
}

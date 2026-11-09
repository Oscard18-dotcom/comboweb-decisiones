import { Component, computed, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';

export interface Dato { etiqueta: string; valor: number; }

@Component({
  selector: 'app-barras',
  imports: [DecimalPipe],
  template: `
    @if (datos().length === 0) { <p class="mu">Sin datos para mostrar.</p> }
    @else if (columnas()) {
      <div class="cols" role="img" [attr.aria-label]="titulo()">
        @for (d of filas(); track d.etiqueta) {
          <div class="col" [title]="d.etiqueta + ': ' + prefijo() + (d.valor | number:'1.0-0')">
            <span class="col-v">{{ abreviar(d.valor) }}</span>
            <i [style.height.%]="d.pct"></i>
            <span class="col-e">{{ d.etiqueta }}</span>
          </div>
        }
      </div>
    } @else {
      <ul class="hbar" [attr.aria-label]="titulo()">
        @for (d of filas(); track d.etiqueta) {
          <li>
            <span class="hb-e">{{ d.etiqueta }}</span>
            <span class="hb-b" aria-hidden="true"><i [style.width.%]="d.pct"></i></span>
            <b class="hb-v">{{ prefijo() }}{{ d.valor | number:'1.0-0' }}{{ sufijo() }}</b>
          </li>
        }
      </ul>
    }
  `,
})
export class Barras {
  datos = input.required<Dato[]>();
  titulo = input('Gráfica');
  columnas = input(false);
  prefijo = input('');
  sufijo = input('');
  filas = computed(() => { const max = Math.max(1, ...this.datos().map((d) => d.valor)); return this.datos().map((d) => ({ ...d, pct: Math.max(2, Math.round((d.valor / max) * 100)) })); });
  abreviar(v: number) { return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : String(Math.round(v)); }
}

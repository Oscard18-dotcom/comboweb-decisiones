import { Component, signal } from '@angular/core';
import { Analizar } from './decisiones/analizar';
import { Historial } from './decisiones/historial';
import { Warehouse } from './warehouse/warehouse';
import { Contexto } from './contexto/contexto';

type Vista = 'analizar' | 'hist' | 'dw';

@Component({
  selector: 'app-root',
  imports: [Analizar, Historial, Warehouse, Contexto],
  template: `
    <div class="hoja">
      <header class="cab">
        <p class="sobre">EN COMBO · Administración</p>
        <h1>Toma de decisiones</h1>
      </header>
      <app-contexto />
      <nav class="indice" aria-label="Secciones de toma de decisiones">
        @for (v of vistas; track v.k; let i = $index) {
          <button type="button" [class.on]="vista() === v.k" [attr.data-s]="v.k" (click)="vista.set(v.k)"><span class="num">{{ i + 1 }}</span>{{ v.n }}</button>
        }
      </nav>
      @switch (vista()) {
        @case ('analizar') { <app-analizar /> }
        @case ('hist') { <app-historial /> }
        @case ('dw') { <app-warehouse /> }
      }
    </div>
  `,
})
export class App {
  vista = signal<Vista>('analizar');
  vistas: { k: Vista; n: string }[] = [
    { k: 'analizar', n: 'Analizar una decisión' },
    { k: 'hist', n: 'Decisiones registradas' },
    { k: 'dw', n: 'Almacén de datos' },
  ];
}

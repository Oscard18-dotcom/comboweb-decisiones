import { Component, OnInit, inject, signal } from '@angular/core';
import { Api, fechaHora, irA } from '../core/api';
import { DecisionRegistrada } from '../core/modelos';

const BASES: Record<string, string> = { consenso: 'Consenso de los criterios', maximin: 'Maximin (Wald)', maximax: 'Maximax', laplace: 'Laplace', hurwicz: 'Hurwicz', savage: 'Savage (arrepentimiento)', vme: 'VME (valor monetario esperado)' };

@Component({
  selector: 'app-historial',
  template: `
    <section class="card">
      <p class="rotulo">Libro de decisiones</p>
      <p class="mu">Cada decisión queda con lo que decía cada criterio en ese momento. El resumen por periodo está en Reportes, sección “Decisiones registradas”.
        <button type="button" class="vinculo" data-ir="rep" (click)="ir('rep')">Abrir Reportes</button></p>
    </section>
    @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
    @if (cargando()) { <p class="mu" role="status">Cargando…</p> }
    @else if (lista().length === 0 && !error()) { <p class="mu">Aún no se han registrado decisiones.</p> }
    @for (d of lista(); track d.id) {
      <article class="asiento" [attr.data-decision]="d.id">
        <time class="fecha">{{ fh(d.creado_en) }}</time>
        <div class="cuerpo">
          <h3>{{ d.titulo }}: <em>{{ d.alternativa }}</em></h3>
          <p class="mu">Basada en {{ base(d.base) }} · Registró {{ d.usuario || '—' }}</p>
          @if (d.notas) { <p>{{ d.notas }}</p> }
          <details>
            <summary>Qué decía cada criterio</summary>
            <ul>@for (r of d.resultados.criterios; track r.clave) { <li><b>{{ r.criterio }}: </b>{{ r.ganadora || 'sin resultado' }}</li> }</ul>
            <p class="mu">{{ d.resultados.consenso.mensaje }}</p>
          </details>
        </div>
      </article>
    }
  `,
})
export class Historial implements OnInit {
  private api = inject(Api);
  readonly fh = fechaHora;
  readonly ir = irA;
  lista = signal<DecisionRegistrada[]>([]);
  error = signal('');
  cargando = signal(true);
  base = (b: string) => BASES[b] ?? b;
  async ngOnInit() {
    try { this.lista.set((await this.api.decisiones()).decisiones); } catch (e) { this.error.set((e as Error).message); }
    this.cargando.set(false);
  }
}

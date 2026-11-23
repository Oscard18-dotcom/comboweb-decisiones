import { Component, OnInit, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Api, descargar } from '../core/api';
import { ConjuntoWeka } from '../core/modelos';

@Component({
  selector: 'app-weka',
  imports: [DecimalPipe],
  templateUrl: './weka.html',
})
export class Weka implements OnInit {
  private api = inject(Api);
  datos = signal<ConjuntoWeka[]>([]);
  formato = signal<'arff' | 'csv'>('arff');
  error = signal('');
  exito = signal('');
  cargando = signal(true);
  ocupado = signal(false);
  abierto = signal<string>('');

  async ngOnInit() {
    try { this.datos.set((await this.api.conjuntosWeka()).datasets); this.error.set(''); } catch (e) { this.error.set((e as Error).message); }
    this.cargando.set(false);
  }

  elegir(f: 'arff' | 'csv') { this.formato.set(f); }
  ver(id: string) { this.abierto.set(this.abierto() === id ? '' : id); }
  nombreCorto(a: string) { return a.split('.').pop() ?? a; }

  async bajar(id: string) {
    this.ocupado.set(true); this.error.set(''); this.exito.set('');
    try {
      const x = await this.api.descargarWeka(id, this.formato());
      descargar(x.archivos);
      this.exito.set(x.archivos.length === 1 ? `Se descargó ${x.archivos[0].nombre}. Ábrelo en Weka con Explorer → Open file.` : `Se descargaron ${x.archivos.length} archivos. Ábrelos en Weka con Explorer → Open file.`);
    } catch (e) { this.error.set((e as Error).message); }
    this.ocupado.set(false);
  }
}

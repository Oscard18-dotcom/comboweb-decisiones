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
  error = signal('');
  exito = signal('');
  cargando = signal(true);
  ocupado = signal(false);

  async ngOnInit() {
    try {
      let c = await this.api.conjuntosWeka();
      const sinVentas = c.datasets.some((d) => d.id === 'produccion_diaria' && d.filas === 0);
      const sinProv = c.datasets.some((d) => d.id === 'proveedor' && d.filas === 0);
      // Igual que «Almacén de datos»: si no hay ventas, se preparan datos de demostración; si las ventas ya son de demostración, se agregan sus proveedores.
      if (sinVentas || (sinProv && c.demo && !c.demo_proveedores)) { await this.api.cargarWarehouse(true); c = await this.api.conjuntosWeka(); }
      this.datos.set(c.datasets); this.error.set('');
    } catch (e) { this.error.set((e as Error).message); }
    this.cargando.set(false);
  }

  async bajar(id: string, formato: 'arff' | 'csv') {
    this.ocupado.set(true); this.error.set(''); this.exito.set('');
    try {
      const x = await this.api.descargarWeka(id, formato);
      descargar(x.archivos);
      this.exito.set(`Se descargó ${x.archivos[0].nombre}. Ábrelo en Weka con Explorer → Open file.`);
    } catch (e) { this.error.set((e as Error).message); }
    this.ocupado.set(false);
  }
}

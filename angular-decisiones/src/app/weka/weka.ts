import { Component, inject, signal } from '@angular/core';
import { Api, descargar } from '../core/api';

@Component({
  selector: 'app-weka',
  templateUrl: './weka.html',
})
export class Weka {
  private api = inject(Api);
  readonly bloques = [
    { id: 'combo_temporada', titulo: 'Combo de temporada', pregunta: '¿Qué combo se vende más en cada temporada, mes y día de la semana?' },
    { id: 'produccion_diaria', titulo: 'Producción diaria', pregunta: '¿Cuántas piezas de cada combo conviene preparar según el mes, el día y la temporada?' },
    { id: 'proveedor', titulo: 'Proveedor', pregunta: '¿Qué proveedor entrega a tiempo y en cuántos días, según el insumo, el mes y la cantidad?' },
  ];
  error = signal('');
  exito = signal('');
  ocupado = signal(false);
  preparando = signal(false);

  async bajar(id: string) {
    this.ocupado.set(true); this.error.set(''); this.exito.set('');
    try {
      let x;
      try { x = await this.api.descargarWeka(id); }
      catch (e) {
        // Sin datos todavía: igual que «Almacén de datos», se preparan los datos de demostración (solo si el sistema no tiene ventas o si las ventas ya son de demostración).
        const c = await this.api.conjuntosWeka();
        const sinVentas = c.datasets.some((d) => d.id === 'produccion_diaria' && d.filas === 0);
        const faltanProv = c.datasets.some((d) => d.id === 'proveedor' && d.filas === 0) && c.demo && !c.demo_proveedores;
        if (!sinVentas && !faltanProv) throw e;
        this.preparando.set(true);
        await this.api.cargarWarehouse(true);
        this.preparando.set(false);
        x = await this.api.descargarWeka(id);
      }
      descargar(x.archivos);
      this.exito.set(`Se descargó ${x.archivos[0].nombre}. Ábrelo en Weka con Explorer → Open file.`);
    } catch (e) { this.error.set((e as Error).message); }
    this.preparando.set(false);
    this.ocupado.set(false);
  }
}

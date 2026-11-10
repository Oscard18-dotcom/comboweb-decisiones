import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Observable, catchError, firstValueFrom, throwError } from 'rxjs';
import { Archivo, Caso, DashboardSistema, VentasSistema, Criterio, DecisionRegistrada, Evaluacion, Matriz, ResumenWarehouse } from './modelos';

export const conSesion: HttpInterceptorFn = (req, next) => {
  let token: string | null = null;
  try { token = sessionStorage.getItem('t'); } catch {  }
  const peticion = token ? req.clone({ setHeaders: { Authorization: 'Bearer ' + token } }) : req;
  return next(peticion).pipe(catchError((e: HttpErrorResponse) => {
    if (e.status === 401 && token) window.parent.postMessage({ tipo: 'sesion-expirada' }, window.location.origin);
    const mensaje = (e.error && typeof e.error.error === 'string' && e.error.error) || (e.status === 0 ? 'No hay conexión con el servidor.' : 'Ocurrió un error.');
    return throwError(() => new Error(mensaje));
  }));
};

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);
  private ir = <T>(o: Observable<T>) => firstValueFrom(o);

  casos() { return this.ir(this.http.get<{ casos: Caso[]; criterios: Criterio[] }>('/api/decisiones/casos')); }
  evaluar(m: Matriz) { return this.ir(this.http.post<{ evaluacion: Evaluacion }>('/api/decisiones/evaluar', m)); }
  exportar(m: Matriz, titulo: string) { return this.ir(this.http.post<{ archivos: Archivo[] }>('/api/decisiones/exportar', { ...m, titulo })); }
  guardarDatos(id: string, m: Matriz) { return this.ir(this.http.put<{ ok: boolean }>(`/api/decisiones/casos/${id}`, m)); }
  restaurarDatos(id: string) { return this.ir(this.http.delete<{ ok: boolean }>(`/api/decisiones/casos/${id}`)); }
  registrar(cuerpo: { caso_id: string; alternativa: string; base: string; notas: string; matriz: Matriz }) { return this.ir(this.http.post<{ decision: { titulo: string; alternativa: string } }>('/api/decisiones', cuerpo)); }
  decisiones() { return this.ir(this.http.get<{ decisiones: DecisionRegistrada[] }>('/api/decisiones')); }

  dashboard() { return this.ir(this.http.get<DashboardSistema>('/api/reportes/dashboard')); }
  ventasRecientes() { return this.ir(this.http.get<VentasSistema>('/api/reportes/ventas')); }

  resumen() { return this.ir(this.http.get<ResumenWarehouse>('/api/warehouse/resumen')); }
  cargarWarehouse(demo: boolean) { return this.ir(this.http.post<{ ok: boolean; pedidos: number; demo: number | null }>('/api/warehouse/cargar', { demo })); }
  quitarDemo() { return this.ir(this.http.delete<{ ok: boolean; borradas: number }>('/api/warehouse/demo')); }
  exportarWarehouse() { return this.ir(this.http.get<{ archivos: Archivo[] }>('/api/warehouse/exportar')); }
}

export function descargar(archivos: Archivo[]) {
  for (const f of archivos) {
    const url = URL.createObjectURL(new Blob(['﻿' + f.contenido], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = f.nombre; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
export const fechaHora = (f: string) => new Date(f).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });

export function irA(clave: 'dash' | 'rep') {
  if (window.parent !== window) window.parent.postMessage({ tipo: 'abrir-pestana', k: clave }, window.location.origin);
}

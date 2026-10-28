import { Service, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Aviso, AvisoCreatePayload, AvisoGenerarOtPayload, AvisoGenerarOtResponse, EstadoAviso } from '../models';
import { environment } from '../../../environments/environment';

/**
 * Avisos de falla. Supervisor y gerente ven el repositorio completo de la empresa y deciden;
 * el resto de los roles de planta ve solo los avisos que reportó (el backend aplica ese alcance).
 */
@Service()
export class AvisosApi {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/avisos`;

  list(estado?: EstadoAviso) {
    const params = estado ? new HttpParams().set('estado', estado) : undefined;
    return this.http.get<Aviso[]>(this.url, { params });
  }

  /**
   * Reporta una falla, con una foto opcional. El reportante es el usuario autenticado.
   * Se envía como `multipart/form-data` (el navegador pone el `Content-Type` con su boundary).
   */
  create(payload: AvisoCreatePayload, foto?: File | null) {
    const body = new FormData();
    body.append('maquina_id', String(payload.maquina_id));
    body.append('descripcion', payload.descripcion);
    body.append('severidad', payload.severidad);
    if (foto) body.append('foto', foto);
    return this.http.post<Aviso>(this.url, body);
  }

  /** Foto del aviso. Misma visibilidad que el aviso (supervisor/gerente, o quien lo reportó). */
  foto(avisoId: number) {
    return this.http.get(`${this.url}/${avisoId}/foto`, { responseType: 'blob' });
  }

  /** El supervisor decide atender el aviso: crea la OT enlazada y marca el aviso «con OT». */
  generarOt(avisoId: number, payload: AvisoGenerarOtPayload) {
    return this.http.post<AvisoGenerarOtResponse>(`${this.url}/${avisoId}/generar-ot`, payload);
  }

  /** El supervisor decide que no hace falta una OT. El motivo es obligatorio. */
  descartar(avisoId: number, motivo: string) {
    return this.http.post<Aviso>(`${this.url}/${avisoId}/descartar`, { motivo });
  }
}

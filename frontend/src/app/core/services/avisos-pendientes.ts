import { Service, computed, effect, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';

import { Aviso } from '../models';
import { AvisosApi } from './avisos-api';
import { ToastService } from './toast.service';

/** Cada cuánto se consulta si llegaron avisos nuevos. El backend todavía no emite un evento en tiempo real. */
export const INTERVALO_AVISOS_MS = 30_000;
const TITULO_BASE = 'BARB · Mantenimiento de planta';

/**
 * Avisos pendientes para quien puede decidir sobre ellos (`gestionar_avisos`): alimenta el indicador de la navegación,
 * la pestaña «Pendientes» de la bandeja y el título de la pestaña del navegador.
 *
 * - Consulta `GET /api/avisos?estado=pendiente` cada 30 s.
 * - Se **pausa** cuando la pestaña no está visible y, al volver, refresca de inmediato.
 * - **No duplica solicitudes**: si hay una consulta en curso, no lanza otra.
 * - La bandeja, cuando trae la lista completa por su cuenta, avisa con `sincronizar` y no hace falta pedir de nuevo.
 * - Si llegan avisos que no estaban, lo avisa con un mensaje en pantalla (salvo en la primera carga).
 */
@Service()
export class AvisosPendientes {
  private readonly api = inject(AvisosApi);
  private readonly toast = inject(ToastService);
  private readonly titulo = inject(Title);

  readonly pendientes = signal<Aviso[]>([]);
  readonly total = computed(() => this.pendientes().length);
  readonly ultimaActualizacion = signal<Date | null>(null);
  /** La última consulta falló o no hay red: la cifra puede estar desactualizada. */
  readonly sinConexion = signal(false);

  private activo = false;
  private enCurso = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Ids ya vistos; `null` hasta la primera carga para no anunciar como «nuevo» lo que ya estaba. */
  private conocidos: Set<number> | null = null;

  constructor() {
    effect(() => {
      const n = this.total();
      this.titulo.setTitle(n > 0 ? `(${n}) ${TITULO_BASE}` : TITULO_BASE);
    });
  }

  iniciar(): void {
    if (this.activo || typeof document === 'undefined') return;
    this.activo = true;
    document.addEventListener('visibilitychange', this.alCambiarVisibilidad);
    window.addEventListener('online', this.alVolverLaRed);
    this.arrancarTimer();
    this.refrescar();
  }

  detener(): void {
    if (!this.activo) return;
    this.activo = false;
    document.removeEventListener('visibilitychange', this.alCambiarVisibilidad);
    window.removeEventListener('online', this.alVolverLaRed);
    this.pararTimer();
    this.conocidos = null;
    this.pendientes.set([]);
    this.ultimaActualizacion.set(null);
  }

  /** Consulta ahora, salvo que ya haya una en curso, la pestaña esté oculta o no haya red. */
  refrescar(): void {
    if (!this.activo || this.enCurso || !this.visible()) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.sinConexion.set(true);
      return;
    }
    this.enCurso = true;
    this.api.list('pendiente').subscribe({
      next: (lista) => {
        this.enCurso = false;
        this.aplicar(lista);
      },
      error: () => {
        this.enCurso = false;
        this.sinConexion.set(true);
      },
    });
  }

  /** La bandeja ya tiene la lista completa: se actualiza el conteo sin otra solicitud. */
  sincronizar(lista: Aviso[]): void {
    if (!this.activo) return;
    this.aplicar(lista.filter((a) => a.estado === 'pendiente'));
  }

  /** Un aviso propio (lo reportó este mismo usuario) no cuenta como «nuevo» al llegar en la siguiente consulta. */
  marcarVisto(avisoId: number): void {
    this.conocidos?.add(avisoId);
  }

  private aplicar(pendientes: Aviso[]): void {
    const nuevos = this.conocidos ? pendientes.filter((a) => !this.conocidos!.has(a.aviso_id)) : [];
    this.conocidos = new Set(pendientes.map((a) => a.aviso_id));

    const actuales = this.pendientes();
    const igual = actuales.length === pendientes.length && actuales.every((a, i) => a.aviso_id === pendientes[i].aviso_id);
    if (!igual) this.pendientes.set(pendientes);

    this.ultimaActualizacion.set(new Date());
    this.sinConexion.set(false);
    if (nuevos.length) this.anunciar(nuevos);
  }

  private anunciar(nuevos: Aviso[]): void {
    if (nuevos.length === 1) {
      const a = nuevos[0];
      this.toast.warning(`Llegó un aviso nuevo: ${a.machine_name}. ${a.descripcion}`, 6000);
    } else {
      this.toast.warning(`Llegaron ${nuevos.length} avisos nuevos.`, 6000);
    }
  }

  private visible(): boolean {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
  }

  private arrancarTimer(): void {
    if (this.timer || !this.visible()) return;
    this.timer = setInterval(() => this.refrescar(), INTERVALO_AVISOS_MS);
  }

  private pararTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private readonly alCambiarVisibilidad = (): void => {
    if (this.visible()) {
      this.refrescar();
      this.arrancarTimer();
    } else {
      this.pararTimer();
    }
  };

  private readonly alVolverLaRed = (): void => this.refrescar();
}

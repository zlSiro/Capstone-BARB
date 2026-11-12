import { DOCUMENT } from '@angular/common';
import { Service, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { AyudaProgresoService } from './ayuda-progreso.service';
import { AyudaService } from './ayuda.service';
import { RECORRIDOS, PasoDef, RecorridoDef } from './ayuda-contenido';

/** Tiempo máximo que se espera a que aparezca el elemento de un paso antes de mostrarlo sin resaltado. */
export const ESPERA_ELEMENTO_MS = 3_000;
const SONDEO_MS = 100;

/** ¿Se ve el elemento? (ni él ni sus ancestros tienen `display: none`, y no está con `visibility: hidden`). */
export function esVisible(el: HTMLElement): boolean {
  const vista = el.ownerDocument.defaultView;
  if (!vista || !el.isConnected) return false;
  if (vista.getComputedStyle(el).visibility === 'hidden') return false;
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    if (vista.getComputedStyle(n).display === 'none') return false;
  }
  return true;
}

/**
 * Recorridos guiados sobre la pantalla real. Expone con signals el recorrido activo, el paso actual y el total; la capa
 * visual (`RecorridoCapaComponent`) solo pinta ese estado.
 *
 * - Si el paso ocurre en otra ruta, navega a ella y espera a que el elemento exista.
 * - Si el elemento no aparece en `ESPERA_ELEMENTO_MS`, el paso se muestra sin resaltado y con un aviso: nunca se traba.
 * - Nunca avanza solo ni tiene límite de tiempo: el usuario controla cada paso.
 * - Al terminar el último paso (botón «Terminar») marca el recorrido como hecho en el progreso de primeros pasos;
 *   «Salir del recorrido» o `Esc` lo cierran sin marcarlo. En ambos casos el foco vuelve al botón que lo inició.
 */
@Service()
export class RecorridosService {
  private readonly router = inject(Router);
  private readonly doc = inject(DOCUMENT);
  private readonly ayuda = inject(AyudaService);
  private readonly progreso = inject(AyudaProgresoService);

  readonly activo = signal<RecorridoDef | null>(null);
  readonly indice = signal(0);
  readonly total = computed(() => this.activo()?.pasos.length ?? 0);
  readonly paso = computed<PasoDef | null>(() => this.activo()?.pasos[this.indice()] ?? null);
  /** Elemento resaltado del paso actual; `null` si el paso no tiene objetivo o no se encontró. */
  readonly elemento = signal<HTMLElement | null>(null);
  /** El paso tiene objetivo pero no apareció a tiempo: se muestra sin resaltado y con un aviso. */
  readonly sinElemento = signal(false);
  readonly buscando = signal(false);

  private origen: HTMLElement | null = null;
  private busqueda = 0;
  private temporizador: ReturnType<typeof setTimeout> | null = null;

  /** Inicia un recorrido (solo si el perfil actual cumple lo que declara). `origen`: botón al que volverá el foco. */
  iniciar(id: string, origen?: HTMLElement | null): void {
    const def = RECORRIDOS.find((r) => r.id === id);
    if (!def || !this.ayuda.cumple(def.requiere)) return;
    this.detener();
    this.origen = origen ?? (this.doc.activeElement as HTMLElement | null);
    this.activo.set(def);
    this.indice.set(0);
    void this.mostrarPaso();
  }

  siguiente(): void {
    if (!this.activo()) return;
    if (this.indice() >= this.total() - 1) {
      this.terminar();
      return;
    }
    this.indice.update((i) => i + 1);
    void this.mostrarPaso();
  }

  anterior(): void {
    if (!this.activo() || this.indice() === 0) return;
    this.indice.update((i) => i - 1);
    void this.mostrarPaso();
  }

  /** Cierra el recorrido sin marcarlo como hecho. */
  salir(): void {
    this.cerrar();
  }

  /** Último paso confirmado: marca el recorrido como hecho y lo cierra. */
  terminar(): void {
    const id = this.activo()?.id;
    this.cerrar();
    if (id) this.progreso.marcar(id);
  }

  /**
   * Vuelve a ubicar el elemento si la pantalla se volvió a dibujar (p. ej. se recargó la lista). La capa lo llama mientras
   * hay un recorrido activo.
   */
  reubicar(): void {
    const objetivo = this.paso()?.objetivo;
    if (!objetivo || this.buscando()) return;
    const actual = this.elemento();
    if (actual && esVisible(actual)) return;
    const nuevo = this.buscar(objetivo);
    if (nuevo) {
      this.elemento.set(nuevo);
      this.sinElemento.set(false);
    } else if (actual) {
      this.elemento.set(null);
    }
  }

  private cerrar(): void {
    this.detener();
    this.activo.set(null);
    const origen = this.origen;
    this.origen = null;
    // El foco vuelve al botón que inició el recorrido, si sigue en pantalla.
    if (origen && this.doc.contains(origen)) origen.focus();
  }

  private detener(): void {
    this.busqueda++;
    if (this.temporizador !== null) clearTimeout(this.temporizador);
    this.temporizador = null;
    this.elemento.set(null);
    this.sinElemento.set(false);
    this.buscando.set(false);
  }

  /** Ruta donde ocurre el paso actual: la del propio paso o, si no la declara, la del último paso que sí la tiene. */
  private rutaEfectiva(): string | undefined {
    const pasos = this.activo()?.pasos ?? [];
    for (let i = this.indice(); i >= 0; i--) {
      if (pasos[i]?.ruta) return pasos[i].ruta;
    }
    return undefined;
  }

  private rutaActual(): string {
    return this.router.url.split(/[?#]/)[0];
  }

  private async mostrarPaso(): Promise<void> {
    const mia = ++this.busqueda;
    const paso = this.paso();
    if (!paso) return;
    this.elemento.set(null);
    this.sinElemento.set(false);

    const ruta = this.rutaEfectiva();
    if (ruta && this.rutaActual() !== ruta) {
      this.buscando.set(true);
      await this.router.navigateByUrl(ruta);
      if (mia !== this.busqueda) return;
    }
    if (!paso.objetivo) {
      this.buscando.set(false);
      return;
    }

    this.buscando.set(true);
    const el = await this.esperar(paso.objetivo, mia);
    if (mia !== this.busqueda) return;
    this.buscando.set(false);
    if (el) {
      this.elemento.set(el);
      this.desplazar(el);
    } else {
      this.sinElemento.set(true);
    }
  }

  private buscar(objetivo: string): HTMLElement | null {
    const candidatos = Array.from(this.doc.querySelectorAll<HTMLElement>(`[data-tour="${objetivo}"]`));
    return candidatos.find(esVisible) ?? null;
  }

  /** Espera a que el elemento exista y se vea; si no aparece a tiempo resuelve `null` (el paso sigue sin resaltado). */
  private esperar(objetivo: string, mia: number): Promise<HTMLElement | null> {
    return new Promise((resolver) => {
      let transcurrido = 0;
      const intentar = (): void => {
        if (mia !== this.busqueda) return resolver(null);
        const el = this.buscar(objetivo);
        if (el) return resolver(el);
        transcurrido += SONDEO_MS;
        if (transcurrido >= ESPERA_ELEMENTO_MS) return resolver(null);
        this.temporizador = setTimeout(intentar, SONDEO_MS);
      };
      intentar();
    });
  }

  /**
   * Lleva el elemento a la vista de inmediato (sin animación): el recorrido debe mostrar el registro y su burbuja al instante,
   * no después de un desplazamiento suave. Si el elemento es muy alto se alinea por arriba para que se vea su comienzo.
   */
  private desplazar(el: HTMLElement): void {
    const alturaPantalla = this.doc.defaultView?.innerHeight ?? 0;
    const muyAlto = el.getBoundingClientRect().height > alturaPantalla * 0.6;
    el.scrollIntoView?.({ block: muyAlto ? 'start' : 'center', inline: 'nearest', behavior: 'auto' });
  }
}

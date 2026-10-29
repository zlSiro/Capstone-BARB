import { TestBed } from '@angular/core/testing';

import { EstancadasData } from '../../../../core/models';
import { AlertaEstancadasComponent } from './alerta-estancadas.component';

/**
 * Tests del banner de ordenes estancadas (HU-16 / CGBIDA-396).
 *
 * Se fija la replica del `dash-alert-banner` del legacy (Dashboard.tsx:271-286): icono,
 * titulo con la cifra, cuerpo, y auto-ocultado cuando no hay nada que avisar.
 *
 * Casos borde que se fijan a proposito:
 *  - `total = 0` no dibuja NADA (ni un banner vacio con "0 ordenes").
 *  - Solo vencidas, solo demoradas, o ambas.
 *  - `vencidas + demoradas > total` (solapamiento) no rompe la UI.
 *  - El umbral de dias viene del backend, no esta escrito en el frontend.
 */

const CON_DATOS: EstancadasData = { total: 38, vencidas: 37, demoradas: 17, umbral_dias: 7 };

function setup(datos: EstancadasData, lang: 'es' | 'en' = 'es') {
  TestBed.resetTestingModule();
  window.localStorage.setItem('barb.lang', lang);
  TestBed.configureTestingModule({ imports: [AlertaEstancadasComponent] });
  const fixture = TestBed.createComponent(AlertaEstancadasComponent);
  fixture.componentRef.setInput('datos', datos);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('AlertaEstancadasComponent', () => {
  describe('cuando hay ordenes estancadas', () => {
    it('muestra el banner con la cifra en el titulo', () => {
      const { el } = setup(CON_DATOS);
      const banner = el.querySelector('[data-testid="banner-estancadas"]');
      expect(banner).not.toBeNull();
      expect(el.querySelector('[data-testid="banner-titulo"]')!.textContent).toContain('38');
      expect(el.querySelector('[data-testid="banner-titulo"]')!.textContent).toContain(
        'ordenes de trabajo estancadas o criticas'
      );
    });

    it('muestra el cuerpo con la accion sugerida', () => {
      const { el } = setup(CON_DATOS);
      const cuerpo = el.querySelector('[data-testid="banner-cuerpo"]')!.textContent ?? '';
      expect(cuerpo).toContain('Revisa el listado de ordenes');
    });

    it('es accesible: role alert y el icono es decorativo', () => {
      const { el } = setup(CON_DATOS);
      expect(el.querySelector('[data-testid="banner-estancadas"]')!.getAttribute('role')).toBe('alert');
      expect(el.querySelector('[data-testid="banner-icono"]')!.getAttribute('aria-hidden')).toBe('true');
      // El texto para lectores de pantalla que tenia el legacy.
      expect(el.textContent).toContain('Alerta:');
    });

    it('dibuja el icono de alerta del legacy', () => {
      const { el } = setup(CON_DATOS);
      const path = el.querySelector('[data-testid="banner-icono"] path')!;
      expect(path.getAttribute('d')).toContain('M10.29 3.86');
    });
  });

  describe('desglose', () => {
    it('muestra vencidas y demoradas con su cifra', () => {
      const { el } = setup(CON_DATOS);
      const vencidas = el.querySelector('[data-testid="banner-vencidas"]')!.textContent ?? '';
      const demoradas = el.querySelector('[data-testid="banner-demoradas"]')!.textContent ?? '';
      expect(vencidas).toContain('Vencidas');
      expect(vencidas).toContain('37');
      expect(demoradas).toContain('Demoradas');
      expect(demoradas).toContain('17');
    });

    it('el umbral de dias sale del backend, no esta escrito en el componente', () => {
      // Si el backend cambia el umbral a 3, el texto debe decir 3 sin tocar el frontend.
      const { el } = setup({ total: 5, vencidas: 2, demoradas: 3, umbral_dias: 3 });
      const demoradas = el.querySelector('[data-testid="banner-demoradas"]')!;
      expect(demoradas.getAttribute('title')).toBe('En curso hace mas de 3 dias');
    });

    it('con el umbral por defecto de 7 lo dice en el tooltip', () => {
      const { el } = setup(CON_DATOS);
      expect(el.querySelector('[data-testid="banner-demoradas"]')!.getAttribute('title')).toContain(
        '7 dias'
      );
    });

    it('CASO BORDE: si la suma del desglose supera el total, igual lo muestra', () => {
      // Vencidas 10 y demoradas 8 sobre un total de 12: hay solapamiento.
      // No debe romper ni ajustar el numero a la fuerza.
      const { el } = setup({ total: 12, vencidas: 10, demoradas: 8, umbral_dias: 7 });
      expect(el.querySelector('[data-testid="banner-titulo"]')!.textContent).toContain('12');
      expect(el.querySelector('[data-testid="banner-vencidas"]')!.textContent).toContain('10');
      expect(el.querySelector('[data-testid="banner-demoradas"]')!.textContent).toContain('8');
    });

    it('omite el chip de vencidas cuando son cero', () => {
      const { el } = setup({ total: 4, vencidas: 0, demoradas: 4, umbral_dias: 7 });
      expect(el.querySelector('[data-testid="banner-vencidas"]')).toBeNull();
      expect(el.querySelector('[data-testid="banner-demoradas"]')).not.toBeNull();
    });

    it('omite el chip de demoradas cuando son cero', () => {
      const { el } = setup({ total: 3, vencidas: 3, demoradas: 0, umbral_dias: 7 });
      expect(el.querySelector('[data-testid="banner-demoradas"]')).toBeNull();
      expect(el.querySelector('[data-testid="banner-vencidas"]')).not.toBeNull();
    });
  });

  describe('CASO BORDE: sin ordenes estancadas', () => {
    it('no dibuja ningun banner cuando el total es cero', () => {
      const { el } = setup({ total: 0, vencidas: 0, demoradas: 0, umbral_dias: 7 });
      expect(el.querySelector('[data-testid="banner-estancadas"]')).toBeNull();
      expect(el.textContent!.trim()).toBe('');
    });

    it('no deja el texto de alerta cuando esta oculto', () => {
      const { el } = setup({ total: 0, vencidas: 0, demoradas: 0, umbral_dias: 7 });
      expect(el.textContent).not.toContain('estancadas');
    });
  });

  describe('i18n y estilos', () => {
    it('traduce el banner completo al ingles', () => {
      const { el } = setup(CON_DATOS, 'en');
      expect(el.textContent).toContain('stalled or critical work orders');
      expect(el.textContent).toContain('Review the work order list');
      expect(el.textContent).toContain('Expired');
      expect(el.textContent).toContain('Delayed');
      expect(el.querySelector('[data-testid="banner-demoradas"]')!.getAttribute('title')).toBe(
        'In progress for more than 7 days'
      );
    });

    it('usa la familia del rojo (token de peligro) y se adapta al modo oscuro', () => {
      const { el } = setup(CON_DATOS);
      const clase = el.querySelector('[data-testid="banner-estancadas"]')!.className;
      expect(clase).toContain('bg-peligro-suave');
      expect(clase).toContain('text-peligro');
      expect(clase).toContain('border-peligro');
    });

    it('se apila en pantallas chicas como el legacy responsive', () => {
      const { el } = setup(CON_DATOS);
      expect(el.querySelector('[data-testid="banner-estancadas"]')!.className).toContain('max-sm:flex-col');
    });
  });

  // ===========================================================================
  // Casos borde del desglose (CGBIDA-399)
  // ===========================================================================
  describe('desglose en cero', () => {
    it('con total pero sin desglose muestra el banner sin chips', () => {
      // Puede pasar si el backend cambia la definicion y el total empieza a incluir
      // ordenes que no son ni vencidas ni demoradas. El banner debe seguir avisando.
      const { el } = setup({ total: 5, vencidas: 0, demoradas: 0, umbral_dias: 7 });
      expect(el.querySelector('[data-testid="banner-estancadas"]')).not.toBeNull();
      expect(el.querySelector('[data-testid="banner-titulo"]')!.textContent).toContain('5');
      expect(el.querySelector('[data-testid="banner-vencidas"]')).toBeNull();
      expect(el.querySelector('[data-testid="banner-demoradas"]')).toBeNull();
    });

    it('la lista de desglose sigue existiendo aunque este vacia', () => {
      // Se mantiene el contenedor para que el layout no salte entre respuestas.
      const { el } = setup({ total: 5, vencidas: 0, demoradas: 0, umbral_dias: 7 });
      const lista = el.querySelector('[data-testid="banner-desglose"]');
      expect(lista).not.toBeNull();
      expect(lista!.querySelectorAll('li').length).toBe(0);
    });
  });

  describe('accesibilidad traducida', () => {
    it('el texto para lectores de pantalla cambia de idioma', () => {
      const es = setup(CON_DATOS, 'es').el.textContent ?? '';
      expect(es).toContain('Alerta:');

      TestBed.resetTestingModule();
      const en = setup(CON_DATOS, 'en').el.textContent ?? '';
      expect(en).toContain('Alert:');
    });

    it('el texto oculto no se duplica en el titulo visible', () => {
      // El `sr-only` existe para dar contexto al icono; si se repitiera dentro del
      // titulo, un lector de pantalla lo anunciaria dos veces.
      const { el } = setup(CON_DATOS);
      const titulo = el.querySelector('[data-testid="banner-titulo"]')!.textContent ?? '';
      expect(titulo).not.toContain('Alerta:');
    });
  });
});

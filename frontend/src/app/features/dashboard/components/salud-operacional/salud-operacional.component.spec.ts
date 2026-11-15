import { TestBed } from '@angular/core/testing';

import { SaludOperacionalData } from '../../../../core/models';
import { SaludOperacionalComponent } from './salud-operacional.component';

/**
 * Tests del semáforo simplificado (CGBIDA-520).
 *
 * Lo que se protege:
 *  - El estado se traduce a una etiqueta en palabras (verde/amarillo/rojo) y a un color.
 *  - El **motivo** que manda el backend se muestra tal cual: es la explicación del color.
 *  - La línea simple con SLA y OTs vencidas.
 *  - Sin datos NO se pinta verde: estado `insuficiente` y SLA con guion.
 *  - Ya no existen el anillo del índice ni las tres sub-tarjetas.
 */

function datos(overrides: Partial<SaludOperacionalData> = {}): SaludOperacionalData {
  return {
    estado: 'rojo',
    motivo: '13 OT(s) vencida(s) sin cerrar.',
    sla: 97.7,
    estancadas: 15,
    vencidas: 13,
    ...overrides,
  };
}

function setup(salud: SaludOperacionalData | null) {
  window.localStorage.setItem('barb.lang', 'es');
  TestBed.configureTestingModule({ imports: [SaludOperacionalComponent] });
  const fixture = TestBed.createComponent(SaludOperacionalComponent);
  fixture.componentRef.setInput('salud', salud);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

/** Texto de un elemento por data-testid. */
function texto(el: HTMLElement, testid: string): string {
  return el.querySelector(`[data-testid="${testid}"]`)?.textContent?.trim() ?? '';
}

describe('salud-operacional: estados', () => {
  it('rojo muestra el estado y el motivo del backend', () => {
    const { el } = setup(datos());
    expect(texto(el, 'estado-salud')).toBe('Crítico');
    expect(texto(el, 'motivo-salud')).toBe('13 OT(s) vencida(s) sin cerrar.');
  });

  it('amarillo se rotula Atencion', () => {
    const { el } = setup(datos({ estado: 'amarillo', motivo: '2 OT(s) demorada(s) en curso.' }));
    expect(texto(el, 'estado-salud')).toBe('Atención');
    expect(texto(el, 'motivo-salud')).toContain('demorada');
  });

  it('verde se rotula Saludable', () => {
    const { el } = setup(
      datos({ estado: 'verde', motivo: 'Sin OTs vencidas ni demoradas y SLA sobre el objetivo.' })
    );
    expect(texto(el, 'estado-salud')).toBe('Saludable');
  });
});

describe('salud-operacional: colores e iconos', () => {
  it('pinta la luz con el color del estado', () => {
    const { el } = setup(datos({ estado: 'rojo' }));
    const luz = el.querySelector('[data-testid="luz-salud"]') as HTMLElement;
    expect(luz.style.background).toBe('var(--peligro)');
  });

  it('verde usa el token de ok', () => {
    const { el } = setup(datos({ estado: 'verde' }));
    const luz = el.querySelector('[data-testid="luz-salud"]') as HTMLElement;
    expect(luz.style.background).toBe('var(--ok)');
  });

  it('verde usa el glifo de check', () => {
    expect(texto(setup(datos({ estado: 'verde' })).el, 'luz-salud')).toBe('✓');
  });

  it('amarillo usa el glifo de atencion', () => {
    expect(texto(setup(datos({ estado: 'amarillo' })).el, 'luz-salud')).toBe('!');
  });

  it('rojo usa el glifo de falla', () => {
    expect(texto(setup(datos({ estado: 'rojo' })).el, 'luz-salud')).toBe('✕');
  });
});

describe('salud-operacional: sin linea de SLA duplicada', () => {
  it('no repite el SLA ni las vencidas debajo del semaforo', () => {
    // CGBIDA-550: el semaforo y su motivo ya dicen las dos cosas.
    const { el } = setup(datos({ sla: 91.25, vencidas: 7 }));

    expect(el.querySelector('[data-testid="sla-salud"]')).toBeNull();
    expect(el.querySelector('[data-testid="resumen-salud"]')).toBeNull();
    expect(el.querySelector('[data-testid="vencidas-salud"]')).toBeNull();
  });

  it('los contadores llevan color en el numero', () => {
    const { el } = setup(
      datos({ desglose: { completadas: 4, en_curso: 2, pendientes: 1 } }),
    );

    const color = (clave: string) =>
      el
        .querySelector(`[data-testid="desglose-${clave}"] p`)
        ?.getAttribute('class') ?? '';

    // Verde / azul / naranja: los tokens del tema (ok, accion, alerta).
    expect(color('completadas')).toContain('text-ok');
    expect(color('en-curso')).toContain('text-accion');
    expect(color('pendientes')).toContain('text-alerta');
  });
});

describe('salud-operacional: sin datos', () => {
  it('sin datos el estado es insuficiente, nunca verde', () => {
    const { el } = setup(null);
    expect(texto(el, 'estado-salud')).toBe('Sin datos');
    const luz = el.querySelector('[data-testid="luz-salud"]') as HTMLElement;
    expect(luz.style.background).toBe('var(--neutro)');
  });

  it('sin datos los contadores quedan en 0', () => {
    const { el } = setup(null);
    expect(texto(el, "desglose-completadas")).toContain("0");
  });

  it('sin datos el motivo es el aviso de falta de historial', () => {
    const { el } = setup(null);
    expect(texto(el, 'motivo-salud')).toContain('Faltan datos');
  });
});

describe('salud-operacional: ya no tiene las sub-tarjetas viejas', () => {
  it('no renderiza el desglose de SLA/MTBF/backlog ni el anillo', () => {
    const { el } = setup(datos());
    expect(el.querySelector('[data-testid="componentes-salud"]')).toBeNull();
    expect(el.querySelector('[data-testid="anillo-salud"]')).toBeNull();
    expect(el.querySelector('[data-testid="indice-salud"]')).toBeNull();
  });
});


describe('salud-operacional: desglose de OTs (CGBIDA-550)', () => {
  it('muestra los tres contadores con los valores del backend', () => {
    const { el } = setup({
      ...datos(),
      desglose: { completadas: 42, en_curso: 7, pendientes: 13 },
    });

    expect(texto(el, "desglose-completadas")).toContain("42");
    expect(texto(el, "desglose-en-curso")).toContain("7");
    expect(texto(el, "desglose-pendientes")).toContain("13");
  });

  it('los rotula en el idioma activo', () => {
    const { el } = setup({
      ...datos(),
      desglose: { completadas: 1, en_curso: 2, pendientes: 3 },
    });

    expect(texto(el, "desglose-completadas")).toContain("Completadas");
    expect(texto(el, "desglose-en-curso")).toContain("En curso");
    expect(texto(el, "desglose-pendientes")).toContain("Pendientes");
  });

  it('sin desglose muestra 0 y no rompe', () => {
    const { el } = setup(datos());

    expect(texto(el, "desglose-completadas")).toContain("0");
    expect(el.querySelector('[data-testid="desglose-salud"]')).not.toBeNull();
  });
});
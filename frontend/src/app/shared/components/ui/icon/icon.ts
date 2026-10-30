import { Component, computed, input } from '@angular/core';

/**
 * Íconos de la app: trazos de 2 px sobre una malla de 24 × 24, con extremos redondeados. Se dibujan con `currentColor`,
 * así que toman el color del texto y cambian solos con el tema. Reemplazan a los emoji (que se veían distinto en cada
 * celular y no tenían contraste controlado).
 */
const ICONOS = {
  alerta: ['M12 3.5 L21.5 19.5 H2.5 Z', 'M12 10 V14', 'M12 17 V17.01'],
  camara: ['M4 8 H7.5 L9 5.5 H15 L16.5 8 H20 V19 H4 Z', 'M8.5 13.5 A3.5 3.5 0 1 0 15.5 13.5 A3.5 3.5 0 1 0 8.5 13.5 Z'],
  imagen: ['M4 5 H20 V19 H4 Z', 'M8 9.5 A1.5 1.5 0 1 0 11 9.5 A1.5 1.5 0 1 0 8 9.5 Z', 'M4 17 L9 12 L13 16 L16 13 L20 17'],
  etiqueta: [
    'M7 3.5 H17 L20.5 7 V20.5 H3.5 V7 Z',
    'M10.5 7.5 A1.5 1.5 0 1 0 13.5 7.5 A1.5 1.5 0 1 0 10.5 7.5 Z',
    'M8 13 H16',
    'M8 17 H13',
  ],
  orden: ['M7 5.5 H5.5 V20.5 H18.5 V5.5 H17', 'M9 3.5 H15 V7 H9 Z', 'M8.5 12 H15.5', 'M8.5 16 H13'],
  'orden-ok': ['M7 5.5 H5.5 V20.5 H18.5 V5.5 H17', 'M9 3.5 H15 V7 H9 Z', 'M8.5 14 L11 16.5 L15.5 11.5'],
  check: ['M5 12.5 L10 17.5 L19 7'],
  'check-circulo': ['M3 12 A9 9 0 1 0 21 12 A9 9 0 1 0 3 12 Z', 'M8 12.5 L11 15.5 L16.5 9'],
  'circulo-tachado': ['M3 12 A9 9 0 1 0 21 12 A9 9 0 1 0 3 12 Z', 'M5.6 5.6 L18.4 18.4'],
  x: ['M6 6 L18 18', 'M18 6 L6 18'],
  reloj: ['M3 12 A9 9 0 1 0 21 12 A9 9 0 1 0 3 12 Z', 'M12 7 V12 L15.5 14'],
  lupa: ['M4 11 A7 7 0 1 0 18 11 A7 7 0 1 0 4 11 Z', 'M16.5 16.5 L21 21'],
  topologia: [
    'M9.5 5 A2.5 2.5 0 1 0 14.5 5 A2.5 2.5 0 1 0 9.5 5 Z',
    'M2.5 18 A2.5 2.5 0 1 0 7.5 18 A2.5 2.5 0 1 0 2.5 18 Z',
    'M16.5 18 A2.5 2.5 0 1 0 21.5 18 A2.5 2.5 0 1 0 16.5 18 Z',
    'M10.8 7.2 L6.2 15.8',
    'M13.2 7.2 L17.8 15.8',
    'M7.5 18 H16.5',
  ],
  panel: ['M3 21 H21', 'M5 21 V12 H9 V21', 'M10 21 V5 H14 V21', 'M15 21 V9 H19 V21'],
  chat: ['M4 5 H20 V16 H12 L7 20 V16 H4 Z'],
  libro: ['M5 4 H18 A1 1 0 0 1 19 5 V20 H6.5 A1.5 1.5 0 0 1 5 18.5 Z', 'M5 18.5 A1.5 1.5 0 0 1 6.5 17 H19', 'M9 8 H15'],
  usuarios: [
    'M6 8 A3 3 0 1 0 12 8 A3 3 0 1 0 6 8 Z',
    'M3 20 V19 A5 5 0 0 1 8 14 H10 A5 5 0 0 1 15 19 V20',
    'M16 5.2 A3 3 0 0 1 16 10.8',
    'M18 14.2 A5 5 0 0 1 21 19 V20',
  ],
  usuario: ['M8 8 A4 4 0 1 0 16 8 A4 4 0 1 0 8 8 Z', 'M4 20.5 V19 A5 5 0 0 1 9 14 H15 A5 5 0 0 1 20 19 V20.5'],
  edificio: ['M5 21 V4 H14 V21', 'M14 9 H19 V21', 'M3 21 H21', 'M8 8 H11', 'M8 12 H11', 'M8 16 H11'],
  registro: ['M6 3.5 H15 L19 7.5 V20.5 H6 Z', 'M15 3.5 V7.5 H19', 'M9 12 H16', 'M9 16 H16'],
  mas: [
    'M4 12 A1 1 0 1 0 6 12 A1 1 0 1 0 4 12 Z',
    'M11 12 A1 1 0 1 0 13 12 A1 1 0 1 0 11 12 Z',
    'M18 12 A1 1 0 1 0 20 12 A1 1 0 1 0 18 12 Z',
  ],
  menu: ['M4 7 H20', 'M4 12 H20', 'M4 17 H20'],
  sol: [
    'M8 12 A4 4 0 1 0 16 12 A4 4 0 1 0 8 12 Z',
    'M12 2.5 V4.5',
    'M12 19.5 V21.5',
    'M2.5 12 H4.5',
    'M19.5 12 H21.5',
    'M5.3 5.3 L6.7 6.7',
    'M17.3 17.3 L18.7 18.7',
    'M5.3 18.7 L6.7 17.3',
    'M17.3 6.7 L18.7 5.3',
  ],
  luna: ['M20 14.5 A8.5 8.5 0 1 1 9.5 4 A7 7 0 0 0 20 14.5 Z'],
  idioma: ['M3 12 A9 9 0 1 0 21 12 A9 9 0 1 0 3 12 Z', 'M3 12 H21', 'M12 3 A13 13 0 0 1 12 21', 'M12 3 A13 13 0 0 0 12 21'],
  salir: ['M10 4 H5 V20 H10', 'M9 12 H21', 'M17 8 L21 12 L17 16'],
  atras: ['M15 5 L8 12 L15 19'],
  refrescar: ['M20 11 A8 8 0 1 0 18.5 16', 'M20 5 V11 H14'],
  'sin-conexion': ['M3 3 L21 21', 'M5 10 A10 10 0 0 1 9 7.6', 'M8.5 14.2 A6 6 0 0 1 12 12.9', 'M12 18 V18.01', 'M15.5 8 A10 10 0 0 1 19 10'],
  agregar: ['M12 5 V19', 'M5 12 H19'],
  papelera: ['M4 7 H20', 'M9 7 V4 H15 V7', 'M6 7 L7 20 H17 L18 7', 'M10 11 V16', 'M14 11 V16'],
  clip: ['M20 11.5 L12 19.5 A5 5 0 0 1 5 12.5 L13 4.5 A3.3 3.3 0 0 1 17.7 9.2 L9.7 17.2 A1.7 1.7 0 0 1 7.3 14.8 L14.5 7.6'],
  'chevron-abajo': ['M6 9 L12 15 L18 9'],
  info: ['M3 12 A9 9 0 1 0 21 12 A9 9 0 1 0 3 12 Z', 'M12 11 V16', 'M12 8 V8.01'],
} as const satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof ICONOS;

/** `<app-icon name="camara" [size]="24" />`. Es decorativo; con `label` se anuncia a los lectores de pantalla. */
@Component({
  selector: 'app-icon',
  host: {
    class: 'inline-flex shrink-0',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
  },
  template: `
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="size-full"
      [attr.aria-hidden]="label() ? null : 'true'"
      [attr.role]="label() ? 'img' : null"
      [attr.aria-label]="label() || null"
      focusable="false">
      @for (d of paths(); track $index) {
        <path [attr.d]="d" />
      }
    </svg>
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(20);
  readonly label = input('');

  protected readonly paths = computed(() => ICONOS[this.name()] ?? []);
}

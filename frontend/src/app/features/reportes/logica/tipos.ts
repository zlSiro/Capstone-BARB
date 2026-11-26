import { ParamsTexto } from '../../../core/i18n/i18n.service';
import { FiltrosReporte } from '../../../core/models';
import { Catalogos } from '../filtros/filtros-url';

/** Formateo según el idioma y la moneda activos. Lo arma la página con `I18nService`, `CurrencyService` y `MtbfUnitService`. */
export interface Formato {
  idioma: 'es' | 'en';
  t: (clave: string, params?: ParamsTexto) => string;
  /** Número con los separadores del idioma y `dec` decimales. */
  numero: (valor: number, dec?: number) => string;
  /** Monto con símbolo, en la moneda activa (parte de pesos). */
  moneda: (clp: number) => string;
  /** Monto convertido a la moneda activa, sin formato (para el CSV). */
  convertir: (clp: number) => number;
  monedaCodigo: 'CLP' | 'USD';
  /** Horas de MTBF en la unidad que eligió el usuario. */
  mtbf: (horas: number) => string;
  /** `YYYY-MM-DD HH:mm` en hora local; vacío si no hay fecha. */
  fecha: (iso: string | null | undefined) => string;
}

/** Todo lo que un reporte necesita saber de «cuándo, quién y con qué filtros». */
export interface Contexto {
  f: FiltrosReporte;
  cat: Catalogos;
  fmt: Formato;
  /** Un solo «ahora» por carga (ms): todos los cortes de tiempo del cliente usan el mismo. */
  ahora: number;
  /** El perfil tiene `ver_kpis_financieros`: solo así se muestran y exportan los costos. */
  puedeFinanzas: boolean;
  /** Id del usuario con sesión (R8 comprueba que todo lo que muestra es suyo). */
  usuarioId?: number | null;
}

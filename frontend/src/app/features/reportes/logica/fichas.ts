import { FichaCalculo } from '../../../core/models';
import { Formato } from './tipos';

/**
 * «Cómo se calcula»: ficha por indicador (fórmula, unidad, ventana y advertencias), al estilo de ISO 22400-2. Los textos
 * viven en `core/i18n/textos/reportes.ts` (`ficha_<id>_indicador|formula|unidad|ventana|advertencia`) y salen de las
 * definiciones del backend (`stats.py`) y de `docs/referencias/DASHBOARD_KPIS.md`.
 */
export type FichaId =
  | 'sla' | 'mttr' | 'mtbf' | 'disponibilidad' | 'salud' | 'estancadas' | 'costo' | 'tipo' | 'aviso' | 'calidad' | 'backlog' | 'periodo' | 'traza';

/** Fichas que llevan una advertencia (las demás no la tienen). */
const CON_ADVERTENCIA: readonly FichaId[] = ['sla', 'mttr', 'mtbf', 'disponibilidad', 'estancadas', 'costo', 'tipo', 'calidad', 'backlog', 'traza'];

export function fichas(ids: readonly FichaId[], fmt: Formato): FichaCalculo[] {
  return ids.map((id) => ({
    id,
    indicador: fmt.t(`reportes.ficha_${id}_indicador`),
    formula: fmt.t(`reportes.ficha_${id}_formula`),
    unidad: fmt.t(`reportes.ficha_${id}_unidad`),
    ventana: fmt.t(`reportes.ficha_${id}_ventana`),
    ...(CON_ADVERTENCIA.includes(id) ? { advertencia: fmt.t(`reportes.ficha_${id}_advertencia`) } : {}),
  }));
}

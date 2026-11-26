import { FiltrosReporte, ReporteId } from '../../../core/models';
import { Formato } from '../logica/tipos';
import { Catalogos, ClaveFiltro, filtrosActivos } from './filtros-url';

/** Texto de cada filtro activo («Periodo: 30 días», «Planta: Norte»…): lo usan los chips de la pantalla y el encabezado del PDF. */
export interface EtiquetaFiltro {
  clave: ClaveFiltro;
  texto: string;
}

export function etiquetasFiltros(id: ReporteId, f: FiltrosReporte, cat: Catalogos, fmt: Formato): EtiquetaFiltro[] {
  const { t } = fmt;
  const nombre = (lista: { id: number; name: string }[], valor: number | null) => lista.find((x) => x.id === valor)?.name ?? String(valor);
  const texto = (clave: ClaveFiltro): string => {
    switch (clave) {
      case 'dias':
        return `${t('reportes.f_periodo')}: ${f.dias === null ? t('reportes.f_historico') : t('reportes.f_dias', { v0: f.dias })}`;
      case 'planta':
        return `${t('reportes.f_planta')}: ${nombre(cat.plantas, f.planta)}`;
      case 'disciplina':
        return `${t('reportes.f_disciplina')}: ${nombre(cat.disciplinas, f.disciplina)}`;
      case 'maquina':
        return `${t('reportes.f_maquina')}: ${nombre(cat.maquinas, f.maquina)}`;
      case 'granularidad':
        return `${t('reportes.f_granularidad')}: ${t(`reportes.v_gran_${f.granularidad}`)}`;
      case 'estados': {
        const prefijo = id === 'r7' || id === 'r8' ? 'aviso' : 'estado';
        return `${t('reportes.f_estado')}: ${f.estados.map((e) => t(`reportes.v_${prefijo}_${e}`)).join(', ')}`;
      }
      case 'prioridad':
        return `${t('reportes.f_prioridad')}: ${t(`reportes.v_prioridad_${f.prioridad}`)}`;
      case 'tipo':
        return `${t('reportes.f_tipo')}: ${t(`reportes.v_tipo_${f.tipo}`)}`;
      case 'tecnico':
        return `${t('reportes.f_tecnico')}: ${cat.tecnicos.find((x) => x.id === f.tecnico)?.name ?? f.tecnico}`;
      case 'tramo':
        return `${t('reportes.f_tramo')}: ${t(`reportes.v_tramo_${f.tramo}`)}`;
      case 'soloDemoradas':
        return t('reportes.f_solo_demoradas');
      case 'severidad':
        return `${t('reportes.f_severidad')}: ${t(`reportes.v_severidad_${f.severidad}`)}`;
      case 'perfil':
        return `${t('reportes.f_perfil')}: ${t(`reportes.v_rol_${f.perfil}`)}`;
      case 'estadoOt':
        return `${t('reportes.f_estado_ot')}: ${t(`reportes.v_estado_${f.estadoOt}`)}`;
      case 'soloDesviacion':
        return t('reportes.f_solo_desviacion');
      case 'campoFaltante':
        return `${t('reportes.f_campo_faltante')}: ${t(`reportes.v_falta_${f.campoFaltante}`)}`;
      case 'numeroOt':
        return `${t('reportes.f_numero_ot')}: ${f.numeroOt}`;
      default:
        return String(clave);
    }
  };
  return filtrosActivos(f, id).map((clave) => ({ clave, texto: texto(clave) }));
}

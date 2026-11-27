import { Aviso, FinancialStats, WorkOrder } from '../../core/models';
import { Catalogos } from './filtros/filtros-url';
import { Contexto, Formato } from './logica/tipos';
import { FILTROS_VACIOS, FiltrosReporte } from '../../core/models';

/** Datos de apoyo para las pruebas de los reportes (no se usa en la aplicación). */

const dos = (n: number) => String(n).padStart(2, '0');

export function formatoTest(idioma: 'es' | 'en' = 'es'): Formato {
  const nf = (v: number, dec: number) =>
    new Intl.NumberFormat(idioma === 'es' ? 'es-CL' : 'en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v);
  return {
    idioma,
    t: (clave, params) => (params ? `${clave}${JSON.stringify(params)}` : clave),
    numero: (v, dec = 0) => nf(v, dec),
    moneda: (v) => `$${nf(Math.round(v), 0)}`,
    convertir: (v) => v,
    monedaCodigo: 'CLP',
    mtbf: (h) => `${nf(h, 1)} h`,
    fecha: (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}:${dos(d.getMinutes())}`;
    },
  };
}

export const CAT: Catalogos = {
  plantas: [{ id: 1, name: 'Norte' }, { id: 2, name: 'Sur' }],
  disciplinas: [{ id: 10, name: 'Mecánica' }, { id: 11, name: 'Eléctrica' }],
  maquinas: [
    { id: 100, name: 'Bomba', plant_id: 1, discipline_id: 10 },
    { id: 101, name: 'Tablero', plant_id: 1, discipline_id: 11 },
    { id: 102, name: 'Molino', plant_id: 2, discipline_id: 10 },
  ],
  tecnicos: [{ id: 7, name: 'Ana', email: 'a@x.cl', role: 'tecnico' }, { id: 8, name: 'Luis', email: 'l@x.cl', role: 'tecnico' }],
};

/** 1 de noviembre de 2026, 12:00 UTC: «ahora» fijo de las pruebas. */
export const AHORA = Date.UTC(2026, 10, 1, 12, 0, 0);
export const DIA = 86_400_000;
export const haceDias = (n: number, extraHoras = 0) => new Date(AHORA - n * DIA - extraHoras * 3_600_000).toISOString();

let seq = 0;
export function ot(p: Partial<WorkOrder> = {}): WorkOrder {
  seq += 1;
  const n = String(seq).padStart(4, '0');
  return {
    id: `OT-2026-${n}`,
    numero_ot: `OT-2026-${n}`,
    ot_id: 1000 + seq,
    title: 'Falla',
    machine: 'Bomba',
    machine_name: 'Bomba',
    machine_id: 100,
    plant: 'Norte',
    plant_name: 'Norte',
    plant_id: 1,
    discipline: 'Mecánica',
    discipline_name: 'Mecánica',
    priority: 'medium',
    status: 'Pending',
    estado: 'pending',
    age_minutes: 0,
    created_at: haceDias(1),
    photo_count: 0,
    photos: [],
    tecnico_id: 7,
    tecnico_nombre: 'Ana',
    tipo: 'corrective',
    costo_estimado: 0,
    costo_real: 0,
    downtime_minutes: null,
    ...p,
  };
}

export function aviso(p: Partial<Aviso> = {}): Aviso {
  seq += 1;
  return {
    aviso_id: 500 + seq,
    numero_aviso: `AV-2026-${String(seq).padStart(4, '0')}`,
    maquina_id: 100,
    machine_name: 'Bomba',
    plant_name: 'Norte',
    empresa_id: 1,
    descripcion: 'Ruido anormal',
    severidad: 'medium',
    estado: 'pendiente',
    status: 'Pendiente',
    reportado_por: { id: 3, nombre: 'Op Uno', rol: 'operador' },
    created_at: haceDias(2),
    resuelto_en: null,
    resuelto_por: null,
    motivo_descarte: null,
    numero_ot: null,
    foto: null,
    ...p,
  };
}

export function ctx(f: Partial<FiltrosReporte> = {}, extra: Partial<Contexto> = {}): Contexto {
  return { f: { ...FILTROS_VACIOS, ...f }, cat: CAT, fmt: formatoTest(), ahora: AHORA, puedeFinanzas: false, ...extra };
}

/** Respuesta de `financial-impact` mínima y coherente (lo que cada prueba necesita se sobrescribe). */
export function stats(p: Partial<FinancialStats> = {}): FinancialStats {
  return {
    financials: { disponibilidad_planta: 99.5, mttr: 120, efficiency: 80, mtbfHours: 500, mtbf_visible: true },
    financieros_visibles: false,
    trend14Days: [],
    machines: [],
    por_tipo: [],
    estancadas: { total: 0, vencidas: 0, demoradas: 0, umbral_dias: 7 },
    salud_operacional: {
      estado: 'verde',
      motivo: 'Todo en orden.',
      sla: 80,
      estancadas: 0,
      vencidas: 0,
      desglose: { completadas: 0, en_curso: 0, pendientes: 0, por_validar: 0, canceladas: 0, total: 0 },
    },
    top_5_peor_mttr: [],
    top_5_peor_mtbf: [],
    ...p,
  };
}

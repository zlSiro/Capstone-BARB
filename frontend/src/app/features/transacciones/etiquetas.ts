import { OperacionTransaccion, RangoTransacciones, Transaccion } from '../../core/models';

/** Etiquetas y utilidades de presentación compartidas por las vistas de transacciones (super_usuario y gerente). */

export const PAGE_SIZE = 50;

export const RANGOS: { value: RangoTransacciones; label: string }[] = [
  { value: '24h', label: 'Hace 24 horas' },
  { value: '7d', label: 'Hace una semana' },
  { value: '30d', label: 'Hace un mes' },
  { value: '1y', label: 'Hace un año' },
  { value: 'custom', label: 'Personalizar' },
];

export const OPERACION_LABEL: Record<OperacionTransaccion, string> = {
  INSERT: 'Creó',
  UPDATE: 'Modificó',
  DELETE: 'Eliminó',
};

export const OPERACION_STYLE: Record<OperacionTransaccion, string> = {
  INSERT: 'bg-ok-suave text-ok',
  UPDATE: 'bg-accion-suave text-accion',
  DELETE: 'bg-peligro-suave text-peligro',
};

const TABLA_LABEL: Record<string, string> = {
  orden_trabajo: 'orden de trabajo',
  usuario: 'usuario',
  empresa: 'empresa',
  documento: 'documento',
  notificacion_config: 'configuración de notificaciones',
  ot_foto: 'foto de OT',
  ot_repuesto: 'repuesto de OT',
};

const ROL_LABEL: Record<string, string> = {
  operador: 'Operador',
  tecnico: 'Técnico',
  supervisor: 'Supervisor',
  engineer: 'Engineer',
  gerente: 'Gerente',
  admin: 'Admin',
  visitante: 'Visitante',
  super_usuario: 'Super usuario',
};

export const rolLabel = (r: string): string => ROL_LABEL[r] ?? r;

export const tablaLabel = (t: string | null): string => (t ? (TABLA_LABEL[t] ?? t.replaceAll('_', ' ')) : '');

function formatear(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 120 ? s.slice(0, 117) + '…' : s;
}

/** Columnas modificadas (UPDATE: "antes → después") o datos guardados (INSERT/DELETE). */
export function columnasDeTransaccion(t: Transaccion): { nombre: string; valor: string }[] {
  const d = t.detalle;
  if (d.cambios) {
    return Object.entries(d.cambios).map(([nombre, c]) => ({
      nombre,
      valor: `${formatear(c.antes)} → ${formatear(c.despues)}`,
    }));
  }
  return Object.entries(d.datos ?? {}).map(([nombre, v]) => ({ nombre, valor: formatear(v) }));
}

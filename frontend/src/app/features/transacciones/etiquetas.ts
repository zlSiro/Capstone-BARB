import { OperacionTransaccion, RangoTransacciones, Transaccion } from '../../core/models';
import { textoActual } from '../../core/i18n/i18n.service';

/** Etiquetas y utilidades de presentación compartidas por las vistas de transacciones (super_usuario y gerente). */

export const PAGE_SIZE = 50;

// Los textos van con `get`: se calculan al leerlos, así siguen el idioma elegido.
export const RANGOS: { value: RangoTransacciones; label: string }[] = [
  { value: '24h', get label() { return textoActual('trx.hace_24_horas'); } },
  { value: '7d', get label() { return textoActual('trx.hace_una_semana'); } },
  { value: '30d', get label() { return textoActual('trx.hace_un_mes'); } },
  { value: '1y', get label() { return textoActual('trx.hace_un_ano'); } },
  { value: 'custom', get label() { return textoActual('trx.personalizar'); } },
];

export const OPERACION_LABEL: Record<OperacionTransaccion, string> = {
  get INSERT() { return textoActual('trx.creo'); },
  get UPDATE() { return textoActual('trx.modifico'); },
  get DELETE() { return textoActual('trx.elimino'); },
};

export const OPERACION_STYLE: Record<OperacionTransaccion, string> = {
  INSERT: 'bg-ok-suave text-ok',
  UPDATE: 'bg-accion-suave text-accion',
  DELETE: 'bg-peligro-suave text-peligro',
};

const TABLA_CLAVE: Record<string, string> = {
  orden_trabajo: 'trx.orden_de_trabajo',
  usuario: 'trx.usuario_2',
  empresa: 'trx.empresa_2',
  documento: 'trx.documento',
  notificacion_config: 'trx.configuracion_de_notificacione',
  ot_foto: 'trx.foto_de_ot',
  ot_repuesto: 'trx.repuesto_de_ot',
};

const ROL_CLAVE: Record<string, string> = {
  operador: 'trx.operador',
  tecnico: 'trx.tecnico',
  supervisor: 'trx.supervisor',
  engineer: 'trx.engineer',
  gerente: 'trx.gerente',
  admin: 'trx.admin',
  super_usuario: 'trx.super_usuario',
};

export const rolLabel = (r: string): string => (ROL_CLAVE[r] ? textoActual(ROL_CLAVE[r]) : r);

export const tablaLabel = (t: string | null): string =>
  t ? (TABLA_CLAVE[t] ? textoActual(TABLA_CLAVE[t]) : t.replaceAll('_', ' ')) : '';

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

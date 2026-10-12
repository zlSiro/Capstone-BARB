// =============================================================================
// TOPOLOGÍA DE PLANTA — GET /api/topology
// Contrato: docs/contrato_api_topologia.md (CGBIDA-358)
// =============================================================================

/** Nivel del nodo dentro del mapa. El backend los emite en este orden jerárquico. */
export type TopologyNodeKind = 'Planta' | 'Disciplina' | 'Máquina';

/**
 * Estado de un equipo. Se deriva EN VIVO de las órdenes de trabajo abiertas,
 * no de una columna de estado del equipo (ver contrato, sección "Estados de un nodo").
 *
 * - `falla`     → hay una OT no cerrada urgente o vencida
 * - `alerta`    → hay alguna OT no cerrada
 * - `operativo` → ninguna OT abierta
 * - `desconectado` → decidido en CGBIDA-355 (A-4) pero el backend NO lo emite todavía
 */
export type TopologyNodeState = 'operativo' | 'alerta' | 'falla' | 'desconectado';

export interface TopologyNode {
  /** `p_<planta>` · `d_<disciplina>` · `m_<maquina>` */
  nodo_id: string;
  nombre_visual: string;
  tipo: TopologyNodeKind;
  /** Emoji fijo por nivel: 🏭 · ⚙️ · 🤖 */
  icono: string;
  /** Coordenada generada por el backend; NO es una posición física real. */
  pos_x: number;
  /** Fija por nivel: 100 planta · 300 disciplina · 500 máquina. */
  pos_y: number;
  estado_actual: TopologyNodeState;
  /** Solo presente en nodos de tipo `Máquina`. */
  maquina_id?: number;
}

export type TopologyRelation = 'jerarquia' | 'pertenece';

export interface TopologyConnection {
  conexion_id: string;
  origen_nodo_id: string;
  destino_nodo_id: string;
  /** `jerarquia` = planta→disciplina · `pertenece` = disciplina→máquina */
  tipo_relacion: TopologyRelation;
}

export interface Topology {
  nodos: TopologyNode[];
  conexiones: TopologyConnection[];
}

import { describe, expect, it } from 'vitest';
import { formatOtBadges } from './chat-ot-badges';

describe('chat-ot-badges', () => {
  it('transforma estados y prioridades en bloque de OT creada', () => {
    const input = `OT creada: **OT-IA-20261119-123456-ABCD**
- Equipo: Bomba de pulpa KSB (BOM-001) — Planta Concentradora
- Problema: Ruido y vibración excesiva
- Tipo: correctivo · Prioridad: Alta
- Estado: Pendiente · Asignada a: Juan Pérez
Puedes verla en el tablero de órdenes de trabajo.`;

    const result = formatOtBadges(input);

    expect(result).toContain('bg-alerta-suave text-alerta'); // Prioridad Alta
    expect(result).toContain('Alta');
    expect(result).toContain('bg-media-suave text-media'); // Estado Pendiente
    expect(result).toContain('bg-media'); // dot
    expect(result).toContain('Pendiente');
  });

  it('transforma términos en inglés a badges correspondientes', () => {
    const input = `- Tipo: correctivo · Prioridad: high
- Estado: in_progress · Asignada a: Juan Pérez`;

    const result = formatOtBadges(input);

    expect(result).toContain('bg-alerta-suave text-alerta');
    expect(result).toContain('bg-accion-suave text-accion');
  });

  it('transforma OTs en paréntesis estilo resumen', () => {
    const input = `Abiertas más recientes: OT-001 (Pendiente, prioridad Media); OT-002 (in_progress, prioridad high).`;

    const result = formatOtBadges(input);

    expect(result).toContain('bg-media-suave text-media');
    expect(result).toContain('bg-accion-suave text-accion');
    expect(result).toContain('bg-alerta-suave text-alerta');
  });

  it('transforma estado en paréntesis tras código de OT', () => {
    const input = `Esa OT ya estaba creada: **OT-IA-20261119-001** (Pendiente) para Chancador.`;

    const result = formatOtBadges(input);

    expect(result).toContain('bg-media-suave text-media');
    expect(result).toContain('Pendiente');
  });

  it('transforma celdas de Estado y Prioridad en tablas markdown', () => {
    const input = `| N° OT | Estado | Prioridad | Fecha de creación |
|---|---|---|---|
| OT-001 | Pendiente | Media | 2026-11-19 |
| OT-002 | in_progress | urgent | 2026-11-19 |
| OT-003 | Cerrada | Baja | 2026-11-19 |`;

    const result = formatOtBadges(input);

    // Fila 1: Pendiente (media-suave), Media (accion-suave)
    expect(result).toContain('bg-media-suave text-media');
    expect(result).toContain('bg-accion-suave text-accion');
    // Fila 2: in_progress (accion-suave), urgent (peligro-suave)
    expect(result).toContain('bg-peligro-suave text-peligro');
    // Fila 3: Cerrada (ok-suave), Baja (superficie-2 text-tinta)
    expect(result).toContain('bg-ok-suave text-ok');
    expect(result).toContain('bg-superficie-2 text-tinta');
  });

  it('no altera texto que no contenga estados ni prioridades de OT', () => {
    const input = `El compresor opera a media carga durante la jornada normal.`;
    const result = formatOtBadges(input);
    expect(result).toBe(input);
  });
});

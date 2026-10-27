import { WorkOrder } from '../models';
import { OtLiveSimulatorService } from './ot-live-simulator.service';

class FixedRandomSimulator extends OtLiveSimulatorService {
  value = 0;
  protected override random(): number {
    return this.value;
  }
}

function order(numero: string, estado: WorkOrder['estado']): WorkOrder {
  return { id: numero, numero_ot: numero, ot_id: 1, estado, status: estado, allowed_transitions: [] } as unknown as WorkOrder;
}

describe('OtLiveSimulatorService', () => {
  let sim: FixedRandomSimulator;

  beforeEach(() => {
    vi.useFakeTimers();
    sim = new FixedRandomSimulator();
  });

  afterEach(() => {
    sim.stop();
    vi.useRealTimers();
  });

  it('avanza una OT pendiente a en curso y recalcula las transiciones', () => {
    const emitted: WorkOrder[] = [];
    sim.changes.subscribe(ot => emitted.push(ot));
    sim.start(() => [order('OT-1', 'pending')]);

    vi.advanceTimersByTime(8_000);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ numero_ot: 'OT-1', estado: 'in_progress', status: 'In Progress' });
    expect(emitted[0].allowed_transitions).toEqual(['completed', 'cancelled']);
    expect(emitted[0].fecha_inicio).toBeTruthy();
  });

  it('cierra una OT en curso y la deja sin transiciones; con random bajo la cancela', () => {
    const emitted: WorkOrder[] = [];
    sim.changes.subscribe(ot => emitted.push(ot));

    sim.value = 0.5;
    sim.start(() => [order('OT-1', 'in_progress')]);
    vi.advanceTimersByTime(12_000);
    expect(emitted[0]).toMatchObject({ estado: 'completed', allowed_transitions: [] });

    sim.value = 0.05;
    sim.start(() => [order('OT-2', 'in_progress')]);
    vi.advanceTimersByTime(9_000);
    expect(emitted[1]).toMatchObject({ numero_ot: 'OT-2', estado: 'cancelled' });
  });

  it('no toca OTs en estado final', () => {
    const emitted: WorkOrder[] = [];
    sim.changes.subscribe(ot => emitted.push(ot));
    sim.start(() => [order('OT-1', 'completed'), order('OT-2', 'cancelled')]);

    vi.advanceTimersByTime(30_000);

    expect(emitted).toHaveLength(0);
  });

  it('entra en reconectando a los 60 s, no emite y vuelve a conectado', () => {
    const emitted: WorkOrder[] = [];
    sim.changes.subscribe(ot => emitted.push(ot));
    sim.value = 0;
    sim.start(() => [order('OT-1', 'pending')]);

    vi.advanceTimersByTime(60_000);
    expect(sim.connection()).toBe('reconnecting');
    const before = emitted.length;

    vi.advanceTimersByTime(2_000);
    expect(emitted.length).toBe(before);

    vi.advanceTimersByTime(2_000);
    expect(sim.connection()).toBe('connected');
  });

  it('stop() cancela los timers y deja el estado conectado', () => {
    const emitted: WorkOrder[] = [];
    sim.changes.subscribe(ot => emitted.push(ot));
    sim.start(() => [order('OT-1', 'pending')]);

    sim.stop();
    vi.advanceTimersByTime(120_000);

    expect(emitted).toHaveLength(0);
    expect(sim.connection()).toBe('connected');
  });
});

export interface Financials {
  ahorro_generado: number;
  mttr: number;
  efficiency: number;
  costo_total_acumulado: number;
  mtbfHours: number | null;
}

export interface TrendData {
  date: string;
  abiertas: number;
  cerradas: number;
}

export interface MachineData {
  id: string;
  name: string;
  total: number;
}

export interface FinancialStats {
  financials: Financials;
  trend14Days: TrendData[];
  machines: MachineData[];
}

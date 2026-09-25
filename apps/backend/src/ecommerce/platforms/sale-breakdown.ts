// Desglose de una venta importada desde un marketplace, común a todos los adaptadores.
// - `charges`: lo que se guarda en Sale (discount/shippingCost/marketplaceFee/taxes/netAmount).
// - `breakdown`: líneas con signo (+ ingreso, − costo) que suman exactamente `netAmount`,
//   para mostrarlas en el modal de importación.
// - `chargeDetail`: cada cargo tal como lo entrega la API (código original), solo informativo.
export interface SaleCharges {
  shippingCost: number;
  marketplaceFee: number | null;
  taxes: number | null;
  discount: number;
  netAmount: number;
}

export interface ChargeDetailRow {
  type: string;
  name: string;
  amount: number;
  tax: number;
}

export interface SaleBreakdown {
  charges: SaleCharges;
  breakdown: { label: string; amount: number }[];
  chargeDetail: ChargeDetailRow[];
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

// Agrupa filas por tipo + nombre sumando montos (una orden repite los mismos cargos por línea/unidad).
export function groupChargeRows(rows: ChargeDetailRow[]): ChargeDetailRow[] {
  const map = new Map<string, ChargeDetailRow>();
  for (const r of rows) {
    const key = `${r.type}|${r.name}`;
    const cur = map.get(key) || { type: r.type, name: r.name, amount: 0, tax: 0 };
    cur.amount = round2(cur.amount + r.amount);
    cur.tax = round2(cur.tax + r.tax);
    map.set(key, cur);
  }
  return Array.from(map.values());
}

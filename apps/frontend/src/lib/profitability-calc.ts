// Fórmulas del comparador de rentabilidad. Mismos supuestos en todo el módulo:
// costo y precio de venta vienen CON IVA incluido; el crédito fiscal se calcula
// sobre el costo porque se compra con factura.
export const IVA = 0.19;
export const COMISION = 0.068; // Shopify + Mercado Pago

export interface ProfitCalc {
  ganancia: number | null;
  margen: number | null;
}

// p = mi precio de venta (con IVA), c = mi costo (con IVA). Si falta alguno, no
// hay cálculo posible: "sin precio".
export function calcProfit(p: number | null, c: number | null): ProfitCalc {
  if (p == null || c == null) return { ganancia: null, margen: null };
  const netoVenta = p / (1 + IVA);
  const ivaDebito = p - netoVenta;
  const ivaCredito = c - c / (1 + IVA);
  const ivaAPagar = ivaDebito - ivaCredito;
  const comision = p * COMISION;
  const ganancia = p - c - ivaAPagar - comision;
  const margen = netoVenta > 0 ? (ganancia / netoVenta) * 100 : null;
  return { ganancia: Math.round(ganancia), margen };
}

export type Veredicto = 'PUBLICITAR' | 'SUBIR' | 'MARGEN BAJO' | 'NO SUBIR' | 'SIN PRECIO';

export function calcVeredicto(ganancia: number | null): Veredicto {
  if (ganancia == null) return 'SIN PRECIO';
  if (ganancia >= 15000) return 'PUBLICITAR';
  if (ganancia >= 8000) return 'SUBIR';
  if (ganancia >= 3000) return 'MARGEN BAJO';
  return 'NO SUBIR';
}

export const VEREDICTO_STYLES: Record<Veredicto, string> = {
  'PUBLICITAR': 'bg-emerald-600 text-white',
  'SUBIR': 'bg-emerald-100 text-emerald-700',
  'MARGEN BAJO': 'bg-amber-100 text-amber-700',
  'NO SUBIR': 'bg-red-100 text-red-700',
  'SIN PRECIO': 'bg-gray-100 text-gray-500',
};

// Precio propio efectivo mostrado en pantalla: el fijado a mano tiene prioridad;
// si no, se sugiere (precio competencia - 1000).
export function effectiveMyPrice(item: { myPrice: number | null; manualPrice: boolean; competitorPrice: number | null }): number | null {
  if (item.manualPrice && item.myPrice != null) return item.myPrice;
  if (item.competitorPrice != null) return item.competitorPrice - 1000;
  return item.myPrice;
}

export function formatCLP(value: number | null | undefined): string {
  if (value == null) return '—';
  return value.toLocaleString('es-CL', { maximumFractionDigits: 0 });
}

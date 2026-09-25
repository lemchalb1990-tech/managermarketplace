// Desglose de una venta importada desde un marketplace, común a todos los adaptadores.
// Todo se expresa SIN IVA: el IVA que paga el comprador va al fisco y el de la comisión es
// crédito fiscal, así que el neto sin IVA es lo que realmente se gana antes del costo.
// Cada adaptador arma una LineCalc por producto (misma agrupación y orden que los items que
// resuelve contra el catálogo) y `buildBreakdown` calcula netos, totales y ganancia.

export const IVA_RATE = 0.19;
export const round2 = (n: number) => Math.round(n * 100) / 100;
export const sinIva = (n: number) => round2(n / (1 + IVA_RATE));

export interface SaleCharges {
  shippingCost: number;          // sin IVA; positivo = costo del vendedor, negativo = ingreso
  marketplaceFee: number | null; // sin IVA; null si la API no la informa y no hay % configurado
  taxes: number | null;          // IVA débito incluido en lo cobrado al comprador
  discount: number;              // sin IVA
  netAmount: number;             // sin IVA
}

export interface ChargeDetailRow {
  type: string;
  name: string;
  amount: number;
  tax: number;
}

export interface LineCalc {
  title: string;
  quantity: number;
  revenue: number;           // venta del producto sin IVA, ya descontadas promociones
  discount: number;          // descuento/promoción sin IVA (informativo, ya restado de revenue)
  gross: number;             // lo cobrado por el producto CON IVA (base del % de comisión estimado)
  commission: number | null; // sin IVA; null si la API no la informa
  shipping: number;          // sin IVA; + cobrado al comprador a favor del vendedor, − costo del vendedor
  tax: number;               // IVA incluido en lo cobrado (producto + envío a favor)
  cancelled: boolean;        // cancelado/devuelto/reembolsado completo: no suma al neto
}

export interface SaleLine extends LineCalc {
  commissionEstimated: boolean;
  net: number;
  cost: number | null;   // costo sin IVA (Product.cost viene con IVA) × cantidad
  profit: number | null; // net − cost
}

export interface SaleBreakdown {
  charges: SaleCharges;
  breakdown: { label: string; amount: number }[];
  chargeDetail: ChargeDetailRow[];
  lines: SaleLine[];
  commissionEstimated: boolean;
  cost: number | null;
  profit: number | null;
}

// % de comisión configurado en la conexión (campo opcional "commissionRate" de las credenciales).
// Se usa solo cuando la API no informa la comisión o la entrega en 0 (Walmart, Paris, Falabella).
export function commissionRateOf(conn: any): number | null {
  const raw = conn?.credentials?.commissionRate;
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace('%', '').replace(',', '.').trim());
  return Number.isFinite(n) && n > 0 && n < 100 ? n : null;
}

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

export function buildBreakdown(opts: {
  lines: LineCalc[];
  unitCosts: (number | null | undefined)[]; // Product.cost (con IVA) de cada línea, mismo orden
  commissionRate: number | null;
  chargeDetail: ChargeDetailRow[];
  platform: string;
  shippingLabel: string;
}): SaleBreakdown {
  const { lines, unitCosts, commissionRate, chargeDetail, platform, shippingLabel } = opts;
  const active = lines.filter((l) => !l.cancelled);
  const apiCommission = active.reduce((s, l) => s + (l.commission ?? 0), 0);
  const noApiCommission = active.every((l) => l.commission == null) || apiCommission === 0;
  const estimate = commissionRate != null && noApiCommission;

  const out: SaleLine[] = lines.map((l, i) => {
    if (l.cancelled) {
      return { ...l, commissionEstimated: false, net: 0, cost: null, profit: null };
    }
    const commission = estimate ? round2(l.gross * commissionRate! / 100) : l.commission;
    const net = round2(l.revenue + l.shipping - (commission ?? 0));
    const unitCost = Number(unitCosts[i] ?? 0);
    const cost = unitCost > 0 ? round2(sinIva(unitCost) * l.quantity) : null;
    return { ...l, commission, commissionEstimated: estimate, net, cost, profit: cost != null ? round2(net - cost) : null };
  });

  const act = out.filter((l) => !l.cancelled);
  const sum = (f: (l: SaleLine) => number) => round2(act.reduce((s, l) => s + f(l), 0));
  const revenue = sum((l) => l.revenue);
  const discount = sum((l) => l.discount);
  const shipping = sum((l) => l.shipping);
  const commissionKnown = act.some((l) => l.commission != null);
  const commission = sum((l) => l.commission ?? 0);
  const taxes = sum((l) => l.tax);
  const netAmount = round2(revenue + shipping - commission);
  const allCosts = act.length > 0 && act.every((l) => l.cost != null);
  const cost = allCosts ? sum((l) => l.cost!) : null;

  const commissionLabel = estimate
    ? `Comisión ${platform} (estimada ${commissionRate}%)`
    : commissionKnown
      ? `Comisión ${platform}`
      : `Comisión ${platform} (la API no la informa — configura el % en la conexión)`;
  const cancelledCount = out.filter((l) => l.cancelled).length;

  return {
    charges: {
      shippingCost: round2(-shipping),
      marketplaceFee: commissionKnown ? commission : null,
      taxes,
      discount,
      netAmount,
    },
    breakdown: [
      { label: 'Precio de lista sin IVA', amount: round2(revenue + discount) },
      { label: 'Descuento/Promoción', amount: -discount },
      { label: shippingLabel, amount: shipping },
      { label: commissionLabel, amount: -commission },
      ...(cancelledCount ? [{ label: `${cancelledCount} producto(s) cancelado(s)/devuelto(s) excluido(s)`, amount: 0 }] : []),
    ],
    chargeDetail,
    lines: out,
    commissionEstimated: estimate,
    cost,
    profit: cost != null ? round2(netAmount - cost) : null,
  };
}

// Actualiza una venta ya importada con el desglose recalculado: cargos del Sale y neto de cada
// SaleItem. Las líneas se asocian a los items por producto; si un producto aparece en más de
// un item (Walmart puede repetir el SKU en varias líneas) el neto se reparte por cantidad.
export async function backfillSale(prisma: any, saleId: string, b: SaleBreakdown, productIds: (string | null)[]) {
  await prisma.sale.update({ where: { id: saleId }, data: b.charges });
  const byProduct = new Map<string, { net: number; qty: number }>();
  b.lines.forEach((l, i) => {
    const pid = productIds[i];
    if (!pid) return;
    const cur = byProduct.get(pid) || { net: 0, qty: 0 };
    cur.net += l.net;
    cur.qty += l.quantity;
    byProduct.set(pid, cur);
  });
  const items = await prisma.saleItem.findMany({ where: { saleId }, select: { id: true, productId: true, quantity: true } });
  for (const it of items) {
    const g = byProduct.get(it.productId);
    if (!g || !g.qty) continue;
    await prisma.saleItem.update({ where: { id: it.id }, data: { netAmount: round2((g.net * it.quantity) / g.qty) } });
  }
}

// Forma común de cada producto en la vista previa de importación.
export function previewItems(
  items: Array<{ productId: string | null; quantity: number; unitPrice: number; title: string; productName: string | null }>,
  b: SaleBreakdown,
) {
  return items.map((i, idx) => {
    const l = b.lines[idx];
    return {
      title: i.title, quantity: i.quantity, unitPrice: i.unitPrice, resolved: !!i.productId, productName: i.productName,
      ...(l ? {
        revenue: l.revenue, discount: l.discount, commission: l.commission, commissionEstimated: l.commissionEstimated,
        shipping: l.shipping, net: l.net, cost: l.cost, profit: l.profit, cancelled: l.cancelled,
      } : {}),
    };
  });
}

// Stock de un conjunto de productos en UNA bodega. Un producto que todavía no tiene stock por
// bodega (creado antes del motor de inventario o importado) tiene todo su stock en su bodega
// (o la por defecto de la empresa, la primera activa) — mismo criterio que StockLedgerService.seedIfEmpty.
export async function warehouseStockFor(
  prisma: any,
  companyId: string,
  warehouseId: string,
  products: { id: string; stock: number; warehouseId: string | null }[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!products.length) return out;
  const rows: { productId: string; warehouseId: string; quantity: number }[] = await prisma.productStock.findMany({
    where: { productId: { in: products.map((p) => p.id) } },
    select: { productId: true, warehouseId: true, quantity: true },
  });
  const seeded = new Set(rows.map((r) => r.productId));
  for (const r of rows) if (r.warehouseId === warehouseId) out.set(r.productId, r.quantity);

  let defaultId: string | null | undefined;
  for (const p of products) {
    if (seeded.has(p.id)) {
      if (!out.has(p.id)) out.set(p.id, 0);
      continue;
    }
    if (!p.warehouseId && defaultId === undefined) {
      const wh = await prisma.warehouse.findFirst({ where: { companyId, active: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      defaultId = wh?.id ?? null;
    }
    out.set(p.id, (p.warehouseId || defaultId) === warehouseId ? Math.max(0, p.stock) : 0);
  }
  return out;
}

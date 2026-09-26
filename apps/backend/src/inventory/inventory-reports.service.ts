import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { MovementType, Prisma, ProductType, Role, TransferStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockLedgerService } from '../purchases/stock-ledger.service';
import { SyncService } from '../ecommerce/sync/sync.service';
import { SettingsService } from '../settings/settings.service';
import { startOfDayInTz, endOfDayInTz } from '../common/timezone';
import { InventoryAdjustDto, ReconcileDto } from './dto/inventory.dto';

export interface AvailabilityQuery {
  companyId?: string; warehouseId?: string; search?: string; category?: string;
  onlyStock?: string; belowCritical?: string; at?: string; page?: string; pageSize?: string;
}

export interface MovementsQuery {
  companyId?: string; productId?: string; warehouseId?: string; search?: string; type?: string;
  document?: string; from?: string; to?: string; page?: string;
}

const MOVEMENT_LABELS: Record<MovementType, string> = {
  SALE: 'Venta', RETURN: 'Devolución', ADJUSTMENT: 'Ajuste', INITIAL: 'Saldo inicial',
  PURCHASE: 'Compra', TRANSFER_OUT: 'Traspaso (salida)', TRANSFER_IN: 'Traspaso (entrada)',
};

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

@Injectable()
export class InventoryReportsService {
  constructor(
    private prisma: PrismaService,
    private ledger: StockLedgerService,
    private sync: SyncService,
    private settings: SettingsService,
  ) {}

  resolveCompanyId(user: any, companyId?: string): string {
    if (user.role === Role.SUPER_ADMIN) {
      if (!companyId) throw new BadRequestException('companyId requerido para Super Admin');
      return companyId;
    }
    if (!user.companyId) throw new ForbiddenException('Sin empresa asignada');
    return user.companyId;
  }

  // Cuadratura masiva: productos con stock que todavía no lo tienen repartido por bodega
  // quedan con todo su stock en su bodega asignada (o la por defecto), con movimiento de
  // saldo inicial. En bloque (2 consultas) para no demorar el primer reporte con miles de productos.
  async ensureCompanySeeded(companyId: string) {
    const pending = await this.prisma.product.findMany({
      where: { companyId, type: ProductType.ARTICULO, dropship: false, stock: { gt: 0 }, productStocks: { none: {} } },
      select: { id: true, stock: true, warehouseId: true },
    });
    if (!pending.length) return 0;
    await this.prisma.$transaction(async (tx) => {
      const fallback = await this.ledger.defaultWarehouseId(tx, companyId);
      const validIds = new Set((await tx.warehouse.findMany({ where: { companyId }, select: { id: true } })).map((w) => w.id));
      const rows = pending.map((p) => ({ productId: p.id, warehouseId: p.warehouseId && validIds.has(p.warehouseId) ? p.warehouseId : fallback, quantity: p.stock }));
      await tx.productStock.createMany({ data: rows, skipDuplicates: true });
      await tx.stockMovement.createMany({
        data: rows.map((r) => ({
          type: MovementType.INITIAL, quantity: r.quantity, reason: 'Saldo inicial por bodega',
          productId: r.productId, warehouseId: r.warehouseId, balanceAfter: r.quantity, referenceType: 'INITIAL',
        })),
      });
    }, { timeout: 60000 });
    return pending.length;
  }

  private productWhere(companyId: string, q: AvailabilityQuery): Prisma.ProductWhereInput {
    const where: Prisma.ProductWhereInput = { companyId, type: ProductType.ARTICULO, dropship: false, active: true };
    const term = q.search?.trim();
    if (term) where.OR = [{ name: { contains: term, mode: 'insensitive' } }, { sku: { contains: term, mode: 'insensitive' } }];
    if (q.category) where.category = q.category;
    const and: Prisma.ProductWhereInput[] = [];
    if (q.warehouseId && q.onlyStock === 'true') and.push({ productStocks: { some: { warehouseId: q.warehouseId, quantity: { gt: 0 } } } });
    else if (q.onlyStock === 'true') and.push({ stock: { gt: 0 } });
    if (q.belowCritical === 'true') and.push({ stock: { lte: this.prisma.product.fields.criticalStock } });
    if (and.length) where.AND = and;
    return where;
  }

  async availability(user: any, q: AvailabilityQuery) {
    const companyId = this.resolveCompanyId(user, q.companyId);
    await this.ensureCompanySeeded(companyId);

    const where = this.productWhere(companyId, q);
    const page = Math.max(1, parseInt(q.page || '1') || 1);
    const take = Math.min(200, Math.max(10, parseInt(q.pageSize || '50') || 50));

    const [warehouses, total, products, categories, summary, transit] = await Promise.all([
      this.prisma.warehouse.findMany({ where: { companyId }, select: { id: true, name: true, active: true }, orderBy: { createdAt: 'asc' } }),
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where, orderBy: { name: 'asc' }, take, skip: (page - 1) * take,
        select: {
          id: true, sku: true, name: true, category: true, cost: true, stock: true, criticalStock: true, warehouseId: true,
          productStocks: { select: { warehouseId: true, quantity: true, reserved: true } },
        },
      }),
      this.prisma.product.findMany({
        where: { companyId, type: ProductType.ARTICULO, category: { not: null } }, distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' },
      }),
      this.prisma.$queryRaw<Array<{ warehouseId: string; units: bigint; skus: bigint; value: number | null }>>`
        SELECT ps."warehouseId", COALESCE(SUM(ps.quantity), 0) AS units,
               COUNT(*) FILTER (WHERE ps.quantity > 0) AS skus,
               COALESCE(SUM(ps.quantity * COALESCE(p.cost, 0)), 0)::float AS value
        FROM product_stock ps JOIN products p ON p.id = ps."productId"
        WHERE p."companyId" = ${companyId} AND p.type = 'ARTICULO' AND p.dropship = false AND p.active = true
        GROUP BY ps."warehouseId"`,
      this.prisma.transferDocumentLine.findMany({
        where: { document: { companyId, status: TransferStatus.IN_TRANSIT } },
        select: { productId: true, quantity: true, document: { select: { toWarehouseId: true } } },
      }),
    ]);

    // Stock a una fecha: existencia actual menos lo movido después de esa fecha, por bodega.
    let atAdjust = new Map<string, number>();
    let atDate: Date | null = null;
    if (q.at) {
      const tz = await this.settings.getTimezone();
      atDate = endOfDayInTz(tz, q.at);
      const after = await this.prisma.stockMovement.groupBy({
        by: ['productId', 'warehouseId'],
        where: { productId: { in: products.map((p) => p.id) }, warehouseId: { not: null }, createdAt: { gt: atDate } },
        _sum: { quantity: true },
      });
      atAdjust = new Map(after.map((a) => [`${a.productId}|${a.warehouseId}`, a._sum.quantity ?? 0]));
    }

    const transitByProduct = new Map<string, Record<string, number>>();
    for (const t of transit) {
      const m = transitByProduct.get(t.productId) || {};
      m[t.document.toWarehouseId] = (m[t.document.toWarehouseId] ?? 0) + t.quantity;
      transitByProduct.set(t.productId, m);
    }

    const rows = products.map((p) => {
      const stock: Record<string, { quantity: number; reserved: number; available: number }> = {};
      for (const s of p.productStocks) {
        const quantity = atDate ? Math.max(0, s.quantity - (atAdjust.get(`${p.id}|${s.warehouseId}`) ?? 0)) : s.quantity;
        stock[s.warehouseId] = { quantity, reserved: atDate ? 0 : s.reserved, available: Math.max(0, quantity - (atDate ? 0 : s.reserved)) };
      }
      const sumWarehouses = p.productStocks.reduce((s, x) => s + x.quantity, 0);
      const inTransitIn = transitByProduct.get(p.id) || {};
      const totalQty = atDate ? Object.values(stock).reduce((s, x) => s + x.quantity, 0) : p.stock;
      return {
        id: p.id, sku: p.sku, name: p.name, category: p.category,
        cost: p.cost != null ? Number(p.cost) : null,
        criticalStock: p.criticalStock,
        total: totalQty,
        stock,
        inTransitIn,
        inTransit: Object.values(inTransitIn).reduce((s, n) => s + n, 0),
        value: p.cost != null ? Math.round(Number(p.cost) * totalQty) : null,
        belowCritical: p.stock <= p.criticalStock,
        mismatch: !atDate && p.productStocks.length > 0 && sumWarehouses !== p.stock,
      };
    });

    const transitTotals: Record<string, number> = {};
    for (const t of transit) transitTotals[t.document.toWarehouseId] = (transitTotals[t.document.toWarehouseId] ?? 0) + t.quantity;

    return {
      warehouses: warehouses.map((w) => {
        const s = summary.find((x) => x.warehouseId === w.id);
        return { ...w, units: Number(s?.units ?? 0), skus: Number(s?.skus ?? 0), value: Math.round(Number(s?.value ?? 0)), inTransitIn: transitTotals[w.id] ?? 0 };
      }),
      categories: categories.map((c) => c.category).filter(Boolean),
      rows, total, page, pages: Math.max(1, Math.ceil(total / take)),
      at: atDate ? q.at : null,
    };
  }

  async availabilityCsv(user: any, q: AvailabilityQuery): Promise<string> {
    const first = await this.availability(user, { ...q, page: '1', pageSize: '200' });
    const all = [...first.rows];
    for (let p = 2; p <= Math.min(first.pages, 100); p++) {
      all.push(...(await this.availability(user, { ...q, page: String(p), pageSize: '200' })).rows);
    }
    const whs = q.warehouseId ? first.warehouses.filter((w) => w.id === q.warehouseId) : first.warehouses;
    const header = ['SKU', 'Producto', 'Categoría', ...whs.flatMap((w) => [`${w.name} - físico`, `${w.name} - reservado`, `${w.name} - disponible`]), 'En tránsito', 'Total', 'Stock crítico', 'Costo unitario', 'Valor'];
    const lines = [header.map(csvCell).join(',')];
    for (const r of all) {
      lines.push([
        r.sku, r.name, r.category ?? '',
        ...whs.flatMap((w) => { const s = r.stock[w.id]; return [s?.quantity ?? 0, s?.reserved ?? 0, s?.available ?? 0]; }),
        r.inTransit, r.total, r.criticalStock, r.cost ?? '', r.value ?? '',
      ].map(csvCell).join(','));
    }
    return '﻿' + lines.join('\n');
  }

  private async movementWhere(companyId: string, q: MovementsQuery): Promise<Prisma.StockMovementWhereInput> {
    const where: Prisma.StockMovementWhereInput = { product: { companyId } };
    if (q.productId) where.productId = q.productId;
    if (q.warehouseId) where.warehouseId = q.warehouseId;
    const types = (q.type || '').split(',').filter((t) => (Object.values(MovementType) as string[]).includes(t)) as MovementType[];
    if (types.length) where.type = { in: types };
    const term = q.search?.trim();
    if (term) where.product = { companyId, OR: [{ name: { contains: term, mode: 'insensitive' } }, { sku: { contains: term, mode: 'insensitive' } }] };
    const doc = q.document?.trim();
    if (doc) where.OR = [{ documentNumber: { contains: doc, mode: 'insensitive' } }, { reason: { contains: doc, mode: 'insensitive' } }];
    if (q.from || q.to) {
      const tz = await this.settings.getTimezone();
      where.createdAt = {
        ...(q.from ? { gte: startOfDayInTz(tz, q.from) } : {}),
        ...(q.to ? { lte: endOfDayInTz(tz, q.to) } : {}),
      };
    }
    return where;
  }

  async movements(user: any, q: MovementsQuery, take = 50) {
    const companyId = this.resolveCompanyId(user, q.companyId);
    const where = await this.movementWhere(companyId, q);
    const page = Math.max(1, parseInt(q.page || '1') || 1);
    const [items, total, totals] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take, skip: (page - 1) * take,
        include: {
          product: { select: { id: true, sku: true, name: true } },
          warehouse: { select: { id: true, name: true } },
          user: { select: { id: true, name: true } },
          saleItem: { select: { saleId: true, sale: { select: { channel: true, externalId: true } } } },
        },
      }),
      this.prisma.stockMovement.count({ where }),
      this.prisma.stockMovement.groupBy({ by: ['type'], where, _sum: { quantity: true }, _count: { _all: true } }),
    ]);
    const entries = totals.reduce((s, t) => s + Math.max(0, t._sum.quantity ?? 0), 0);
    return {
      items: items.map((m) => ({
        id: m.id, createdAt: m.createdAt, type: m.type, typeLabel: MOVEMENT_LABELS[m.type],
        quantity: m.quantity, in: m.quantity > 0 ? m.quantity : 0, out: m.quantity < 0 ? -m.quantity : 0,
        balanceAfter: m.balanceAfter, reason: m.reason,
        unitCost: m.unitCost != null ? Number(m.unitCost) : null,
        referenceType: m.referenceType, referenceId: m.referenceId,
        documentNumber: m.documentNumber
          || (m.saleItem?.sale?.externalId ? `${m.saleItem.sale.channel} ${m.saleItem.sale.externalId}` : null)
          || (m.saleItem ? `Venta #${m.saleItem.saleId.slice(-6).toUpperCase()}` : null),
        product: m.product, warehouse: m.warehouse, user: m.user,
      })),
      total, page, pages: Math.max(1, Math.ceil(total / take)),
      summary: {
        entries,
        exits: totals.reduce((s, t) => s + Math.max(0, -(t._sum.quantity ?? 0)), 0),
        byType: Object.fromEntries(totals.map((t) => [t.type, t._count._all])),
      },
    };
  }

  async movementsCsv(user: any, q: MovementsQuery): Promise<string> {
    const lines = [['Fecha', 'Tipo', 'Documento', 'SKU', 'Producto', 'Bodega', 'Entrada', 'Salida', 'Saldo bodega', 'Costo unitario', 'Usuario', 'Motivo'].map(csvCell).join(',')];
    const tz = await this.settings.getTimezone();
    const fmt = new Intl.DateTimeFormat('es-CL', { timeZone: tz, dateStyle: 'short', timeStyle: 'medium' });
    for (let page = 1; page <= 100; page++) {
      const res = await this.movements(user, { ...q, page: String(page) }, 500);
      for (const m of res.items) {
        lines.push([
          fmt.format(m.createdAt), m.typeLabel, m.documentNumber ?? '', m.product.sku, m.product.name, m.warehouse?.name ?? 'Sin bodega',
          m.in || '', m.out || '', m.balanceAfter ?? '', m.unitCost ?? '', m.user?.name ?? '', m.reason ?? '',
        ].map(csvCell).join(','));
      }
      if (page >= res.pages) break;
    }
    return '﻿' + lines.join('\n');
  }

  async adjust(user: any, dto: InventoryAdjustDto) {
    const companyId = this.resolveCompanyId(user, dto.companyId);
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product || product.companyId !== companyId) throw new NotFoundException('Producto no encontrado');
    if (product.type === ProductType.SERVICIO) throw new BadRequestException('Un servicio no tiene stock');
    const wh = await this.prisma.warehouse.findUnique({ where: { id: dto.warehouseId } });
    if (!wh || wh.companyId !== companyId) throw new BadRequestException('Bodega inválida');

    const result = await this.prisma.$transaction(async (tx) => {
      await this.ledger.seedIfEmpty(tx, product, await this.ledger.resolveWarehouseId(tx, product), user.id);
      const row = await tx.productStock.findUnique({ where: { productId_warehouseId: { productId: product.id, warehouseId: wh.id } } });
      const current = row?.quantity ?? 0;
      const delta = dto.mode === 'SET' ? dto.quantity - current : dto.quantity;
      if (dto.mode === 'SET' && dto.quantity < 0) throw new BadRequestException('La cantidad no puede ser negativa');
      if (current + delta < 0) throw new BadRequestException(`La bodega quedaría en negativo (tiene ${current})`);
      if (delta === 0) return { productStock: product.stock, balanceAfter: current, delta };
      const moved = await this.ledger.move(tx, {
        productId: product.id, warehouseId: wh.id, delta, type: MovementType.ADJUSTMENT,
        reason: dto.reason.trim(), userId: user.id, reference: { type: 'ADJUSTMENT' },
      });
      return { ...moved, delta };
    });
    if (result.delta !== 0) this.sync.syncProduct(product.id, result.productStock).catch(() => {});
    return result;
  }

  // Productos cuyo total no coincide con la suma de sus bodegas.
  async reconciliation(user: any, companyIdParam?: string) {
    const companyId = this.resolveCompanyId(user, companyIdParam);
    await this.ensureCompanySeeded(companyId);
    const rows = await this.prisma.$queryRaw<Array<{ id: string; sku: string; name: string; stock: number; warehouses_sum: bigint; rows_count: bigint }>>`
      SELECT p.id, p.sku, p.name, p.stock, COALESCE(SUM(ps.quantity), 0) AS warehouses_sum, COUNT(ps.id) AS rows_count
      FROM products p LEFT JOIN product_stock ps ON ps."productId" = p.id
      WHERE p."companyId" = ${companyId} AND p.type = 'ARTICULO' AND p.dropship = false
      GROUP BY p.id
      HAVING COALESCE(SUM(ps.quantity), 0) <> p.stock
      ORDER BY p.name
      LIMIT 500`;
    return rows.map((r) => ({ id: r.id, sku: r.sku, name: r.name, total: r.stock, warehousesSum: Number(r.warehouses_sum), difference: r.stock - Number(r.warehouses_sum) }));
  }

  // Corrige los descuadres llevando las bodegas al total publicado (el total es lo que los
  // canales venden, por eso se toma como verdad): la diferencia positiva entra a la bodega
  // del producto; la negativa sale de las bodegas con más stock. Queda como ajuste en el kardex.
  async reconcile(user: any, dto: ReconcileDto) {
    const companyId = this.resolveCompanyId(user, dto.companyId);
    let mismatches = await this.reconciliation(user, companyId);
    if (dto.productIds?.length) mismatches = mismatches.filter((m) => dto.productIds!.includes(m.id));
    let fixed = 0;
    for (const m of mismatches) {
      await this.prisma.$transaction(async (tx) => {
        const product = await tx.product.findUnique({ where: { id: m.id }, select: { id: true, companyId: true, warehouseId: true, stock: true } });
        if (!product) return;
        const rows = await tx.productStock.findMany({ where: { productId: m.id }, orderBy: { quantity: 'desc' } });
        let diff = product.stock - rows.reduce((s, r) => s + r.quantity, 0);
        const base = { productId: m.id, type: MovementType.ADJUSTMENT, reason: 'Cuadratura: bodegas ajustadas al stock total', userId: user.id, touchTotal: false, reference: { type: 'ADJUSTMENT' as const } };
        if (diff > 0) {
          await this.ledger.move(tx, { ...base, warehouseId: await this.ledger.resolveWarehouseId(tx, product), delta: diff });
        } else {
          for (const r of rows) {
            if (diff >= 0) break;
            const take = Math.min(r.quantity, -diff);
            if (take <= 0) continue;
            await this.ledger.move(tx, { ...base, warehouseId: r.warehouseId, delta: -take });
            diff += take;
          }
        }
      });
      fixed++;
    }
    return { fixed };
  }
}

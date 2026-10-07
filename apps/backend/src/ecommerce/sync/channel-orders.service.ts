import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ActivityService } from '../../activity/activity.service';
import { MarketplaceType, MovementType, OrderEventSource, OrderStatus, Prisma, Role, SaleChannel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryCostingService } from '../../purchases/inventory-costing.service';
import { StockLedgerService } from '../../purchases/stock-ledger.service';
import { SyncService } from './sync.service';
import { ParisAdapter } from '../platforms/paris.adapter';
import { RipleyAdapter } from '../platforms/ripley.adapter';
import { FalabellaAdapter } from '../platforms/falabella.adapter';
import { WalmartAdapter } from '../platforms/walmart.adapter';
import { JumpSellerAdapter } from '../platforms/jumpseller.adapter';
import { ChannelOrderState, CreatedChannelSale, OnSaleCreated } from '../platforms/channel-order';

type Tx = Prisma.TransactionClient;

interface ChannelSalesAdapter {
  confirmSalesImport(conn: any, companyId: string, externalIds: string[], onCreated?: OnSaleCreated): Promise<{ imported: number; skipped: number; errors: string[] }>;
  importRecentSales(conn: any, companyId: string, onCreated?: OnSaleCreated): Promise<{ imported: number; skipped: number; errors: number }>;
  getOrderStates(conn: any, externalIds: string[]): Promise<Map<string, ChannelOrderState>>;
}

// Orden del ciclo de vida: una sincronización nunca hace retroceder la Orden interna.
const RANK: Record<OrderStatus, number> = {
  PENDING: 0, PREPARING: 1, READY: 2, IN_TRANSIT: 3, DELIVERED: 4, CANCELLED: 5,
};

// Ventas nuevas de Walmart, Ripley, Paris, Falabella y JumpSeller: igual que el webhook de Mercado Libre,
// la venta que llega por la importación automática crea su Orden de despacho y descuenta
// stock (el stock nuevo se empuja al resto de los canales). La importación manual desde el
// modal es solo historial, salvo que se pida crear también la Orden (ver confirmSalesImport).
// Después, en cada corrida, trae el estado de las órdenes
// abiertas desde el marketplace y lo deja en la Orden y en su historial de seguimiento.
@Injectable()
export class ChannelOrdersService {
  private readonly logger = new Logger(ChannelOrdersService.name);

  constructor(
    private prisma: PrismaService,
    private costing: InventoryCostingService,
    private ledger: StockLedgerService,
    private sync: SyncService,
    private paris: ParisAdapter,
    private ripley: RipleyAdapter,
    private falabella: FalabellaAdapter,
    private walmart: WalmartAdapter,
    private jumpseller: JumpSellerAdapter,
    private activity: ActivityService,
  ) {}

  private channelOf(marketplace: MarketplaceType): { adapter: ChannelSalesAdapter; channel: SaleChannel; platform: string } | null {
    switch (marketplace) {
      case MarketplaceType.PARIS: return { adapter: this.paris, channel: SaleChannel.PARIS, platform: 'Paris' };
      case MarketplaceType.RIPLEY: return { adapter: this.ripley, channel: SaleChannel.RIPLEY, platform: 'Ripley' };
      case MarketplaceType.FALABELLA: return { adapter: this.falabella, channel: SaleChannel.FALABELLA, platform: 'Falabella' };
      case MarketplaceType.WALMART: return { adapter: this.walmart, channel: SaleChannel.WALMART, platform: 'Walmart' };
      case MarketplaceType.JUMPSELLER: return { adapter: this.jumpseller, channel: SaleChannel.JUMPSELLER, platform: 'JumpSeller' };
      default: return null;
    }
  }

  supports(marketplace: MarketplaceType): boolean {
    return this.channelOf(marketplace) != null;
  }

  async importRecentSales(conn: any) {
    const ch = this.channelOf(conn.marketplace);
    if (!ch) throw new Error(`${conn.marketplace} no soporta importación de ventas`);
    const touched = new Set<string>();
    const result = await ch.adapter.importRecentSales(conn, conn.companyId, (tx, created) =>
      this.createOrderForSale(tx, created, ch.platform, touched));
    await this.pushStock(touched, ch.platform);
    return result;
  }

  // Importación manual desde el modal. Con createOrders, además de la venta crea su Orden
  // (mismo camino que el cron), pero solo descuenta stock si la orden sigue pendiente de
  // despacho en el marketplace: una ya despachada o entregada queda con su Orden en ese
  // estado, sin mover stock, para no descontar algo que salió cuando el sistema no lo sabía.
  async confirmSalesImport(conn: any, externalIds: string[], createOrders: boolean) {
    const ch = this.channelOf(conn.marketplace);
    if (!ch) throw new Error(`${conn.marketplace} no soporta importación de ventas`);
    // Importación como historial: la venta igual queda con su orden de despacho (en el estado
    // que informa el marketplace, también cancelada), pero sin mover stock.
    if (!createOrders) {
      return ch.adapter.confirmSalesImport(conn, conn.companyId, externalIds, (tx, created) =>
        this.createOrderForSale(tx, created, ch.platform, new Set<string>(), false, { keepCancelled: true }));
    }
    const touched = new Set<string>();
    const result = await ch.adapter.confirmSalesImport(conn, conn.companyId, externalIds, (tx, created) =>
      this.createOrderForSale(tx, created, ch.platform, touched, created.state.status === 'PENDING'));
    await this.pushStock(touched, ch.platform);
    return result;
  }

  // Venta importada antes (solo historial) que todavía no tiene Orden: se consulta su estado
  // actual en el marketplace y se crea con la misma regla que la importación manual — descuenta
  // stock solo si sigue pendiente de despacho; si está cancelada no se crea.
  // withoutStock: crea la orden sin descontar stock (también si la venta está cancelada, en estado
  // Cancelada). Se usa para completar ventas importadas como historial.
  async createOrderForExistingSale(saleId: string, user: any, opts: { withoutStock?: boolean } = {}) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: { select: { id: true, productId: true, quantity: true } }, order: { select: { id: true } }, connection: true },
    });
    if (!sale) throw new NotFoundException('Venta no encontrada');
    if (user.role !== Role.SUPER_ADMIN && sale.companyId !== user.companyId) throw new ForbiddenException();
    if (sale.order) throw new BadRequestException('Esta venta ya tiene su orden de despacho');
    const ch = sale.connection ? this.channelOf(sale.connection.marketplace) : null;
    if (!ch || !sale.connection || !sale.externalId) {
      throw new BadRequestException('Solo aplica a ventas importadas desde Walmart, Ripley, Paris, Falabella o JumpSeller');
    }

    const state = (await ch.adapter.getOrderStates(sale.connection, [sale.externalId])).get(sale.externalId);
    if (!state) throw new BadRequestException(`No se encontró la orden #${sale.externalId} en ${ch.platform}`);
    if (state.status === 'CANCELLED' && !opts.withoutStock) {
      throw new BadRequestException(`La orden #${sale.externalId} está cancelada en ${ch.platform}: no se crea orden de despacho`);
    }

    const deductStock = !opts.withoutStock && state.status === 'PENDING';
    const touched = new Set<string>();
    try {
      await this.prisma.$transaction((tx) => this.createOrderForSale(tx, {
        sale, externalId: sale.externalId!, state, cancelledProductIds: [],
        customer: { name: sale.customerName, email: sale.customerEmail, phone: sale.customerPhone, address: sale.address, commune: sale.commune, region: sale.city },
      }, ch.platform, touched, deductStock, { keepCancelled: !!opts.withoutStock, logImport: false }));
    } catch (err: any) {
      // Otra solicitud creó la orden de esta venta al mismo tiempo (Order.saleId es único).
      if (err?.code === 'P2002') throw new BadRequestException('Esta venta ya tiene su orden de despacho');
      throw err;
    }
    await this.pushStock(touched, ch.platform);

    const order = await this.prisma.order.findUnique({ where: { saleId }, select: { id: true, status: true } });
    return { ...order, stockDeducted: deductStock, marketplaceStatus: state.label };
  }

  // ─── Orden + stock de una venta nueva ─────────────────────────────────────────

  // keepCancelled: una venta que llegó cancelada igual queda con su orden (Cancelada, sin stock).
  // logImport: false cuando la venta ya existía (solo se le crea la orden).
  private async createOrderForSale(
    tx: Tx, created: CreatedChannelSale, platform: string, touched: Set<string>, deductStock = true,
    opts: { keepCancelled?: boolean; logImport?: boolean } = {},
  ) {
    const { sale, externalId, state } = created;
    if (opts.logImport !== false) this.activity.logImport({
      companyId: sale.companyId, module: 'Ventas', action: 'IMPORTAR', entity: 'sale', entityId: sale.id, entityLabel: externalId,
      summary: `Venta importada de ${platform} n° ${externalId}${state.status === 'CANCELLED' ? ' (llegó cancelada)' : ''}`, href: '/dashboard/sales',
    });
    // Llegó ya cancelada: sin movimiento de stock; la orden solo se crea si se pide (historial).
    if (state.status === 'CANCELLED') {
      if (!opts.keepCancelled) return;
      deductStock = false;
    }

    const cancelled = new Set(created.cancelledProductIds);
    const products = await tx.product.findMany({
      where: { id: { in: sale.items.map((i) => i.productId) } },
      select: { id: true, name: true, sku: true, dropship: true, warehouseId: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const warehouseUnits: Record<string, number> = {};
    for (const item of sale.items) {
      const product = byId.get(item.productId);
      // Dropship: el módulo de dropshipping pide al proveedor, no sale de bodega propia.
      if (!product || product.dropship || cancelled.has(item.productId)) continue;
      if (product.warehouseId) warehouseUnits[product.warehouseId] = (warehouseUnits[product.warehouseId] || 0) + item.quantity;
      if (!deductStock) continue;
      const totalCost = await this.costing.consumeForSale(tx, {
        companyId: sale.companyId,
        productId: item.productId,
        warehouseId: product.warehouseId,
        quantity: item.quantity,
        saleItemId: item.id,
        reason: `Venta ${platform} orden #${externalId}`,
        reference: { type: 'SALE', id: sale.id, number: `${platform} ${externalId}` },
      });
      if (totalCost != null) await tx.saleItem.update({ where: { id: item.id }, data: { totalCost } });
      touched.add(item.productId);
    }
    const warehouseId = Object.entries(warehouseUnits).sort(([, a], [, b]) => b - a)[0]?.[0];

    const status = state.status === 'CANCELLED' ? OrderStatus.CANCELLED
      : state.status === 'DELIVERED' ? OrderStatus.DELIVERED
        : state.status === 'SHIPPED' ? OrderStatus.IN_TRANSIT
          : OrderStatus.PREPARING;
    const order = await tx.order.create({
      data: {
        status,
        customerName: created.customer.name || null,
        customerEmail: created.customer.email || null,
        customerPhone: created.customer.phone || null,
        address: created.customer.address || null,
        commune: created.customer.commune || null,
        region: created.customer.region || null,
        courier: state.courier || null,
        trackingCode: state.trackingCode || null,
        deliveredAt: status === OrderStatus.DELIVERED ? (state.deliveredAt ?? new Date()) : null,
        companyId: sale.companyId,
        saleId: sale.id,
        warehouseId,
        itemChecks: {
          create: sale.items.filter((i) => !cancelled.has(i.productId)).map((i) => ({
            productId: i.productId,
            productName: byId.get(i.productId)?.name || 'Producto',
            productSku: byId.get(i.productId)?.sku || '',
            expectedQty: i.quantity,
          })),
        },
      },
    });

    await tx.orderStatusEvent.create({
      data: {
        orderId: order.id, status, source: OrderEventSource.MARKETPLACE,
        title: `Venta recibida desde ${platform}`,
        detail: deductStock ? `Orden #${externalId}` : `Orden #${externalId} · importada sin descontar stock`,
        occurredAt: new Date(),
      },
    });
    await this.recordExternalState(tx, order.id, state, platform);
  }

  private async pushStock(productIds: Set<string>, platform: string) {
    if (!productIds.size) return;
    const products = await this.prisma.product.findMany({ where: { id: { in: [...productIds] } }, select: { id: true, stock: true } });
    for (const p of products) {
      this.sync.syncProduct(p.id, p.stock).catch((e) =>
        this.logger.error(`Sync otras plataformas tras venta ${platform}: ${e.message}`));
    }
  }

  // ─── Estado de las órdenes abiertas ───────────────────────────────────────────

  // Idempotente: cada estado distinto que informe el marketplace queda una sola vez en el historial.
  private async recordExternalState(client: Tx | PrismaService, orderId: string, state: ChannelOrderState, platform: string, status?: OrderStatus) {
    const externalKey = `${platform}:${state.label}`;
    const detail = [state.courier, state.trackingCode && `Seguimiento ${state.trackingCode}`].filter(Boolean).join(' · ') || null;
    await client.orderStatusEvent.upsert({
      where: { orderId_externalKey: { orderId, externalKey } },
      update: {},
      create: {
        orderId, status, source: OrderEventSource.MARKETPLACE, title: `${platform}: ${state.label}`, detail,
        externalStatus: state.label, externalKey,
        occurredAt: (state.status === 'DELIVERED' && state.deliveredAt) || (state.status === 'SHIPPED' && state.shippedAt) || new Date(),
      },
    });
  }

  // Revisa en el marketplace las órdenes de esta conexión que todavía no llegan a un estado
  // final (últimos 60 días) y refleja su estado. Solo avanza hacia adelante.
  async syncOrderStatuses(conn: any): Promise<{ checked: number; updated: number }> {
    const ch = this.channelOf(conn.marketplace);
    if (!ch) return { checked: 0, updated: 0 };

    const sales = await this.prisma.sale.findMany({
      where: {
        channel: ch.channel,
        connectionId: conn.id,
        createdAt: { gt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
        order: { status: { notIn: [OrderStatus.DELIVERED, OrderStatus.CANCELLED] } },
      },
      select: { id: true, externalId: true, order: true, items: { select: { id: true, productId: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    if (!sales.length) return { checked: 0, updated: 0 };

    const states = await ch.adapter.getOrderStates(conn, sales.map((s) => s.externalId!).filter(Boolean));
    let updated = 0;
    const restocked = new Set<string>();
    for (const sale of sales) {
      const state = sale.externalId ? states.get(sale.externalId) : undefined;
      if (!state || !sale.order) continue;
      try {
        if (await this.applyState(sale, sale.order, state, ch.platform, restocked)) updated++;
      } catch (err: any) {
        this.logger.error(`Estado ${ch.platform} orden ${sale.externalId}: ${err?.message || err}`);
      }
    }
    await this.pushStock(restocked, ch.platform);
    return { checked: sales.length, updated };
  }

  private async applyState(
    sale: { id: string; externalId: string | null; items: { id: string; productId: string }[] },
    order: { id: string; status: OrderStatus; notes: string | null; courier: string | null; trackingCode: string | null },
    state: ChannelOrderState,
    platform: string,
    restocked: Set<string>,
  ): Promise<boolean> {
    const tracking = { courier: state.courier || order.courier, trackingCode: state.trackingCode || order.trackingCode };

    // Cancelada en el marketplace: gana siempre. Si todavía no salía de bodega, el stock vuelve
    // a la bodega de donde se descontó; si ya iba en camino, lo resuelve el flujo de devoluciones.
    if (state.status === 'CANCELLED') {
      const dispatched = RANK[order.status] >= RANK[OrderStatus.IN_TRANSIT];
      const note = dispatched
        ? `⚠️ Cancelada en ${platform} (${new Date().toLocaleString('es-CL')}) cuando ya estaba despachada: registra la devolución si vuelve el producto.`
        : `⚠️ Cancelada en ${platform} (${new Date().toLocaleString('es-CL')}). El stock se repuso en bodega.`;
      await this.prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.CANCELLED, notes: [order.notes, note].filter(Boolean).join('\n') },
        });
        if (!dispatched) {
          for (const productId of await this.restock(tx, sale, platform)) restocked.add(productId);
        }
        await this.recordExternalState(tx, order.id, state, platform, OrderStatus.CANCELLED);
      });
      return true;
    }

    const target = state.status === 'DELIVERED' ? OrderStatus.DELIVERED
      : state.status === 'SHIPPED' ? OrderStatus.IN_TRANSIT
        : null;
    if (target && RANK[target] > RANK[order.status]) {
      await this.prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: target, ...tracking,
            ...(target === OrderStatus.DELIVERED ? { deliveredAt: state.deliveredAt ?? new Date() } : {}),
            ...(target === OrderStatus.IN_TRANSIT ? { dispatchedAt: state.shippedAt ?? new Date() } : {}),
          },
        });
        await this.recordExternalState(tx, order.id, state, platform, target);
      });
      return true;
    }

    // Sin cambio de etapa: igual se deja en el historial si el marketplace informó un estado nuevo.
    await this.recordExternalState(this.prisma, order.id, state, platform);
    return false;
  }

  // Devuelve a cada bodega lo que salió por esta venta (según sus movimientos de venta).
  private async restock(tx: Tx, sale: { id: string; externalId: string | null; items: { id: string; productId: string }[] }, platform: string): Promise<string[]> {
    const moves = await tx.stockMovement.findMany({
      where: { saleItemId: { in: sale.items.map((i) => i.id) }, type: MovementType.SALE },
      select: { productId: true, warehouseId: true, quantity: true },
    });
    const byKey = new Map<string, { productId: string; warehouseId: string | null; quantity: number }>();
    for (const m of moves) {
      const key = `${m.productId}|${m.warehouseId}`;
      const cur = byKey.get(key) || { productId: m.productId, warehouseId: m.warehouseId, quantity: 0 };
      cur.quantity += -m.quantity;
      byKey.set(key, cur);
    }
    const products: string[] = [];
    for (const r of byKey.values()) {
      if (r.quantity <= 0) continue;
      await this.ledger.move(tx, {
        productId: r.productId, warehouseId: r.warehouseId, delta: r.quantity, type: MovementType.RETURN,
        reason: `Venta ${platform} orden #${sale.externalId} cancelada en el marketplace`,
        reference: { type: 'RETURN', id: sale.id, number: `${platform} ${sale.externalId}` },
      });
      products.push(r.productId);
    }
    return products;
  }
}

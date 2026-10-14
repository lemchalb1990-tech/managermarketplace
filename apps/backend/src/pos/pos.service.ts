import { Injectable, BadRequestException, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { FulfillmentType, PaymentMethod, ProductType, Role, SaleChannel, MovementType, WorkOrderPrintFormat } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SyncService } from '../ecommerce/sync/sync.service';
import { EmailService } from '../email/email.service';
import { InventoryCostingService } from '../purchases/inventory-costing.service';
import { StockLedgerService } from '../purchases/stock-ledger.service';
import { SettingsService } from '../settings/settings.service';
import { startOfDayInTz, dateKeyStringInTz, shiftDateKey } from '../common/timezone';
import { CreateSaleDto, StockAdjustDto } from './dto/pos.dto';
import { warehouseStockFor } from '../common/warehouse-stock.util';

const POS_MANAGER_ROLES: Role[] = [Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER];

function isValidSaleChannel(v?: string): v is SaleChannel {
  return !!v && Object.values(SaleChannel).includes(v as SaleChannel);
}

// Canales que nunca tienen (ni tuvieron) una MarketplaceConnection propia — su venta
// siempre nace sin connectionId, así que un connectionId null ahí es normal, no huérfano.
// Cualquier otro canal (MERCADO_LIBRE, SHOPIFY, WALMART, etc.) siempre se crea CON
// connectionId; si aparece en null es porque la conexión que la originó fue desconectada
// (ON DELETE SET NULL) — esa venta queda "huérfana" y no debe mezclarse en ningún canal.
const CONNECTIONLESS_CHANNELS: SaleChannel[] = [SaleChannel.POS, SaleChannel.MANUAL, SaleChannel.ORDER_REQUEST];

@Injectable()
export class PosService {
  private readonly logger = new Logger(PosService.name);

  constructor(
    private prisma: PrismaService,
    private sync: SyncService,
    private email: EmailService,
    private costing: InventoryCostingService,
    private settings: SettingsService,
    private ledger: StockLedgerService,
  ) {}

  private resolveCompanyId(user: any, companyId?: string): string {
    if (user.role === Role.SUPER_ADMIN) {
      if (!companyId) throw new BadRequestException('companyId requerido para Super Admin');
      return companyId;
    }
    if (!user.companyId) throw new ForbiddenException('Sin empresa asignada');
    return user.companyId;
  }

  // ─── Ajustes del POS (por empresa) ────────────────────────────────────────────

  async getSettings(user: any, companyId?: string) {
    const cId = this.resolveCompanyId(user, companyId);
    const company = await this.prisma.company.findUnique({ where: { id: cId }, select: { workOrderPrintFormat: true } });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    // Tiendas/bodegas asignadas al usuario y, para administradores, todas las de la empresa.
    const isManager = POS_MANAGER_ROLES.includes(user.role);
    const [assignedWarehouses, warehouses] = await Promise.all([
      this.assignedWarehouses(user.id, cId),
      isManager
        ? this.prisma.warehouse.findMany({ where: { companyId: cId, active: true }, select: { id: true, name: true }, orderBy: { createdAt: 'asc' } })
        : Promise.resolve([]),
    ]);
    const saleWarehouse = assignedWarehouses[0] ?? null;
    // El formato de ticket es de la empresa (lo define su administrador en Ajustes del sistema →
    // Configuración) y aplica a todos sus usuarios. printFormat = el que se usa al imprimir.
    return {
      workOrderPrintFormat: company.workOrderPrintFormat,
      printFormat: company.workOrderPrintFormat,
      saleWarehouse,
      assignedWarehouses,
      canChooseWarehouse: isManager,
      warehouses,
    };
  }

  async updateSettings(user: any, dto: { workOrderPrintFormat?: WorkOrderPrintFormat }, companyId?: string) {
    const cId = this.resolveCompanyId(user, companyId);
    if (dto.workOrderPrintFormat && !Object.values(WorkOrderPrintFormat).includes(dto.workOrderPrintFormat)) {
      throw new BadRequestException('Formato de impresión no válido');
    }
    return this.prisma.company.update({
      where: { id: cId },
      data: { ...(dto.workOrderPrintFormat ? { workOrderPrintFormat: dto.workOrderPrintFormat } : {}) },
      select: { workOrderPrintFormat: true },
    });
  }

  // Tiendas/bodegas asignadas al usuario en Usuarios (solo las de la empresa y activas).
  private async assignedWarehouses(userId: string, companyId: string): Promise<{ id: string; name: string }[]> {
    const rows = await this.prisma.userPosWarehouse.findMany({
      where: { userId, warehouse: { companyId, active: true } },
      select: { warehouse: { select: { id: true, name: true, createdAt: true } } },
    });
    return rows.map((r) => r.warehouse)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(({ id, name }) => ({ id, name }));
  }

  // Bodega desde la que se vende en el punto de venta:
  // - Administrador: la que elija (cualquiera de la empresa, o '' = la bodega de cada producto).
  // - Vendedor con tiendas asignadas: una de ELLAS (la elegida; con una sola, esa). Nunca otra.
  // - Vendedor sin tiendas asignadas: la bodega de cada producto (como antes).
  async resolveSaleWarehouse(user: any, companyId: string, requested?: string): Promise<{ id: string; name: string } | null> {
    if (POS_MANAGER_ROLES.includes(user.role) && requested !== undefined) {
      if (!requested) return null;
      const wh = await this.prisma.warehouse.findUnique({ where: { id: requested }, select: { id: true, name: true, companyId: true } });
      if (!wh || wh.companyId !== companyId) throw new BadRequestException('Bodega inválida para esta empresa');
      return { id: wh.id, name: wh.name };
    }
    const assigned = await this.assignedWarehouses(user.id, companyId);
    if (!assigned.length) return null;
    if (requested) {
      const match = assigned.find((w) => w.id === requested);
      if (!match) throw new BadRequestException('Solo puedes vender desde las tiendas que tienes asignadas');
      return match;
    }
    if (assigned.length > 1) throw new BadRequestException('Elige desde qué tienda vendes');
    return assigned[0];
  }

  async createSale(dto: CreateSaleDto, user: any, opts: { useSellerWarehouse?: boolean } = { useSellerWarehouse: true }) {
    const companyId = this.resolveCompanyId(user, dto.companyId);
    // Venta directa: se vende (y descuenta) desde la bodega del vendedor. Las órdenes de
    // trabajo convertidas mantienen la bodega de cada producto (ahí reservaron el stock).
    const saleWarehouse = dto.channel === SaleChannel.POS && opts.useSellerWarehouse !== false
      ? await this.resolveSaleWarehouse(user, companyId, dto.warehouseId)
      : null;

    let client: { id: string; name: string; email: string | null; phone: string | null } | null = null;
    if (dto.clientId) {
      const c = await this.prisma.client.findUnique({ where: { id: dto.clientId } });
      if (!c || c.companyId !== companyId) {
        throw new BadRequestException('Cliente no válido para esta empresa');
      }
      client = { id: c.id, name: c.name, email: c.email, phone: c.phone };
    }

    const products = await this.prisma.product.findMany({
      where: { id: { in: dto.items.map(i => i.productId) }, companyId },
    });

    for (const item of dto.items) {
      const product = products.find(p => p.id === item.productId);
      if (!product) throw new BadRequestException(`Producto ${item.productId} no encontrado`);
      if (!product.active) throw new BadRequestException(`El producto "${product.name}" está inactivo`);
      if (product.type !== ProductType.SERVICIO && !product.dropship && product.stock < item.quantity) {
        throw new BadRequestException(`Stock insuficiente para "${product.name}": disponible ${product.stock}, solicitado ${item.quantity}`);
      }
    }

    // Con bodega de venta, el stock tiene que estar en ESA bodega: si no alcanza, se bloquea
    // la venta aunque haya stock en otra.
    if (saleWarehouse) {
      const physical = products.filter((p) => p.type !== ProductType.SERVICIO && !p.dropship);
      const inWarehouse = await warehouseStockFor(this.prisma, companyId, saleWarehouse.id, physical);
      const qtyByProduct = new Map<string, number>();
      for (const i of dto.items) qtyByProduct.set(i.productId, (qtyByProduct.get(i.productId) || 0) + i.quantity);
      for (const p of physical) {
        const available = inWarehouse.get(p.id) ?? 0;
        const wanted = qtyByProduct.get(p.id) || 0;
        if (available < wanted) {
          throw new BadRequestException(`Sin stock suficiente en la bodega "${saleWarehouse.name}" para "${p.name}": disponible ${available}, solicitado ${wanted}`);
        }
      }
    }

    const total = dto.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

    // Medios de pago: con varios, se agrupan por medio y la suma debe cuadrar con el total;
    // con uno solo (o solo paymentMethod), una fila por el total.
    let payments: { method: PaymentMethod; amount: number }[] = [];
    if (dto.payments?.length) {
      const byMethod = new Map<PaymentMethod, number>();
      for (const p of dto.payments) {
        if (p.method === PaymentMethod.MIXED) throw new BadRequestException('Medio de pago no válido');
        if (!(p.amount > 0)) continue;
        byMethod.set(p.method, (byMethod.get(p.method) || 0) + p.amount);
      }
      payments = [...byMethod].map(([method, amount]) => ({ method, amount: Math.round(amount * 100) / 100 }));
      const paid = payments.reduce((s, p) => s + p.amount, 0);
      if (!payments.length || Math.abs(paid - total) > 0.5) {
        throw new BadRequestException(`Los medios de pago suman ${Math.round(paid)} y el total de la venta es ${Math.round(total)}`);
      }
      if (payments.length === 1) payments[0].amount = total;
    } else if (dto.paymentMethod && dto.paymentMethod !== PaymentMethod.MIXED) {
      payments = [{ method: dto.paymentMethod, amount: total }];
    }
    const paymentMethod = payments.length > 1 ? PaymentMethod.MIXED : payments[0]?.method ?? dto.paymentMethod;

    // Auto-detect warehouse from products weighted by quantity
    const warehouseCounts: Record<string, number> = {};
    for (const item of dto.items) {
      const p = products.find(pr => pr.id === item.productId);
      if (p?.warehouseId) {
        warehouseCounts[p.warehouseId] = (warehouseCounts[p.warehouseId] || 0) + item.quantity;
      }
    }
    const autoWarehouseId = Object.entries(warehouseCounts).sort(([, a], [, b]) => b - a)[0]?.[0];

    // Los servicios no se preparan ni despachan: solo se facturan. La orden de pedido lleva
    // únicamente los productos físicos y una venta solo de servicios no tiene forma de despacho.
    const physicalItems = dto.items.filter(i => products.find(pr => pr.id === i.productId)!.type !== ProductType.SERVICIO);
    const fulfillmentType = physicalItems.length > 0 ? dto.fulfillmentType : undefined;

    const sale = await this.prisma.$transaction(async (tx) => {
      const created = await tx.sale.create({
        data: {
          channel: dto.channel,
          externalId: dto.externalId,
          total,
          paymentMethod,
          ...(payments.length ? { payments: { create: payments } } : {}),
          notes: dto.notes,
          customerName: dto.customerName || client?.name,
          customerEmail: dto.customerEmail || client?.email || undefined,
          customerPhone: dto.customerPhone || client?.phone || undefined,
          fulfillmentType,
          address: dto.address,
          commune: dto.commune,
          city: dto.city,
          companyId,
          userId: user.id,
          clientId: client?.id,
          items: {
            create: dto.items.map(i => ({
              productId: i.productId,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
            })),
          },
        },
        include: { items: true },
      });

      for (const item of created.items) {
        const product = products.find(p => p.id === item.productId)!;
        // Servicios y productos dropship no descuentan stock propio: los dropship los
        // despacha el proveedor y el módulo de dropshipping costea sus líneas aparte.
        if (product.type === ProductType.SERVICIO || product.dropship) continue;
        const totalCost = await this.costing.consumeForSale(tx, {
          companyId,
          productId: item.productId,
          warehouseId: saleWarehouse?.id ?? product.warehouseId,
          quantity: item.quantity,
          saleItemId: item.id,
          reason: `Venta ${dto.channel === SaleChannel.POS ? 'POS' : dto.channel}`,
          reference: { type: 'SALE', id: created.id },
          userId: user.id,
        });
        if (totalCost != null) {
          await tx.saleItem.update({ where: { id: item.id }, data: { totalCost } });
        }
      }

      // Auto-create order when fulfillmentType is provided (POS checkout)
      if (fulfillmentType) {
        await tx.order.create({
          data: {
            fulfillmentType,
            customerName: dto.customerName,
            customerEmail: dto.customerEmail,
            customerPhone: dto.customerPhone,
            address: dto.address,
            commune: dto.commune,
            city: dto.city,
            companyId,
            saleId: created.id,
            warehouseId: saleWarehouse?.id || autoWarehouseId || undefined,
            createdById: user.id,
            itemChecks: {
              create: physicalItems.map(i => {
                const p = products.find(pr => pr.id === i.productId)!;
                return {
                  productId: i.productId,
                  productName: p.name,
                  productSku: p.sku,
                  expectedQty: i.quantity,
                };
              }),
            },
          },
        });
      }

      return created;
    });

    const result = await this.prisma.sale.findUnique({
      where: { id: sale.id },
      include: {
        items: { include: { product: { select: { id: true, name: true, sku: true, stock: true } } } },
        user: { select: { id: true, name: true } },
        payments: { select: { method: true, amount: true } },
      },
    });

    for (const item of result!.items) {
      this.sync.syncProduct(item.productId, item.product.stock).catch(() => {});
    }

    if (dto.customerEmail) {
      const receiptItems = result!.items.map(i => ({
        productName: i.product.name,
        quantity: i.quantity,
        unitPrice: Number(i.unitPrice),
      }));
      this.email.sendSaleReceipt({ ...sale, companyId, customerEmail: dto.customerEmail, customerName: dto.customerName, fulfillmentType, address: dto.address, commune: dto.commune, city: dto.city }, receiptItems).catch(e =>
        this.logger.error(`Sale receipt email failed: ${e.message}`),
      );
    }

    return result;
  }

  async getWeeklySales(user: any, companyId?: string, days = 7, channel?: string) {
    const cid = user.role === Role.SUPER_ADMIN ? companyId : user.companyId;
    const tz = await this.settings.getTimezone();
    const todayKey = dateKeyStringInTz(new Date(), tz);

    const from = startOfDayInTz(tz, shiftDateKey(todayKey, -(days - 1)));
    const to = new Date(startOfDayInTz(tz, todayKey).getTime() + 24 * 60 * 60 * 1000);

    const where: any = { createdAt: { gte: from, lt: to } };
    if (cid) where.companyId = cid;
    if (isValidSaleChannel(channel)) where.channel = channel;

    const sales = await this.prisma.sale.findMany({
      where,
      select: { total: true, netAmount: true, channel: true, createdAt: true, connection: { select: { name: true } } },
    });

    const channelLabel: Record<string, string> = {
      POS: 'Punto de Venta', MERCADO_LIBRE: 'Mercado Libre', SHOPIFY: 'Shopify',
      WOOCOMMERCE: 'WooCommerce', JUMPSELLER: 'JumpSeller', FALABELLA: 'Falabella',
      PARIS: 'Paris', HITES: 'Hites', RIPLEY: 'Ripley', WALMART: 'Walmart', MANUAL: 'Manual', ORDER_REQUEST: 'Solicitud de pedido',
    };
    const byStore: Record<string, { label: string; channel: string; count: number; total: number; netReceived: number }> = {};
    for (const s of sales) {
      // Venta de un canal con conexión (ML, Shopify, etc.) cuya cuenta ya se desconectó:
      // se sigue contando en el total del período, pero no en el desglose por canal/tienda
      // — no hay ninguna conexión activa a la que atribuirla. Un Super Admin puede revisar
      // y limpiar estos registros desde Mercado Libre → Registros sin conexión.
      if (!s.connection && !CONNECTIONLESS_CHANNELS.includes(s.channel)) continue;

      const label = s.connection?.name || channelLabel[s.channel] || s.channel;
      const key = `${s.channel}:${label}`;
      if (!byStore[key]) byStore[key] = { label, channel: s.channel, count: 0, total: 0, netReceived: 0 };
      byStore[key].count++;
      byStore[key].total += Number(s.total);
      // Ventas POS/manuales no tienen descuentos de marketplace (netAmount queda null) —
      // ahí el neto recibido es el total completo, igual que en el KPI del dashboard.
      byStore[key].netReceived += s.netAmount != null ? Number(s.netAmount) : Number(s.total);
    }

    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const dayKey = shiftDateKey(todayKey, -i);
      const dayStart = startOfDayInTz(tz, dayKey);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

      const daySales = sales.filter(s => s.createdAt >= dayStart && s.createdAt < dayEnd);
      const posTotal = daySales
        .filter(s => s.channel === SaleChannel.POS)
        .reduce((sum, s) => sum + Number(s.total), 0);
      const ecomTotal = daySales
        .filter(s => s.channel !== SaleChannel.POS)
        .reduce((sum, s) => sum + Number(s.total), 0);

      result.push({
        date: dayKey,
        label: dayStart.toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', timeZone: tz }),
        total: posTotal + ecomTotal,
        count: daySales.length,
        posTotal,
        ecomTotal,
      });
    }

    return {
      days: result,
      byStore: Object.values(byStore).sort((a, b) => b.count - a.count),
    };
  }

  // Ventas mes a mes en una ventana móvil de `months` meses terminando en el mes actual
  // (ej. months=12 y estamos en 2026-09 -> desde 2025-10) — mismo patrón que getWeeklySales
  // pero agrupando por mes en vez de por día.
  // Dashboard: ventas del punto de venta en el período, por medio de pago (sumando cada
  // medio de una venta mixta por separado) y por usuario que la registró.
  async getPosBreakdown(user: any, companyId?: string, opts: { days?: number; months?: number } = {}) {
    const cid = user.role === Role.SUPER_ADMIN ? companyId : user.companyId;
    const tz = await this.settings.getTimezone();
    const todayKey = dateKeyStringInTz(new Date(), tz);
    let from: Date;
    if (opts.months) {
      const [y, m] = todayKey.split('-').map(Number);
      const idx = y * 12 + (m - 1) - (opts.months - 1);
      from = startOfDayInTz(tz, `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`);
    } else {
      from = startOfDayInTz(tz, shiftDateKey(todayKey, -((opts.days || 1) - 1)));
    }
    const where: any = { channel: SaleChannel.POS, createdAt: { gte: from } };
    if (cid) where.companyId = cid;

    const sales = await this.prisma.sale.findMany({
      where,
      select: {
        total: true, paymentMethod: true, userId: true,
        user: { select: { name: true } },
        payments: { select: { method: true, amount: true } },
      },
    });

    const byPayment = new Map<string, { total: number; count: number }>();
    const addPay = (key: string, amount: number) => {
      const e = byPayment.get(key) || { total: 0, count: 0 };
      e.total += amount; e.count++;
      byPayment.set(key, e);
    };
    const byUser = new Map<string, { userId: string | null; name: string; total: number; count: number }>();
    for (const sale of sales) {
      const total = Number(sale.total);
      if (sale.payments.length) {
        for (const p of sale.payments) addPay(p.method, Number(p.amount));
      } else {
        addPay(sale.paymentMethod && sale.paymentMethod !== 'MIXED' ? sale.paymentMethod : 'SIN_ESPECIFICAR', total);
      }
      const key = sale.userId || 'none';
      const u = byUser.get(key) || { userId: sale.userId, name: sale.user?.name || 'Sin usuario', total: 0, count: 0 };
      u.total += total; u.count++;
      byUser.set(key, u);
    }

    return {
      from,
      totalSales: sales.length,
      totalRevenue: sales.reduce((s, v) => s + Number(v.total), 0),
      byPayment: [...byPayment].map(([method, v]) => ({ method, ...v })).sort((a, b) => b.total - a.total),
      byUser: [...byUser.values()].sort((a, b) => b.total - a.total),
    };
  }

  async getMonthlySales(user: any, companyId?: string, months = 12, channel?: string) {
    const cid = user.role === Role.SUPER_ADMIN ? companyId : user.companyId;
    const tz = await this.settings.getTimezone();
    const now = new Date();
    const [currentYear, currentMonth] = dateKeyStringInTz(now, tz).split('-').map(Number);

    // Índice absoluto de mes (año*12 + mes-1) para poder recorrer la ventana sin preocuparse
    // por el cruce de año.
    const currentMonthIdx = currentYear * 12 + (currentMonth - 1);
    const startMonthIdx = currentMonthIdx - (months - 1);
    const monthKey = (idx: number) => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;

    const from = startOfDayInTz(tz, `${monthKey(startMonthIdx)}-01`);
    const where: any = { createdAt: { gte: from, lte: now } };
    if (cid) where.companyId = cid;
    if (isValidSaleChannel(channel)) where.channel = channel;

    const sales = await this.prisma.sale.findMany({
      where,
      select: { total: true, createdAt: true },
    });

    const result = [];
    for (let i = 0; i < months; i++) {
      const idx = startMonthIdx + i;
      const monthStart = startOfDayInTz(tz, `${monthKey(idx)}-01`);
      const monthEnd = startOfDayInTz(tz, `${monthKey(idx + 1)}-01`);

      const monthSales = sales.filter((s) => s.createdAt >= monthStart && s.createdAt < monthEnd);
      const total = monthSales.reduce((sum, s) => sum + Number(s.total), 0);

      result.push({
        month: monthKey(idx),
        label: monthStart.toLocaleDateString('es-CL', { month: 'short', timeZone: tz }),
        total,
        count: monthSales.length,
      });
    }

    return {
      months: result,
      total: result.reduce((s, r) => s + r.total, 0),
      count: result.reduce((s, r) => s + r.count, 0),
    };
  }

  async listSales(user: any, query: { companyId?: string; channel?: SaleChannel; from?: string; to?: string; page?: string; search?: string }) {
    const companyId = user.role === Role.SUPER_ADMIN
      ? query.companyId
      : user.companyId;

    const where: any = {};
    if (companyId) where.companyId = companyId;
    if (query.channel) where.channel = query.channel;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to + 'T23:59:59');
    }
    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        ...(/^\d{1,9}$/.test(term) ? [{ saleNumber: Number(term) }] : []),
        { customerName: { contains: term, mode: 'insensitive' } },
        { items: { some: { product: { name: { contains: term, mode: 'insensitive' } } } } },
        { items: { some: { product: { sku: { contains: term, mode: 'insensitive' } } } } },
        // Número de orden del marketplace, pack (carrito), órdenes fusionadas al pack o envío.
        { externalId: { contains: term, mode: 'insensitive' } },
        { mlPackId: { contains: term } },
        { mlShippingId: { contains: term } },
        { mlMergedOrderIds: { has: term } },
      ];
    }

    const page = Math.max(1, parseInt(query.page || '1'));
    const take = 50;
    const skip = (page - 1) * take;

    const [sales, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        include: {
          items: {
            include: {
              product: {
                select: {
                  id: true, name: true, sku: true, cost: true,
                  images: { select: { url: true, isPrimary: true }, orderBy: { order: 'asc' } },
                },
              },
            },
          },
          user: { select: { id: true, name: true } },
          invoices: { select: { id: true, dteType: true, status: true, folio: true } },
          payments: { select: { method: true, amount: true } },
          connection: { select: { id: true, name: true, marketplace: true } },
          order: { select: { id: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.sale.count({ where }),
    ]);

    // Totales por medio de pago de TODAS las ventas que cumplen los filtros (no solo la página).
    const byPayment = await this.paymentTotals(where);
    return { sales, total, page, pages: Math.ceil(total / take), byPayment };
  }

  // Suma por medio de pago desde el detalle de pagos: una venta mixta suma a cada medio lo suyo.
  // Las ventas sin medio de pago (marketplaces) no entran.
  private async paymentTotals(saleWhere: any) {
    const rows = await this.prisma.salePayment.groupBy({
      by: ['method'],
      where: { sale: saleWhere },
      _sum: { amount: true },
      _count: { _all: true },
    });
    return rows
      .map((r) => ({ method: r.method as string, total: Number(r._sum.amount || 0), count: r._count._all }))
      .sort((a, b) => b.total - a.total);
  }

  async getSale(saleId: string, user: any) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true, name: true, sku: true,
                images: { select: { url: true, isPrimary: true }, orderBy: { order: 'asc' } },
              },
            },
          },
        },
        invoices: { select: { id: true, dteType: true, status: true, folio: true, createdAt: true } },
        client: { select: { id: true, name: true, rut: true, giro: true, email: true, address: true, commune: true } },
        user: { select: { id: true, name: true } },
        connection: { select: { id: true, name: true, marketplace: true } },
        company: { select: { id: true, name: true } },
        payments: { select: { method: true, amount: true } },
        // Orden de la venta: el ticket lleva su código de barras para escanearla en bodega.
        order: { select: { id: true, fulfillmentType: true } },
      },
    });
    if (!sale) throw new NotFoundException('Venta no encontrada');
    if (user.role !== Role.SUPER_ADMIN && sale.companyId !== user.companyId) {
      throw new ForbiddenException();
    }
    return sale;
  }

  async deleteSale(saleId: string, user: any) {
    const sale = await this.prisma.sale.findUnique({ where: { id: saleId } });
    if (!sale) throw new NotFoundException('Venta no encontrada');
    if (user.role !== Role.SUPER_ADMIN && sale.companyId !== user.companyId) {
      throw new ForbiddenException();
    }
    try {
      await this.prisma.sale.delete({ where: { id: saleId } });
    } catch {
      throw new BadRequestException(
        'No se puede eliminar: esta venta tiene movimientos de stock, factura u orden de despacho asociados.',
      );
    }
    return { deleted: true };
  }

  async bulkDeleteSales(ids: string[], user: any) {
    const sales = await this.prisma.sale.findMany({
      where: { id: { in: ids } },
      select: { id: true, companyId: true, externalId: true },
    });
    const owned = sales.filter((s) => user.role === Role.SUPER_ADMIN || s.companyId === user.companyId);

    let deleted = 0;
    const failed: Array<{ id: string; reason: string }> = [];
    for (const s of owned) {
      try {
        await this.prisma.sale.delete({ where: { id: s.id } });
        deleted++;
      } catch {
        failed.push({
          id: s.id,
          reason: 'Tiene movimientos de stock, factura u orden de despacho asociados.',
        });
      }
    }
    return { deleted, failed };
  }

  // Ventas de un canal con conexión (ML, Shopify, etc.) cuya cuenta ya se desconectó — quedan
  // sin connectionId (ON DELETE SET NULL) y por eso no se pueden atribuir a ninguna empresa
  // "conectada" hoy. Solo Super Admin las ve, para poder revisarlas/limpiarlas caso a caso.
  async listOrphanedSales(page?: string, companyId?: string) {
    const where: any = { connectionId: null, channel: { notIn: CONNECTIONLESS_CHANNELS } };
    if (companyId) where.companyId = companyId;
    const p = Math.max(1, parseInt(page || '1'));
    const take = 30;
    const skip = (p - 1) * take;

    const [sales, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        select: {
          id: true, channel: true, externalId: true, total: true, createdAt: true,
          company: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.sale.count({ where }),
    ]);
    return { sales, total, page: p, pages: Math.ceil(total / take) };
  }

  async exportSalesCsv(user: any, query: { companyId?: string; channel?: SaleChannel; from?: string; to?: string }): Promise<string> {
    const companyId = user.role === Role.SUPER_ADMIN ? query.companyId : user.companyId;

    const where: any = {};
    if (companyId) where.companyId = companyId;
    if (query.channel) where.channel = query.channel;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to + 'T23:59:59');
    }

    const sales = await this.prisma.sale.findMany({
      where,
      include: {
        items: { include: { product: { select: { sku: true, name: true } } } },
        connection: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    const CHANNEL_LABEL: Record<string, string> = {
      POS: 'Punto de Venta', MERCADO_LIBRE: 'Mercado Libre', SHOPIFY: 'Shopify',
      WOOCOMMERCE: 'WooCommerce', JUMPSELLER: 'JumpSeller', FALABELLA: 'Falabella',
      PARIS: 'Paris', HITES: 'Hites', RIPLEY: 'Ripley', WALMART: 'Walmart', MANUAL: 'Manual', ORDER_REQUEST: 'Solicitud de pedido',
    };

    const FULFILLMENT_LABEL: Record<string, string> = { PICKUP: 'Retiro en tienda', DELIVERY: 'Entrega a domicilio' };

    const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = [
      'Fecha', 'Canal', 'Cuenta', 'ID Venta', 'ID Externo', 'Comprador', 'Forma de despacho', 'SKU', 'Producto', 'Cantidad', 'Precio unitario', 'Subtotal',
      'Envío', 'Comisión marketplace', 'Impuestos', 'Descuento/Cupón', 'Total neto (sin IVA en Walmart/Ripley/Paris/Falabella/JumpSeller)',
    ];
    const rows = [header.join(',')];
    for (const sale of sales) {
      const dispatch = sale.fulfillmentType
        ? FULFILLMENT_LABEL[sale.fulfillmentType] || sale.fulfillmentType
        : sale.shippingMethod || '';
      for (const item of sale.items) {
        rows.push([
          sale.createdAt.toISOString(),
          CHANNEL_LABEL[sale.channel] || sale.channel,
          sale.connection?.name || '',
          sale.id,
          sale.externalId || '',
          sale.customerName || '',
          dispatch,
          item.product?.sku || '',
          item.product?.name || 'Producto eliminado',
          item.quantity,
          Number(item.unitPrice),
          Number(item.unitPrice) * item.quantity,
          sale.shippingCost != null ? Number(sale.shippingCost) : '',
          sale.marketplaceFee != null ? Number(sale.marketplaceFee) : '',
          sale.taxes != null ? Number(sale.taxes) : '',
          sale.discount != null ? Number(sale.discount) : '',
          sale.netAmount != null ? Number(sale.netAmount) : '',
        ].map(escape).join(','));
      }
    }
    return rows.join('\n');
  }

  async getDailySummary(user: any, companyId?: string, date?: string) {
    const cid = user.role === Role.SUPER_ADMIN ? companyId : user.companyId;
    const tz = await this.settings.getTimezone();
    const dayKey = date || dateKeyStringInTz(new Date(), tz);
    const from = startOfDayInTz(tz, dayKey);
    const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);

    const where: any = { createdAt: { gte: from, lt: to } };
    if (cid) where.companyId = cid;

    const sales = await this.prisma.sale.findMany({
      where,
      include: { items: true },
    });

    const byChannel = sales.reduce((acc: any, s) => {
      if (!acc[s.channel]) acc[s.channel] = { count: 0, total: 0 };
      acc[s.channel].count++;
      acc[s.channel].total += Number(s.total);
      return acc;
    }, {});

    const byPayment = await this.paymentTotals(where);

    return {
      date: dayKey,
      totalSales: sales.length,
      totalRevenue: sales.reduce((s, v) => s + Number(v.total), 0),
      // Neto real recibido: total - envío - comisión - impuestos - descuento (ya viene
      // calculado en netAmount para canales de marketplace). Las ventas POS/manuales no
      // tienen esos descuentos, así que ahí el neto es el total completo.
      totalNetReceived: sales.reduce((s, v) => s + (v.netAmount != null ? Number(v.netAmount) : Number(v.total)), 0),
      byChannel,
      byPayment,
    };
  }

  async getStockMovements(productId: string, user: any) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Producto no encontrado');
    if (user.role !== Role.SUPER_ADMIN && product.companyId !== user.companyId) throw new ForbiddenException();

    return this.prisma.stockMovement.findMany({
      where: { productId },
      include: {
        user: { select: { id: true, name: true } },
        saleItem: { include: { sale: { select: { id: true, channel: true, createdAt: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async adjustStock(dto: StockAdjustDto, user: any) {
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException('Producto no encontrado');
    if (user.role !== Role.SUPER_ADMIN && product.companyId !== user.companyId) throw new ForbiddenException();

    const newStock = product.stock + dto.quantity;
    if (newStock < 0) throw new BadRequestException('El stock resultante no puede ser negativo');

    await this.prisma.$transaction((tx) => this.ledger.move(tx, {
      productId: dto.productId, warehouseId: dto.warehouseId, delta: dto.quantity, type: MovementType.ADJUSTMENT,
      reason: dto.reason || 'Ajuste manual', userId: user.id, reference: { type: 'ADJUSTMENT' },
    }));

    this.sync.syncProduct(dto.productId, newStock).catch(() => {});

    return this.prisma.product.findUnique({ where: { id: dto.productId } });
  }
}

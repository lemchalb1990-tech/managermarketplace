import { Injectable, BadRequestException, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { FulfillmentType, Role, SaleChannel, MovementType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SyncService } from '../ecommerce/sync/sync.service';
import { EmailService } from '../email/email.service';
import { InventoryCostingService } from '../purchases/inventory-costing.service';
import { CreateSaleDto, StockAdjustDto } from './dto/pos.dto';

@Injectable()
export class PosService {
  private readonly logger = new Logger(PosService.name);

  constructor(
    private prisma: PrismaService,
    private sync: SyncService,
    private email: EmailService,
    private costing: InventoryCostingService,
  ) {}

  private resolveCompanyId(user: any, companyId?: string): string {
    if (user.role === Role.SUPER_ADMIN) {
      if (!companyId) throw new BadRequestException('companyId requerido para Super Admin');
      return companyId;
    }
    if (!user.companyId) throw new ForbiddenException('Sin empresa asignada');
    return user.companyId;
  }

  async createSale(dto: CreateSaleDto, user: any) {
    const companyId = this.resolveCompanyId(user, dto.companyId);

    const products = await this.prisma.product.findMany({
      where: { id: { in: dto.items.map(i => i.productId) }, companyId },
    });

    for (const item of dto.items) {
      const product = products.find(p => p.id === item.productId);
      if (!product) throw new BadRequestException(`Producto ${item.productId} no encontrado`);
      if (!product.active) throw new BadRequestException(`El producto "${product.name}" está inactivo`);
      if (product.stock < item.quantity) {
        throw new BadRequestException(`Stock insuficiente para "${product.name}": disponible ${product.stock}, solicitado ${item.quantity}`);
      }
    }

    const total = dto.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

    // Auto-detect warehouse from products weighted by quantity
    const warehouseCounts: Record<string, number> = {};
    for (const item of dto.items) {
      const p = products.find(pr => pr.id === item.productId);
      if (p?.warehouseId) {
        warehouseCounts[p.warehouseId] = (warehouseCounts[p.warehouseId] || 0) + item.quantity;
      }
    }
    const autoWarehouseId = Object.entries(warehouseCounts).sort(([, a], [, b]) => b - a)[0]?.[0];

    const sale = await this.prisma.$transaction(async (tx) => {
      const created = await tx.sale.create({
        data: {
          channel: dto.channel,
          externalId: dto.externalId,
          total,
          paymentMethod: dto.paymentMethod,
          notes: dto.notes,
          customerName: dto.customerName,
          customerEmail: dto.customerEmail,
          customerPhone: dto.customerPhone,
          fulfillmentType: dto.fulfillmentType,
          address: dto.address,
          commune: dto.commune,
          city: dto.city,
          companyId,
          userId: user.id,
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
        const totalCost = await this.costing.consumeForSale(tx, {
          companyId,
          productId: item.productId,
          warehouseId: product.warehouseId,
          quantity: item.quantity,
          saleItemId: item.id,
          reason: `Venta ${dto.channel === SaleChannel.POS ? 'POS' : dto.channel}`,
          userId: user.id,
        });
        if (totalCost != null) {
          await tx.saleItem.update({ where: { id: item.id }, data: { totalCost } });
        }
      }

      // Auto-create order when fulfillmentType is provided (POS checkout)
      if (dto.fulfillmentType) {
        await tx.order.create({
          data: {
            fulfillmentType: dto.fulfillmentType,
            customerName: dto.customerName,
            customerEmail: dto.customerEmail,
            customerPhone: dto.customerPhone,
            address: dto.address,
            commune: dto.commune,
            city: dto.city,
            companyId,
            saleId: created.id,
            warehouseId: autoWarehouseId || undefined,
            createdById: user.id,
            itemChecks: {
              create: dto.items.map(i => {
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
      this.email.sendSaleReceipt({ ...sale, companyId, customerEmail: dto.customerEmail, customerName: dto.customerName, fulfillmentType: dto.fulfillmentType, address: dto.address, commune: dto.commune, city: dto.city }, receiptItems).catch(e =>
        this.logger.error(`Sale receipt email failed: ${e.message}`),
      );
    }

    return result;
  }

  async getWeeklySales(user: any, companyId?: string, days = 7) {
    const cid = user.role === Role.SUPER_ADMIN ? companyId : user.companyId;

    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    const where: any = { createdAt: { gte: from, lt: to } };
    if (cid) where.companyId = cid;

    const sales = await this.prisma.sale.findMany({
      where,
      select: { total: true, channel: true, createdAt: true },
    });

    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(now);
      day.setDate(now.getDate() - i);
      const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

      const daySales = sales.filter(s => s.createdAt >= dayStart && s.createdAt < dayEnd);
      const posTotal = daySales
        .filter(s => s.channel === SaleChannel.POS)
        .reduce((sum, s) => sum + Number(s.total), 0);
      const ecomTotal = daySales
        .filter(s => s.channel !== SaleChannel.POS)
        .reduce((sum, s) => sum + Number(s.total), 0);

      result.push({
        date: dayStart.toISOString().split('T')[0],
        label: dayStart.toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric' }),
        total: posTotal + ecomTotal,
        count: daySales.length,
        posTotal,
        ecomTotal,
      });
    }

    return result;
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
        { customerName: { contains: term, mode: 'insensitive' } },
        { items: { some: { product: { name: { contains: term, mode: 'insensitive' } } } } },
        { items: { some: { product: { sku: { contains: term, mode: 'insensitive' } } } } },
      ];
    }

    const page = Math.max(1, parseInt(query.page || '1'));
    const take = 50;
    const skip = (page - 1) * take;

    const [sales, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        include: {
          items: { include: { product: { select: { id: true, name: true, sku: true } } } },
          user: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.sale.count({ where }),
    ]);

    return { sales, total, page, pages: Math.ceil(total / take) };
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
      include: { items: { include: { product: { select: { sku: true, name: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    const CHANNEL_LABEL: Record<string, string> = {
      POS: 'Punto de Venta', MERCADO_LIBRE: 'Mercado Libre', SHOPIFY: 'Shopify',
      WOOCOMMERCE: 'WooCommerce', JUMPSELLER: 'JumpSeller', FALABELLA: 'Falabella',
      PARIS: 'Paris', HITES: 'Hites', RIPLEY: 'Ripley', WALMART: 'Walmart', MANUAL: 'Manual',
    };

    const FULFILLMENT_LABEL: Record<string, string> = { PICKUP: 'Retiro en tienda', DELIVERY: 'Entrega a domicilio' };

    const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = [
      'Fecha', 'Canal', 'ID Venta', 'ID Externo', 'Comprador', 'Forma de despacho', 'SKU', 'Producto', 'Cantidad', 'Precio unitario', 'Subtotal',
      'Envío', 'Comisión marketplace', 'Impuestos', 'Descuento/Cupón', 'Total neto recibido',
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
    const day = date ? new Date(date) : new Date();
    const from = new Date(day.getFullYear(), day.getMonth(), day.getDate());
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

    const byPayment = sales.reduce((acc: any, s) => {
      const key = s.paymentMethod || 'SIN_ESPECIFICAR';
      if (!acc[key]) acc[key] = { count: 0, total: 0 };
      acc[key].count++;
      acc[key].total += Number(s.total);
      return acc;
    }, {});

    return {
      date: from.toISOString().split('T')[0],
      totalSales: sales.length,
      totalRevenue: sales.reduce((s, v) => s + Number(v.total), 0),
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

    await this.prisma.$transaction([
      this.prisma.product.update({
        where: { id: dto.productId },
        data: { stock: newStock },
      }),
      this.prisma.stockMovement.create({
        data: {
          type: MovementType.ADJUSTMENT,
          quantity: dto.quantity,
          reason: dto.reason || 'Ajuste manual',
          productId: dto.productId,
          userId: user.id,
        },
      }),
    ]);

    this.sync.syncProduct(dto.productId, newStock).catch(() => {});

    return this.prisma.product.findUnique({ where: { id: dto.productId } });
  }
}

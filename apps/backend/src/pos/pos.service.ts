import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Role, SaleChannel, MovementType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MercadolibreService } from '../ecommerce/mercadolibre/mercadolibre.service';
import { CreateSaleDto, StockAdjustDto } from './dto/pos.dto';

@Injectable()
export class PosService {
  constructor(
    private prisma: PrismaService,
    private ml: MercadolibreService,
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

    // Validar stock de todos los productos
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

    const sale = await this.prisma.$transaction(async (tx) => {
      const created = await tx.sale.create({
        data: {
          channel: dto.channel,
          externalId: dto.externalId,
          total,
          paymentMethod: dto.paymentMethod,
          notes: dto.notes,
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

      // Descontar stock y registrar movimientos
      for (const item of created.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });

        await tx.stockMovement.create({
          data: {
            type: MovementType.SALE,
            quantity: -item.quantity,
            reason: `Venta ${dto.channel === SaleChannel.POS ? 'POS' : dto.channel}`,
            productId: item.productId,
            saleItemId: item.id,
            userId: user.id,
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

    // Sincronizar publicaciones ML de cada producto vendido (sin bloquear la respuesta)
    for (const item of result!.items) {
      this.ml.syncProductListings(item.productId, item.product.stock).catch(() => {});
    }

    return result;
  }

  async listSales(user: any, query: { companyId?: string; channel?: SaleChannel; from?: string; to?: string; page?: string }) {
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

    // Sincronizar publicaciones ML con el nuevo stock
    this.ml.syncProductListings(dto.productId, newStock).catch(() => {});

    return this.prisma.product.findUnique({ where: { id: dto.productId } });
  }
}

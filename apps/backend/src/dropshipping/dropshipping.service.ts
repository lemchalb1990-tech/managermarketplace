import {
  Injectable, Logger, NotFoundException, ForbiddenException,
  BadRequestException, ConflictException,
} from '@nestjs/common';
import { DropshipOrderStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import {
  CreateDropshipSupplierDto, UpdateDropshipSupplierDto,
  CreateDropshipProductDto, UpdateDropshipProductDto,
  ListDropshipOrdersDto, UpdateDropshipOrderDto,
} from './dto/dropshipping.dto';

const PAGE_SIZE = 20;

@Injectable()
export class DropshippingService {
  private readonly logger = new Logger(DropshippingService.name);

  constructor(
    private prisma: PrismaService,
    private email: EmailService,
  ) {}

  private resolveCompanyId(user: any, companyId?: string): string {
    if (user.role === Role.SUPER_ADMIN) {
      if (!companyId) throw new BadRequestException('companyId requerido para Super Admin');
      return companyId;
    }
    if (!user.companyId) throw new ForbiddenException('Sin empresa asignada');
    return user.companyId;
  }

  private scopeWhere(user: any, companyId?: string) {
    return user.role === Role.SUPER_ADMIN
      ? (companyId ? { companyId } : {})
      : { companyId: user.companyId };
  }

  // ─── Proveedores dropship ─────────────────────────────────────────────────

  async listSuppliers(user: any, companyId?: string) {
    return this.prisma.dropshipSupplier.findMany({
      where: this.scopeWhere(user, companyId),
      include: {
        supplier: true,
        _count: { select: { products: true, orders: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createSupplier(dto: CreateDropshipSupplierDto, user: any) {
    const companyId = this.resolveCompanyId(user, dto.companyId);

    let supplierId = dto.supplierId;
    if (supplierId) {
      const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier || supplier.companyId !== companyId) {
        throw new BadRequestException('Proveedor no válido para esta empresa');
      }
      const existing = await this.prisma.dropshipSupplier.findUnique({ where: { supplierId } });
      if (existing) throw new ConflictException('Ese proveedor ya está configurado como dropship');
    } else {
      if (!dto.name?.trim()) throw new BadRequestException('Indica un proveedor existente o el nombre de uno nuevo');
      const created = await this.prisma.supplier.create({
        data: {
          companyId,
          name: dto.name.trim(),
          taxId: dto.taxId,
          email: dto.email,
          phone: dto.phone,
          address: dto.address,
        },
      });
      supplierId = created.id;
    }

    return this.prisma.dropshipSupplier.create({
      data: {
        companyId,
        supplierId,
        autoCreateOrders: dto.autoCreateOrders ?? true,
        leadTimeDays: dto.leadTimeDays ?? null,
        notes: dto.notes,
      },
      include: { supplier: true, _count: { select: { products: true, orders: true } } },
    });
  }

  async updateSupplier(id: string, dto: UpdateDropshipSupplierDto, user: any) {
    const ds = await this.prisma.dropshipSupplier.findUnique({ where: { id } });
    if (!ds) throw new NotFoundException('Proveedor dropship no encontrado');
    if (user.role !== Role.SUPER_ADMIN && ds.companyId !== user.companyId) throw new ForbiddenException();
    return this.prisma.dropshipSupplier.update({
      where: { id },
      data: {
        active: dto.active,
        autoCreateOrders: dto.autoCreateOrders,
        leadTimeDays: dto.leadTimeDays,
        notes: dto.notes,
      },
      include: { supplier: true, _count: { select: { products: true, orders: true } } },
    });
  }

  async removeSupplier(id: string, user: any) {
    const ds = await this.prisma.dropshipSupplier.findUnique({
      where: { id },
      include: { _count: { select: { orders: true } }, products: { select: { productId: true } } },
    });
    if (!ds) throw new NotFoundException('Proveedor dropship no encontrado');
    if (user.role !== Role.SUPER_ADMIN && ds.companyId !== user.companyId) throw new ForbiddenException();
    if (ds._count.orders > 0) {
      throw new ConflictException(`Tiene ${ds._count.orders} pedido(s) registrado(s). Desactívalo en vez de eliminarlo.`);
    }
    await this.prisma.$transaction([
      this.prisma.product.updateMany({
        where: { id: { in: ds.products.map((p) => p.productId) } },
        data: { dropship: false },
      }),
      this.prisma.dropshipSupplier.delete({ where: { id } }),
    ]);
    return { deleted: true };
  }

  // ─── Productos dropship ───────────────────────────────────────────────────

  async listProducts(user: any, companyId?: string) {
    const where = this.scopeWhere(user, companyId);
    const [linked, availableProducts] = await Promise.all([
      this.prisma.dropshipProduct.findMany({
        where,
        include: {
          product: { select: { id: true, sku: true, name: true, price: true, mlPrice: true } },
          dropshipSupplier: { include: { supplier: { select: { id: true, name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.product.findMany({
        where: { ...where, active: true, dropshipProduct: null },
        select: { id: true, sku: true, name: true, price: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return { linked, availableProducts };
  }

  async createProduct(dto: CreateDropshipProductDto, user: any) {
    const companyId = this.resolveCompanyId(user, dto.companyId);

    const [product, ds] = await Promise.all([
      this.prisma.product.findUnique({ where: { id: dto.productId } }),
      this.prisma.dropshipSupplier.findUnique({ where: { id: dto.dropshipSupplierId } }),
    ]);
    if (!product || product.companyId !== companyId) throw new BadRequestException('Producto no válido para esta empresa');
    if (!ds || ds.companyId !== companyId) throw new BadRequestException('Proveedor dropship no válido para esta empresa');

    const existing = await this.prisma.dropshipProduct.findUnique({ where: { productId: dto.productId } });
    if (existing) throw new ConflictException('Ese producto ya está vinculado a un proveedor dropship');

    const [created] = await this.prisma.$transaction([
      this.prisma.dropshipProduct.create({
        data: {
          companyId,
          productId: dto.productId,
          dropshipSupplierId: dto.dropshipSupplierId,
          supplierCost: dto.supplierCost,
          supplierSku: dto.supplierSku,
          leadTimeDays: dto.leadTimeDays ?? null,
        },
        include: {
          product: { select: { id: true, sku: true, name: true, price: true, mlPrice: true } },
          dropshipSupplier: { include: { supplier: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.product.update({
        where: { id: dto.productId },
        data: { dropship: true, supplierPrice: dto.supplierCost },
      }),
    ]);
    return created;
  }

  async updateProduct(id: string, dto: UpdateDropshipProductDto, user: any) {
    const dp = await this.prisma.dropshipProduct.findUnique({ where: { id } });
    if (!dp) throw new NotFoundException('Producto dropship no encontrado');
    if (user.role !== Role.SUPER_ADMIN && dp.companyId !== user.companyId) throw new ForbiddenException();

    const active = dto.active ?? dp.active;
    const [updated] = await this.prisma.$transaction([
      this.prisma.dropshipProduct.update({
        where: { id },
        data: {
          supplierCost: dto.supplierCost,
          supplierSku: dto.supplierSku,
          leadTimeDays: dto.leadTimeDays,
          active: dto.active,
        },
        include: {
          product: { select: { id: true, sku: true, name: true, price: true, mlPrice: true } },
          dropshipSupplier: { include: { supplier: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.product.update({
        where: { id: dp.productId },
        data: {
          dropship: active,
          ...(dto.supplierCost != null ? { supplierPrice: dto.supplierCost } : {}),
        },
      }),
    ]);
    return updated;
  }

  async removeProduct(id: string, user: any) {
    const dp = await this.prisma.dropshipProduct.findUnique({ where: { id } });
    if (!dp) throw new NotFoundException('Producto dropship no encontrado');
    if (user.role !== Role.SUPER_ADMIN && dp.companyId !== user.companyId) throw new ForbiddenException();
    await this.prisma.$transaction([
      this.prisma.dropshipProduct.delete({ where: { id } }),
      this.prisma.product.update({ where: { id: dp.productId }, data: { dropship: false } }),
    ]);
    return { deleted: true };
  }

  // ─── Pedidos al proveedor ─────────────────────────────────────────────────

  async listOrders(user: any, query: ListDropshipOrdersDto) {
    const page = Math.max(1, Number(query.page ?? 1));
    const where: Prisma.DropshipOrderWhereInput = this.scopeWhere(user, query.companyId);
    if (query.status) where.status = query.status;
    if (query.dropshipSupplierId) where.dropshipSupplierId = query.dropshipSupplierId;

    const [orders, total] = await Promise.all([
      this.prisma.dropshipOrder.findMany({
        where,
        include: {
          items: true,
          dropshipSupplier: { include: { supplier: { select: { id: true, name: true, email: true } } } },
          sale: { select: { id: true, channel: true, externalId: true, customerName: true, customerEmail: true, address: true, commune: true, city: true, createdAt: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.dropshipOrder.count({ where }),
    ]);
    return { orders, total, page, pages: Math.ceil(total / PAGE_SIZE) };
  }

  async getOrder(id: string, user: any) {
    const order = await this.prisma.dropshipOrder.findUnique({
      where: { id },
      include: {
        items: { include: { product: { select: { id: true, sku: true, name: true } } } },
        dropshipSupplier: { include: { supplier: true } },
        sale: true,
      },
    });
    if (!order) throw new NotFoundException('Pedido dropship no encontrado');
    if (user.role !== Role.SUPER_ADMIN && order.companyId !== user.companyId) throw new ForbiddenException();
    return order;
  }

  async updateOrder(id: string, dto: UpdateDropshipOrderDto, user: any) {
    const order = await this.getOrder(id, user);

    const data: Prisma.DropshipOrderUpdateInput = {
      trackingCode: dto.trackingCode,
      courier: dto.courier,
      supplierRef: dto.supplierRef,
      notes: dto.notes,
    };

    if (dto.status && dto.status !== order.status) {
      data.status = dto.status;
      const now = new Date();
      if (dto.status === DropshipOrderStatus.SENT && !order.sentAt) data.sentAt = now;
      if (dto.status === DropshipOrderStatus.CONFIRMED && !order.confirmedAt) data.confirmedAt = now;
      if (dto.status === DropshipOrderStatus.SHIPPED && !order.shippedAt) data.shippedAt = now;
      if (dto.status === DropshipOrderStatus.DELIVERED && !order.deliveredAt) data.deliveredAt = now;
      if (dto.status === DropshipOrderStatus.CANCELLED && !order.cancelledAt) data.cancelledAt = now;
    }

    return this.prisma.dropshipOrder.update({
      where: { id },
      data,
      include: {
        items: true,
        dropshipSupplier: { include: { supplier: { select: { id: true, name: true, email: true } } } },
        sale: { select: { id: true, channel: true, externalId: true, customerName: true } },
      },
    });
  }

  async sendOrder(id: string, user: any) {
    const order = await this.getOrder(id, user);
    if (order.status === DropshipOrderStatus.CANCELLED) {
      throw new BadRequestException('El pedido está cancelado');
    }
    const to = order.dropshipSupplier.supplier.email?.trim();
    if (!to) throw new BadRequestException('El proveedor no tiene correo configurado');

    await this.email.sendDropshipOrderEmail(order.companyId, to, order);

    return this.prisma.dropshipOrder.update({
      where: { id },
      data: {
        status: order.status === DropshipOrderStatus.PENDING ? DropshipOrderStatus.SENT : order.status,
        sentAt: order.sentAt ?? new Date(),
      },
      include: {
        items: true,
        dropshipSupplier: { include: { supplier: { select: { id: true, name: true, email: true } } } },
        sale: { select: { id: true, channel: true, externalId: true, customerName: true } },
      },
    });
  }

  // ─── Generación de pedidos desde las ventas ───────────────────────────────

  // Recorre las ventas recientes con productos dropship y crea el pedido al proveedor
  // correspondiente (uno por venta y proveedor). Idempotente: el índice único
  // (saleId, dropshipSupplierId) evita duplicar y se ignoran las colisiones.
  async generateOrders(companyId: string, sinceDays = 30) {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

    const dropshipProducts = await this.prisma.dropshipProduct.findMany({
      where: { companyId, active: true },
      include: { dropshipSupplier: true },
    });
    if (!dropshipProducts.length) return { created: 0, sent: 0, skipped: 0 };

    const byProduct = new Map(dropshipProducts.map((dp) => [dp.productId, dp]));

    const sales = await this.prisma.sale.findMany({
      where: {
        companyId,
        createdAt: { gte: since },
        items: { some: { productId: { in: [...byProduct.keys()] } } },
      },
      include: {
        items: { include: { product: { select: { id: true, sku: true, name: true } } } },
        dropshipOrders: { select: { dropshipSupplierId: true } },
      },
    });

    let created = 0;
    let sent = 0;
    let skipped = 0;

    for (const sale of sales) {
      const alreadyBySupplier = new Set(sale.dropshipOrders.map((o) => o.dropshipSupplierId));

      // Agrupa los ítems dropship de la venta por proveedor.
      const groups = new Map<string, typeof sale.items>();
      for (const item of sale.items) {
        const dp = byProduct.get(item.productId);
        if (!dp) continue;
        const arr = groups.get(dp.dropshipSupplierId) ?? [];
        arr.push(item);
        groups.set(dp.dropshipSupplierId, arr);
      }

      for (const [dropshipSupplierId, items] of groups) {
        if (alreadyBySupplier.has(dropshipSupplierId)) { skipped++; continue; }

        const ds = dropshipProducts.find((dp) => dp.dropshipSupplierId === dropshipSupplierId)!.dropshipSupplier;

        let supplierCost = 0;
        let saleAmount = 0;
        const orderItems = items.map((item) => {
          const dp = byProduct.get(item.productId)!;
          const unitCost = Number(dp.supplierCost);
          supplierCost += unitCost * item.quantity;
          saleAmount += Number(item.unitPrice) * item.quantity;
          return {
            productId: item.productId,
            saleItemId: item.id,
            productName: item.product.name,
            productSku: item.product.sku,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            unitCost: new Prisma.Decimal(unitCost),
          };
        });

        // Comisión del canal prorrateada por la parte dropship de la venta.
        const saleTotal = Number(sale.total) || 0;
        const channelFee = sale.marketplaceFee && saleTotal > 0
          ? new Prisma.Decimal((Number(sale.marketplaceFee) * saleAmount) / saleTotal)
          : null;

        try {
          const order = await this.prisma.$transaction(async (tx) => {
            const dropOrder = await tx.dropshipOrder.create({
              data: {
                companyId,
                dropshipSupplierId,
                saleId: sale.id,
                status: DropshipOrderStatus.PENDING,
                supplierCost: new Prisma.Decimal(supplierCost),
                saleAmount: new Prisma.Decimal(saleAmount),
                channelFee,
                items: { create: orderItems },
              },
              include: {
                items: true,
                dropshipSupplier: { include: { supplier: true } },
                sale: true,
              },
            });

            // Costea las líneas dropship de la venta al costo del proveedor (si aún no).
            for (const item of items) {
              const dp = byProduct.get(item.productId)!;
              if (item.totalCost == null) {
                await tx.saleItem.update({
                  where: { id: item.id },
                  data: { totalCost: new Prisma.Decimal(Number(dp.supplierCost) * item.quantity) },
                });
              }
            }
            return dropOrder;
          });

          created++;

          if (ds.autoCreateOrders && order.dropshipSupplier.supplier.email?.trim()) {
            try {
              await this.email.sendDropshipOrderEmail(
                companyId,
                order.dropshipSupplier.supplier.email.trim(),
                order,
              );
              await this.prisma.dropshipOrder.update({
                where: { id: order.id },
                data: { status: DropshipOrderStatus.SENT, sentAt: new Date() },
              });
              sent++;
            } catch (err: any) {
              this.logger.warn(`No se pudo enviar el pedido dropship ${order.id} al proveedor: ${err?.message}`);
            }
          }
        } catch (err: any) {
          if (err?.code === 'P2002') { skipped++; continue; } // otra corrida lo creó
          throw err;
        }
      }
    }

    return { created, sent, skipped };
  }

  async generateOrdersForUser(user: any, companyId?: string, sinceDays?: number) {
    const cid = this.resolveCompanyId(user, companyId);
    return this.generateOrders(cid, sinceDays ?? 30);
  }

  // ─── Reporte de rentabilidad dropship ────────────────────────────────────

  async report(user: any, companyId?: string, from?: string, to?: string) {
    const where: Prisma.DropshipOrderWhereInput = this.scopeWhere(user, companyId);
    where.status = { not: DropshipOrderStatus.CANCELLED };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const orders = await this.prisma.dropshipOrder.findMany({
      where,
      include: {
        dropshipSupplier: { include: { supplier: { select: { id: true, name: true } } } },
        sale: { select: { id: true, channel: true, externalId: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const rows = orders.map((o) => {
      const saleAmount = Number(o.saleAmount);
      const supplierCost = Number(o.supplierCost);
      const channelFee = Number(o.channelFee ?? 0);
      const margin = saleAmount - supplierCost - channelFee;
      return {
        id: o.id,
        createdAt: o.createdAt,
        status: o.status,
        supplierName: o.dropshipSupplier.supplier.name,
        saleChannel: o.sale.channel,
        saleRef: o.sale.externalId ?? o.sale.id.slice(-8).toUpperCase(),
        saleAmount,
        supplierCost,
        channelFee,
        margin,
        marginPct: saleAmount > 0 ? (margin / saleAmount) * 100 : 0,
      };
    });

    const totals = rows.reduce(
      (acc, r) => ({
        orders: acc.orders + 1,
        saleAmount: acc.saleAmount + r.saleAmount,
        supplierCost: acc.supplierCost + r.supplierCost,
        channelFee: acc.channelFee + r.channelFee,
        margin: acc.margin + r.margin,
      }),
      { orders: 0, saleAmount: 0, supplierCost: 0, channelFee: 0, margin: 0 },
    );

    return {
      rows,
      totals: {
        ...totals,
        marginPct: totals.saleAmount > 0 ? (totals.margin / totals.saleAmount) * 100 : 0,
      },
    };
  }

  // Empresas con el módulo dropshipping activo (para el cron).
  async companiesWithModule(): Promise<string[]> {
    const companies = await this.prisma.company.findMany({
      where: { active: true },
      select: { id: true, modules: true },
    });
    return companies
      .filter((c) => {
        const mods = c.modules as unknown;
        if (!mods || !Array.isArray(mods)) return true; // null = todos licenciados
        return mods.some((m: string) => m === 'dropshipping' || m.startsWith('dropshipping_'));
      })
      .map((c) => c.id);
  }
}

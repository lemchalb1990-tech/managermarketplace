import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Role, OrderRequestStatus, InvoiceStatus, SaleChannel, FulfillmentType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryCostingService } from '../purchases/inventory-costing.service';
import { CreateOrderRequestDto, RejectOrderRequestDto } from './dto/order-request.dto';

const PAGE_SIZE = 20;

const ORDER_REQUEST_INCLUDE = {
  client: {
    select: { id: true, name: true, rut: true, email: true, phone: true, address: true, commune: true, city: true, creditLimit: true },
  },
  requestedBy: { select: { id: true, name: true } },
  reviewedBy: { select: { id: true, name: true } },
  items: {
    include: { product: { select: { id: true, name: true, sku: true, stock: true, price: true } } },
  },
  sale: { select: { id: true, channel: true, total: true } },
};

@Injectable()
export class OrderRequestsService {
  constructor(
    private prisma: PrismaService,
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

  private guard(orderRequest: any, user: any) {
    if (user.role !== Role.SUPER_ADMIN && orderRequest.companyId !== user.companyId) {
      throw new ForbiddenException();
    }
  }

  private async computeDebt(clientId: string): Promise<number> {
    const invoices = await this.prisma.invoice.findMany({
      where: { clientId, paid: false, status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.ACCEPTED] } },
      select: { totalAmount: true },
    });
    return invoices.reduce((sum, i) => sum + Number(i.totalAmount), 0);
  }

  async create(dto: CreateOrderRequestDto, user: any) {
    const companyId = this.resolveCompanyId(user, dto.companyId);

    const client = await this.prisma.client.findUnique({ where: { id: dto.clientId } });
    if (!client) throw new NotFoundException('Cliente no encontrado');
    if (client.companyId !== companyId) throw new ForbiddenException();
    if (!client.active) throw new BadRequestException('El cliente está inactivo');

    if (client.creditLimit != null) {
      const debt = await this.computeDebt(client.id);
      if (debt >= Number(client.creditLimit)) {
        throw new BadRequestException(
          `El cliente "${client.name}" superó su límite de crédito (deuda: $${debt.toLocaleString('es-CL')} de un límite de $${Number(client.creditLimit).toLocaleString('es-CL')}). No se puede crear la solicitud.`,
        );
      }
    }

    const products = await this.prisma.product.findMany({
      where: { id: { in: dto.items.map((i) => i.productId) }, companyId },
    });

    for (const item of dto.items) {
      const product = products.find((p) => p.id === item.productId);
      if (!product) throw new BadRequestException(`Producto ${item.productId} no encontrado`);
      if (!product.active) throw new BadRequestException(`El producto "${product.name}" está inactivo`);
      if (product.stock < item.quantity) {
        throw new BadRequestException(`Stock insuficiente para "${product.name}": disponible ${product.stock}, solicitado ${item.quantity}`);
      }
    }

    return this.prisma.orderRequest.create({
      data: {
        companyId,
        clientId: dto.clientId,
        requestedById: user.id,
        notes: dto.notes,
        scheduledDispatchDate: dto.scheduledDispatchDate ? new Date(dto.scheduledDispatchDate) : undefined,
        items: {
          create: dto.items.map((i) => {
            const product = products.find((p) => p.id === i.productId)!;
            return { productId: i.productId, quantity: i.quantity, unitPrice: product.price };
          }),
        },
      },
      include: ORDER_REQUEST_INCLUDE,
    });
  }

  async findMine(user: any, page?: string) {
    const p = Math.max(1, parseInt(page || '1'));
    const where = { requestedById: user.id };
    const [items, total] = await Promise.all([
      this.prisma.orderRequest.findMany({
        where, include: ORDER_REQUEST_INCLUDE, orderBy: { createdAt: 'desc' },
        skip: (p - 1) * PAGE_SIZE, take: PAGE_SIZE,
      }),
      this.prisma.orderRequest.count({ where }),
    ]);
    return { items, total, page: p, pages: Math.ceil(total / PAGE_SIZE) };
  }

  async findPending(user: any, query: { companyId?: string; page?: string }) {
    const where: any = { status: OrderRequestStatus.PENDING };
    if (user.role !== Role.SUPER_ADMIN) where.companyId = user.companyId;
    else if (query.companyId) where.companyId = query.companyId;

    const p = Math.max(1, parseInt(query.page || '1'));
    const [items, total] = await Promise.all([
      this.prisma.orderRequest.findMany({
        where, include: ORDER_REQUEST_INCLUDE, orderBy: { createdAt: 'asc' },
        skip: (p - 1) * PAGE_SIZE, take: PAGE_SIZE,
      }),
      this.prisma.orderRequest.count({ where }),
    ]);
    return { items, total, page: p, pages: Math.ceil(total / PAGE_SIZE) };
  }

  async findOne(id: string, user: any) {
    const orderRequest = await this.prisma.orderRequest.findUnique({ where: { id }, include: ORDER_REQUEST_INCLUDE });
    if (!orderRequest) throw new NotFoundException('Solicitud no encontrada');
    this.guard(orderRequest, user);
    return orderRequest;
  }

  async approve(id: string, user: any) {
    const orderRequest = await this.prisma.orderRequest.findUnique({ where: { id }, include: ORDER_REQUEST_INCLUDE });
    if (!orderRequest) throw new NotFoundException('Solicitud no encontrada');
    this.guard(orderRequest, user);
    if (orderRequest.status !== OrderRequestStatus.PENDING) {
      throw new BadRequestException('Solo se pueden aprobar solicitudes pendientes');
    }

    const productIds = orderRequest.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({ where: { id: { in: productIds } } });
    for (const item of orderRequest.items) {
      const product = products.find((p) => p.id === item.productId);
      if (!product) throw new BadRequestException(`Producto ${item.productId} ya no existe`);
      if (product.stock < item.quantity) {
        throw new BadRequestException(`Stock insuficiente para "${product.name}": disponible ${product.stock}, solicitado ${item.quantity}`);
      }
    }

    const total = orderRequest.items.reduce((sum, i) => sum + Number(i.unitPrice) * i.quantity, 0);

    const warehouseCounts: Record<string, number> = {};
    for (const item of orderRequest.items) {
      const product = products.find((p) => p.id === item.productId);
      if (product?.warehouseId) warehouseCounts[product.warehouseId] = (warehouseCounts[product.warehouseId] || 0) + item.quantity;
    }
    const autoWarehouseId = Object.entries(warehouseCounts).sort(([, a], [, b]) => b - a)[0]?.[0];

    await this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.create({
        data: {
          channel: SaleChannel.ORDER_REQUEST,
          total,
          companyId: orderRequest.companyId,
          userId: orderRequest.requestedById,
          customerName: orderRequest.client.name,
          customerEmail: orderRequest.client.email,
          customerPhone: orderRequest.client.phone,
          fulfillmentType: FulfillmentType.DELIVERY,
          address: orderRequest.client.address,
          commune: orderRequest.client.commune,
          city: orderRequest.client.city,
          items: {
            create: orderRequest.items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice })),
          },
        },
        include: { items: true },
      });

      for (const item of sale.items) {
        const product = products.find((p) => p.id === item.productId)!;
        const totalCost = await this.costing.consumeForSale(tx, {
          companyId: orderRequest.companyId,
          productId: item.productId,
          warehouseId: product.warehouseId,
          quantity: item.quantity,
          saleItemId: item.id,
          reason: `Solicitud de pedido aprobada (${orderRequest.id})`,
          userId: user.id,
        });
        if (totalCost != null) await tx.saleItem.update({ where: { id: item.id }, data: { totalCost } });
      }

      await tx.order.create({
        data: {
          fulfillmentType: FulfillmentType.DELIVERY,
          customerName: orderRequest.client.name,
          customerEmail: orderRequest.client.email,
          customerPhone: orderRequest.client.phone,
          address: orderRequest.client.address,
          commune: orderRequest.client.commune,
          city: orderRequest.client.city,
          scheduledDate: orderRequest.scheduledDispatchDate,
          companyId: orderRequest.companyId,
          saleId: sale.id,
          warehouseId: autoWarehouseId || undefined,
          createdById: user.id,
          itemChecks: {
            create: orderRequest.items.map((i) => {
              const product = products.find((p) => p.id === i.productId)!;
              return { productId: i.productId, productName: product.name, productSku: product.sku, expectedQty: i.quantity };
            }),
          },
        },
      });

      await tx.orderRequest.update({
        where: { id },
        data: { status: OrderRequestStatus.APPROVED, reviewedById: user.id, reviewedAt: new Date(), saleId: sale.id },
      });
    });

    return this.findOne(id, user);
  }

  async reject(id: string, dto: RejectOrderRequestDto, user: any) {
    const orderRequest = await this.prisma.orderRequest.findUnique({ where: { id } });
    if (!orderRequest) throw new NotFoundException('Solicitud no encontrada');
    this.guard(orderRequest, user);
    if (orderRequest.status !== OrderRequestStatus.PENDING) {
      throw new BadRequestException('Solo se pueden rechazar solicitudes pendientes');
    }
    return this.prisma.orderRequest.update({
      where: { id },
      data: { status: OrderRequestStatus.REJECTED, reviewedById: user.id, reviewedAt: new Date(), rejectionReason: dto.reason },
      include: ORDER_REQUEST_INCLUDE,
    });
  }

  async cancel(id: string, user: any) {
    const orderRequest = await this.prisma.orderRequest.findUnique({ where: { id } });
    if (!orderRequest) throw new NotFoundException('Solicitud no encontrada');
    this.guard(orderRequest, user);
    const isOwner = orderRequest.requestedById === user.id;
    const isManager = [Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.ORDER_MANAGER].includes(user.role);
    if (!isOwner && !isManager) throw new ForbiddenException('Solo el vendedor que la creó o un administrador puede cancelarla');
    if (orderRequest.status !== OrderRequestStatus.PENDING) {
      throw new BadRequestException('Solo se pueden cancelar solicitudes pendientes');
    }
    return this.prisma.orderRequest.update({
      where: { id },
      data: { status: OrderRequestStatus.CANCELLED },
      include: ORDER_REQUEST_INCLUDE,
    });
  }
}

import {
  Injectable, NotFoundException, ForbiddenException,
  BadRequestException, ConflictException, Logger,
} from '@nestjs/common';
import { OrderStatus, FulfillmentType, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CreateOrderDto, UpdateOrderDto, UpdateStatusDto, CheckItemDto, FindOrdersDto } from './dto/order.dto';

const PAGE_SIZE = 20;

const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING:    [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  PREPARING:  [OrderStatus.READY, OrderStatus.CANCELLED],
  READY:      [OrderStatus.IN_TRANSIT, OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  IN_TRANSIT: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  DELIVERED:  [],
  CANCELLED:  [],
};

const ORDER_INCLUDE = {
  itemChecks: {
    include: {
      product: { select: { id: true, name: true, sku: true } },
      checkedBy: { select: { id: true, name: true } },
    },
    orderBy: { productName: 'asc' as const },
  },
  photos: { orderBy: { createdAt: 'asc' as const } },
  warehouse: { select: { id: true, name: true } },
  sale: { select: { id: true, channel: true, total: true, createdAt: true } },
  createdBy: { select: { id: true, name: true } },
  company: { select: { id: true, name: true } },
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private prisma: PrismaService,
    private email: EmailService,
  ) {}

  private guard(order: any, user: any) {
    if (user.role !== Role.SUPER_ADMIN && order.companyId !== user.companyId) {
      throw new ForbiddenException();
    }
  }

  private async validateWarehouseId(warehouseId: string | null | undefined, companyId: string) {
    if (!warehouseId) return;
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id: warehouseId } });
    if (!warehouse || warehouse.companyId !== companyId) {
      throw new BadRequestException('La bodega seleccionada no pertenece a esta empresa');
    }
  }

  async findAll(user: any, query: FindOrdersDto) {
    const page = Number(query.page ?? 1);
    const where: any = {};
    if (user.role !== Role.SUPER_ADMIN) where.companyId = user.companyId;
    else if (query.companyId) where.companyId = query.companyId;
    if (query.status) where.status = query.status;
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          warehouse: { select: { id: true, name: true } },
          sale: { select: { id: true, channel: true, total: true } },
          _count: { select: { itemChecks: true, photos: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.order.count({ where }),
    ]);

    return { orders, total, page, pages: Math.ceil(total / PAGE_SIZE) };
  }

  async findOne(id: string, user: any) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
    if (!order) throw new NotFoundException('Orden no encontrada');
    this.guard(order, user);
    return order;
  }

  async create(dto: CreateOrderDto, user: any) {
    if (!user.companyId) throw new ForbiddenException('Sin empresa asignada');
    await this.validateWarehouseId(dto.warehouseId, user.companyId);

    let itemChecksData: { productId: string | null; productName: string; productSku: string; expectedQty: number }[] = [];
    let autoCustomerName: string | undefined;
    let autoCustomerEmail: string | undefined;
    let autoCustomerPhone: string | undefined;
    let autoFulfillmentType: FulfillmentType | undefined;
    let autoAddress: string | undefined;
    let autoCommune: string | undefined;
    let autoCity: string | undefined;
    let autoWarehouseId: string | undefined;

    if (dto.saleId) {
      const sale = await this.prisma.sale.findUnique({
        where: { id: dto.saleId },
        include: { items: { include: { product: true } }, order: true },
      });
      if (!sale) throw new NotFoundException('Venta no encontrada');
      if (user.role !== Role.SUPER_ADMIN && sale.companyId !== user.companyId) throw new ForbiddenException();
      if (sale.order) throw new ConflictException('Esta venta ya tiene una orden asociada');

      // Auto-populate customer fields from sale
      autoCustomerName = sale.customerName ?? undefined;
      autoCustomerEmail = sale.customerEmail ?? undefined;
      autoCustomerPhone = sale.customerPhone ?? undefined;
      autoFulfillmentType = sale.fulfillmentType ?? undefined;
      autoAddress = sale.address ?? undefined;
      autoCommune = sale.commune ?? undefined;
      autoCity = sale.city ?? undefined;

      // Auto-detect warehouse from products weighted by quantity
      const warehouseCounts: Record<string, number> = {};
      for (const item of sale.items) {
        if (item.product.warehouseId) {
          warehouseCounts[item.product.warehouseId] = (warehouseCounts[item.product.warehouseId] || 0) + item.quantity;
        }
      }
      autoWarehouseId = Object.entries(warehouseCounts).sort(([, a], [, b]) => b - a)[0]?.[0];

      itemChecksData = sale.items.map((i) => ({
        productId: i.productId,
        productName: i.product.name,
        productSku: i.product.sku,
        expectedQty: i.quantity,
      }));
    } else if (dto.items?.length) {
      const productIds = dto.items.map((i) => i.productId);
      const products = await this.prisma.product.findMany({ where: { id: { in: productIds }, companyId: user.companyId } });
      itemChecksData = dto.items.map((i) => {
        const p = products.find((pr) => pr.id === i.productId);
        if (!p) throw new BadRequestException(`Producto ${i.productId} no encontrado`);
        return { productId: p.id, productName: p.name, productSku: p.sku, expectedQty: i.expectedQty };
      });
    }

    const created = await this.prisma.order.create({
      data: {
        fulfillmentType: dto.fulfillmentType ?? autoFulfillmentType ?? FulfillmentType.DELIVERY,
        notes: dto.notes,
        customerName: dto.customerName ?? autoCustomerName,
        customerEmail: dto.customerEmail ?? autoCustomerEmail,
        customerPhone: dto.customerPhone ?? autoCustomerPhone,
        address: dto.address ?? autoAddress,
        commune: dto.commune ?? autoCommune,
        city: dto.city ?? autoCity,
        region: dto.region,
        companyId: user.companyId,
        saleId: dto.saleId,
        warehouseId: dto.warehouseId ?? autoWarehouseId,
        createdById: user.id,
        itemChecks: { create: itemChecksData },
      },
      include: ORDER_INCLUDE,
    });

    this.email.sendOrderEmail({ ...created, status: 'PENDING' }).catch(e =>
      this.logger.error(`Email ORDER_CONFIRMED failed: ${e.message}`),
    );

    return created;
  }

  async update(id: string, dto: UpdateOrderDto, user: any) {
    const order = await this.findOne(id, user);
    if (order.status === OrderStatus.DELIVERED || order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('No se puede modificar una orden finalizada');
    }
    await this.validateWarehouseId(dto.warehouseId, order.companyId);
    return this.prisma.order.update({ where: { id }, data: dto, include: ORDER_INCLUDE });
  }

  async updateStatus(id: string, dto: UpdateStatusDto, user: any) {
    const order = await this.findOne(id, user);
    const allowed = VALID_TRANSITIONS[order.status];

    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `No se puede cambiar de ${order.status} a ${dto.status}`,
      );
    }

    if (dto.status === OrderStatus.READY) {
      const unchecked = order.itemChecks.filter((i: any) => !i.checked);
      if (unchecked.length > 0) {
        throw new BadRequestException(
          `Faltan ${unchecked.length} producto(s) por verificar antes de marcar como Listo`,
        );
      }
    }

    if (dto.status === OrderStatus.IN_TRANSIT && order.fulfillmentType === FulfillmentType.DELIVERY) {
      if (order.photos.length === 0) {
        throw new BadRequestException('Sube al menos una foto del pedido antes de despachar');
      }
    }

    const data: any = { status: dto.status };
    if (dto.status === OrderStatus.DELIVERED) data.deliveredAt = new Date();

    const updated = await this.prisma.order.update({ where: { id }, data, include: ORDER_INCLUDE });

    this.email.sendOrderEmail(updated).catch(e =>
      this.logger.error(`Email ${dto.status} failed: ${e.message}`),
    );

    return updated;
  }

  async checkItem(orderId: string, itemId: string, dto: CheckItemDto, user: any) {
    const order = await this.findOne(orderId, user);
    if (order.status !== OrderStatus.PREPARING) {
      throw new BadRequestException('Solo se pueden verificar ítems cuando la orden está en preparación');
    }
    const item = order.itemChecks.find((i: any) => i.id === itemId);
    if (!item) throw new NotFoundException('Ítem no encontrado');

    return this.prisma.orderItemCheck.update({
      where: { id: itemId },
      data: {
        checked: true,
        checkedQty: dto.checkedQty,
        notes: dto.notes,
        checkedAt: new Date(),
        checkedById: user.id,
      },
    });
  }

  async uncheckItem(orderId: string, itemId: string, user: any) {
    const order = await this.findOne(orderId, user);
    if (order.status !== OrderStatus.PREPARING) {
      throw new BadRequestException('Solo se pueden modificar verificaciones en preparación');
    }
    const item = order.itemChecks.find((i: any) => i.id === itemId);
    if (!item) throw new NotFoundException('Ítem no encontrado');

    return this.prisma.orderItemCheck.update({
      where: { id: itemId },
      data: { checked: false, checkedQty: null, notes: null, checkedAt: null, checkedById: null },
    });
  }

  async addPhoto(orderId: string, filename: string, url: string, user: any) {
    const order = await this.findOne(orderId, user);
    if (!([OrderStatus.READY, OrderStatus.IN_TRANSIT] as OrderStatus[]).includes(order.status)) {
      throw new BadRequestException('Solo se pueden subir fotos cuando la orden está lista o en camino');
    }
    return this.prisma.shipmentPhoto.create({
      data: { orderId, filename, url, uploadedById: user.id },
    });
  }

  async removePhoto(orderId: string, photoId: string, user: any) {
    await this.findOne(orderId, user);
    const photo = await this.prisma.shipmentPhoto.findUnique({ where: { id: photoId } });
    if (!photo || photo.orderId !== orderId) throw new NotFoundException('Foto no encontrada');
    return this.prisma.shipmentPhoto.delete({ where: { id: photoId } });
  }
}

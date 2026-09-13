import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ProductType, Role, SaleChannel, WorkOrderStatus, FulfillmentType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PosService } from '../pos.service';
import { CreateWorkOrderDto, UpdateWorkOrderDto, ConvertWorkOrderDto, WorkOrderItemDto } from './work-orders.dto';

// Categoría con la que se crean (y reutilizan) los "productos" de servicio auto-generados
// para las líneas libres de una orden de trabajo (p.ej. mano de obra) al convertirla en
// venta — SaleItem exige un producto real, así que cada cargo sin SKU queda respaldado por
// uno de tipo SERVICIO (sin stock) en vez de tocar el modelo de Venta.
const WORK_ORDER_SERVICE_CATEGORY = 'Órdenes de trabajo (servicio)';

@Injectable()
export class WorkOrdersService {
  constructor(
    private prisma: PrismaService,
    private posService: PosService,
  ) {}

  private resolveCompanyId(user: any, companyId?: string): string {
    if (user.role === Role.SUPER_ADMIN) {
      if (!companyId) throw new BadRequestException('companyId requerido para Super Admin');
      return companyId;
    }
    if (!user.companyId) throw new ForbiddenException('Sin empresa asignada');
    return user.companyId;
  }

  private async buildItemsData(items: WorkOrderItemDto[], companyId: string) {
    const productIds = items.map((i) => i.productId).filter((id): id is string => !!id);
    const products = productIds.length
      ? await this.prisma.product.findMany({ where: { id: { in: productIds }, companyId } })
      : [];

    return items.map((item) => {
      if (!item.productId) {
        return {
          productId: null,
          productName: item.productName,
          productSku: item.productSku || null,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          reservedWarehouseId: null,
        };
      }
      const product = products.find((p) => p.id === item.productId);
      if (!product) throw new BadRequestException(`Producto ${item.productId} no encontrado`);
      return {
        productId: product.id,
        productName: product.name,
        productSku: product.sku,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        // Se reserva contra la bodega por defecto del producto al momento de crear la
        // línea; si el producto no tiene bodega asignada, simplemente no hay nada que
        // reservar (no bloquea la orden de trabajo).
        reservedWarehouseId: product.warehouseId,
      };
    });
  }

  // Fase 3 (inventario central): reserva/libera cantidad en ProductStock.reserved para las
  // líneas que sí tienen producto + bodega. No descuenta "quantity" (existencia real) — eso
  // sigue pasando solo cuando la orden se convierte en venta, vía el flujo de POS de siempre.
  private async adjustReservation(
    tx: any,
    items: Array<{ productId: string | null; quantity: number; reservedWarehouseId: string | null }>,
    delta: 1 | -1,
  ) {
    for (const item of items) {
      if (!item.productId || !item.reservedWarehouseId) continue;
      if (delta > 0) {
        await tx.productStock.upsert({
          where: { productId_warehouseId: { productId: item.productId, warehouseId: item.reservedWarehouseId } },
          update: { reserved: { increment: item.quantity } },
          create: { productId: item.productId, warehouseId: item.reservedWarehouseId, quantity: 0, reserved: item.quantity },
        });
      } else {
        const row = await tx.productStock.findUnique({
          where: { productId_warehouseId: { productId: item.productId, warehouseId: item.reservedWarehouseId } },
        });
        if (!row) continue;
        await tx.productStock.update({
          where: { id: row.id },
          // Nunca negativo: protege contra una liberación duplicada o desincronizada.
          data: { reserved: Math.max(0, row.reserved - item.quantity) },
        });
      }
    }
  }

  async create(dto: CreateWorkOrderDto, user: any) {
    const companyId = this.resolveCompanyId(user, dto.companyId);
    if (!dto.items?.length) throw new BadRequestException('Agrega al menos un ítem a la orden de trabajo');

    if (dto.clientId) {
      const client = await this.prisma.client.findUnique({ where: { id: dto.clientId } });
      if (!client || client.companyId !== companyId) throw new BadRequestException('Cliente no válido para esta empresa');
    }

    const itemsData = await this.buildItemsData(dto.items, companyId);

    const agg = await this.prisma.workOrder.aggregate({ where: { companyId }, _max: { folio: true } });
    const folio = (agg._max.folio || 0) + 1;

    return this.prisma.$transaction(async (tx) => {
      const workOrder = await tx.workOrder.create({
        data: {
          folio,
          companyId,
          clientId: dto.clientId || null,
          userId: user.id,
          customerName: dto.customerName || null,
          customerPhone: dto.customerPhone || null,
          customerEmail: dto.customerEmail || null,
          notes: dto.notes || null,
          items: { create: itemsData },
        },
        include: { items: true, client: true, user: { select: { id: true, name: true } } },
      });
      await this.adjustReservation(tx, itemsData, 1);
      return workOrder;
    });
  }

  async findAllPaginated(user: any, query: { companyId?: string; status?: string; page?: string; search?: string }) {
    const companyId = user.role === Role.SUPER_ADMIN ? query.companyId : user.companyId;
    const where: any = {};
    if (companyId) where.companyId = companyId;
    if (query.status) where.status = query.status;
    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { customerName: { contains: term, mode: 'insensitive' } },
        { client: { name: { contains: term, mode: 'insensitive' } } },
      ];
      const folioNum = Number(term);
      if (!Number.isNaN(folioNum)) where.OR.push({ folio: folioNum });
    }

    const page = Math.max(1, parseInt(query.page || '1'));
    const take = 30;
    const skip = (page - 1) * take;

    const [workOrders, total] = await Promise.all([
      this.prisma.workOrder.findMany({
        where,
        include: { items: true, client: true, user: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.workOrder.count({ where }),
    ]);
    return { workOrders, total, page, pages: Math.ceil(total / take) };
  }

  private async getOwned(id: string, user: any) {
    const workOrder = await this.prisma.workOrder.findUnique({
      where: { id },
      include: {
        items: true,
        client: true,
        user: { select: { id: true, name: true } },
        sale: { select: { id: true, total: true, createdAt: true } },
      },
    });
    if (!workOrder) throw new NotFoundException('Orden de trabajo no encontrada');
    if (user.role !== Role.SUPER_ADMIN && workOrder.companyId !== user.companyId) throw new ForbiddenException();
    return workOrder;
  }

  async findOne(id: string, user: any) {
    return this.getOwned(id, user);
  }

  async update(id: string, dto: UpdateWorkOrderDto, user: any) {
    const workOrder = await this.getOwned(id, user);
    if (workOrder.status !== WorkOrderStatus.PENDING) {
      throw new BadRequestException('Solo se pueden editar órdenes de trabajo pendientes');
    }
    if (dto.clientId) {
      const client = await this.prisma.client.findUnique({ where: { id: dto.clientId } });
      if (!client || client.companyId !== workOrder.companyId) throw new BadRequestException('Cliente no válido para esta empresa');
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        if (!dto.items.length) throw new BadRequestException('La orden debe tener al menos un ítem');
        // Se libera lo reservado con los ítems viejos y se reserva de nuevo con los
        // nuevos — más simple y seguro que tratar de calcular solo la diferencia.
        await this.adjustReservation(tx, workOrder.items, -1);
        const itemsData = await this.buildItemsData(dto.items, workOrder.companyId);
        await tx.workOrderItem.deleteMany({ where: { workOrderId: id } });
        await tx.workOrderItem.createMany({ data: itemsData.map((d) => ({ ...d, workOrderId: id })) });
        await this.adjustReservation(tx, itemsData, 1);
      }
      return tx.workOrder.update({
        where: { id },
        data: {
          ...(dto.clientId !== undefined ? { clientId: dto.clientId || null } : {}),
          ...(dto.customerName !== undefined ? { customerName: dto.customerName || null } : {}),
          ...(dto.customerPhone !== undefined ? { customerPhone: dto.customerPhone || null } : {}),
          ...(dto.customerEmail !== undefined ? { customerEmail: dto.customerEmail || null } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes || null } : {}),
        },
        include: { items: true, client: true, user: { select: { id: true, name: true } } },
      });
    });
  }

  async reject(id: string, user: any) {
    const workOrder = await this.getOwned(id, user);
    if (workOrder.status !== WorkOrderStatus.PENDING) {
      throw new BadRequestException('Solo se pueden rechazar órdenes de trabajo pendientes');
    }
    return this.prisma.$transaction(async (tx) => {
      await this.adjustReservation(tx, workOrder.items, -1);
      return tx.workOrder.update({
        where: { id },
        data: { status: WorkOrderStatus.REJECTED, closedAt: new Date() },
      });
    });
  }

  async cancel(id: string, user: any) {
    const workOrder = await this.getOwned(id, user);
    if (workOrder.status !== WorkOrderStatus.PENDING) {
      throw new BadRequestException('Solo se pueden anular órdenes de trabajo pendientes');
    }
    return this.prisma.$transaction(async (tx) => {
      await this.adjustReservation(tx, workOrder.items, -1);
      return tx.workOrder.update({
        where: { id },
        data: { status: WorkOrderStatus.CANCELLED, closedAt: new Date() },
      });
    });
  }

  // El cliente aceptó el presupuesto: se cobra (misma lógica que una venta POS normal, con
  // boleta/factura/sin documento a elección del frontend después de esto) y recién ahí se
  // descuenta stock. Las líneas libres (sin productId) se respaldan con un producto tipo
  // SERVICIO auto-generado/reutilizado, ya que una venta siempre requiere un producto real.
  async convertToSale(id: string, dto: ConvertWorkOrderDto, user: any) {
    const workOrder = await this.getOwned(id, user);
    if (workOrder.status !== WorkOrderStatus.PENDING) {
      throw new BadRequestException('Esta orden de trabajo ya fue procesada');
    }

    const saleItems: { productId: string; quantity: number; unitPrice: number }[] = [];
    for (const item of workOrder.items) {
      if (item.productId) {
        saleItems.push({ productId: item.productId, quantity: item.quantity, unitPrice: Number(item.unitPrice) });
        continue;
      }
      let serviceProduct = await this.prisma.product.findFirst({
        where: {
          companyId: workOrder.companyId,
          type: ProductType.SERVICIO,
          category: WORK_ORDER_SERVICE_CATEGORY,
          name: item.productName,
        },
      });
      if (!serviceProduct) {
        const sku = `OT-SRV-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        serviceProduct = await this.prisma.product.create({
          data: {
            sku,
            name: item.productName,
            type: ProductType.SERVICIO,
            price: item.unitPrice,
            stock: 0,
            category: WORK_ORDER_SERVICE_CATEGORY,
            companyId: workOrder.companyId,
          },
        });
      }
      saleItems.push({ productId: serviceProduct.id, quantity: item.quantity, unitPrice: Number(item.unitPrice) });
    }

    const sale = await this.posService.createSale({
      channel: SaleChannel.POS,
      paymentMethod: dto.paymentMethod,
      clientId: workOrder.clientId || undefined,
      customerName: workOrder.customerName || undefined,
      customerPhone: workOrder.customerPhone || undefined,
      customerEmail: workOrder.customerEmail || undefined,
      notes: workOrder.notes || undefined,
      companyId: workOrder.companyId,
      items: saleItems,
      // Sin esto createSale no genera la Orden de despacho/retiro (el gate es
      // "if (dto.fulfillmentType)") — una orden de trabajo siempre es retiro en
      // mostrador, no hay dirección de entrega que capturar.
      fulfillmentType: FulfillmentType.PICKUP,
    }, user);

    // La reserva se libera recién ahora que la venta ya se concretó — createSale ya
    // descontó la existencia real, así que "reserved" pasa a consumido, no a disponible.
    await this.prisma.$transaction(async (tx) => {
      await this.adjustReservation(tx, workOrder.items, -1);
      await tx.workOrder.update({
        where: { id },
        data: { status: WorkOrderStatus.CONVERTED, saleId: sale.id, convertedAt: new Date() },
      });
    });

    return sale;
  }
}

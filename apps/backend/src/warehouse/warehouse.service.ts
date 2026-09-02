import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { OrderStatus, PrepStage, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { companyWhere, assertSameCompany } from '../common/tenant';
import {
  AssignDto,
  ResetAssignmentsDto,
  ScanDto,
  PickItemDto,
  OutOfStockDto,
  FlowListDto,
} from './dto/warehouse.dto';

const MANAGER_ROLES: Role[] = [
  Role.SUPER_ADMIN,
  Role.COMPANY_ADMIN,
  Role.CATALOG_MANAGER,
];
const PICKING_STAGES: PrepStage[] = [PrepStage.ASSIGNED, PrepStage.PICKING];
const PACKING_STAGES: PrepStage[] = [PrepStage.PICKED, PrepStage.PACKING];

const ORDER_CARD_INCLUDE = {
  itemChecks: {
    include: { product: { select: { id: true, name: true, sku: true } } },
    orderBy: { productName: 'asc' as const },
  },
  assignedTo: { select: { id: true, name: true } },
  pickedBy: { select: { id: true, name: true } },
  packedBy: { select: { id: true, name: true } },
  warehouse: { select: { id: true, name: true } },
  sale: { select: { id: true, channel: true, externalId: true } },
};

@Injectable()
export class WarehouseService {
  constructor(private prisma: PrismaService) {}

  /** where base con aislamiento por empresa (+ bodega opcional). */
  private baseWhere(user: any, warehouseId?: string) {
    const where: any = companyWhere(user);
    if (warehouseId) where.warehouseId = warehouseId;
    return where;
  }

  private isManager(user: any) {
    return MANAGER_ROLES.includes(user.role);
  }

  private guardOrder(order: any, user: any) {
    assertSameCompany(order, user);
  }

  // ── Tablero ────────────────────────────────────────────────────────────────
  async board(user: any, warehouseId?: string) {
    const base = this.baseWhere(user, warehouseId);
    const inPrep = {
      ...base,
      status: { in: [OrderStatus.PENDING, OrderStatus.PREPARING] },
    };

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [
      unassigned,
      assigned,
      picking,
      picked,
      packing,
      packedToday,
      collaborators,
      packedTodayRows,
    ] = await Promise.all([
      this.prisma.order.count({
        where: { ...inPrep, prepStage: PrepStage.UNASSIGNED },
      }),
      this.prisma.order.count({
        where: { ...inPrep, prepStage: PrepStage.ASSIGNED },
      }),
      this.prisma.order.count({
        where: { ...inPrep, prepStage: PrepStage.PICKING },
      }),
      this.prisma.order.count({
        where: { ...inPrep, prepStage: PrepStage.PICKED },
      }),
      this.prisma.order.count({
        where: { ...inPrep, prepStage: PrepStage.PACKING },
      }),
      this.prisma.order.count({
        where: { ...base, packedAt: { gte: startOfDay } },
      }),
      this.listCollaborators(user),
      this.prisma.order.findMany({
        where: { ...base, packedAt: { gte: startOfDay } },
        select: { packedAt: true, packedById: true },
      }),
    ]);

    const totalInPrep = unassigned + assigned + picking + picked + packing;
    const pickDone = picked + packing; // ya salieron de picking
    const pickPending = assigned + picking;
    const packPending = picked + packing;

    // Curva de empacado por hora (día actual)
    const throughput = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      packed: 0,
    }));
    for (const r of packedTodayRows) {
      if (r.packedAt) throughput[new Date(r.packedAt).getHours()].packed += 1;
    }

    // Conteos por colaborador (hoy)
    const perUser = new Map<
      string,
      { assigned: number; picked: number; packed: number }
    >();
    const bump = (id: string | null, key: 'assigned' | 'picked' | 'packed') => {
      if (!id) return;
      const e = perUser.get(id) || { assigned: 0, picked: 0, packed: 0 };
      e[key] += 1;
      perUser.set(id, e);
    };
    const [assignedRows, pickedRows] = await Promise.all([
      this.prisma.order.findMany({
        where: { ...inPrep, assignedAt: { gte: startOfDay } },
        select: { assignedToId: true },
      }),
      this.prisma.order.findMany({
        where: { ...base, pickedAt: { gte: startOfDay } },
        select: { pickedById: true },
      }),
    ]);
    assignedRows.forEach((r) => bump(r.assignedToId, 'assigned'));
    pickedRows.forEach((r) => bump(r.pickedById, 'picked'));
    packedTodayRows.forEach((r) => bump(r.packedById, 'packed'));

    return {
      reparto: { unassigned, assignedToday: assignedRows.length },
      flow: {
        picking: {
          done: pickDone,
          pending: pickPending,
          pct: totalInPrep ? Math.round((pickDone / totalInPrep) * 100) : 0,
        },
        packing: {
          done: packedToday,
          pending: packPending,
          pct: totalInPrep
            ? Math.round(((totalInPrep - packPending) / totalInPrep) * 100)
            : 0,
        },
      },
      packedToday,
      throughput,
      collaborators: collaborators.map((c) => ({
        id: c.id,
        name: c.name,
        role: c.role,
        active: !!perUser.get(c.id),
        ...(perUser.get(c.id) || { assigned: 0, picked: 0, packed: 0 }),
      })),
    };
  }

  private async listCollaborators(user: any) {
    const where: any = {
      active: true,
      role: {
        in: [
          Role.COMPANY_ADMIN,
          Role.CATALOG_MANAGER,
          Role.VENDEDOR,
          Role.DESPACHADOR,
        ],
      },
    };
    if (user.role !== Role.SUPER_ADMIN) where.companyId = user.companyId;
    return this.prisma.user.findMany({
      where,
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });
  }

  // ── Asignación ─────────────────────────────────────────────────────────────
  async assign(user: any, dto: AssignDto) {
    const base = this.baseWhere(user, dto.warehouseId);

    // Validar que los colaboradores pertenecen a la misma empresa.
    const collabs = await this.prisma.user.findMany({
      where: {
        id: { in: dto.userIds },
        active: true,
        ...(user.role !== Role.SUPER_ADMIN
          ? { companyId: user.companyId }
          : {}),
      },
      select: { id: true, companyId: true },
    });
    if (collabs.length !== dto.userIds.length) {
      throw new BadRequestException('Uno o más colaboradores no son válidos');
    }

    const targetWhere: any = {
      ...base,
      status: { in: [OrderStatus.PENDING, OrderStatus.PREPARING] },
      prepStage: PrepStage.UNASSIGNED,
    };
    if (dto.orderIds?.length) targetWhere.id = { in: dto.orderIds };

    const orders = await this.prisma.order.findMany({
      where: targetWhere,
      select: { id: true, companyId: true },
      orderBy: { createdAt: 'asc' },
    });
    if (orders.length === 0) return { assigned: 0 };

    // Si son de varias empresas (solo posible para SUPER_ADMIN sin filtro), agrupamos:
    // cada colaborador debe ser de la empresa del pedido. Para simplificar y evitar
    // cruces, exigimos que todos los pedidos objetivo sean de la misma empresa.
    const companies = new Set(orders.map((o) => o.companyId));
    if (companies.size > 1) {
      throw new BadRequestException(
        'Filtra por bodega/empresa: hay pedidos de varias empresas',
      );
    }

    const now = new Date();
    let i = 0;
    await this.prisma.$transaction(
      orders.map((o) =>
        this.prisma.order.update({
          where: { id: o.id },
          data: {
            assignedToId: dto.userIds[i++ % dto.userIds.length],
            assignedAt: now,
            prepStage: PrepStage.ASSIGNED,
            status: OrderStatus.PREPARING,
          },
        }),
      ),
    );
    return { assigned: orders.length };
  }

  async resetAssignments(user: any, dto: ResetAssignmentsDto) {
    const base = this.baseWhere(user, dto.warehouseId);
    // Solo revierte lo que aún no entró a picking real (sin ítems marcados).
    const res = await this.prisma.order.updateMany({
      where: {
        ...base,
        prepStage: PrepStage.ASSIGNED,
        pickedAt: null,
        itemChecks: { none: { checked: true } },
      },
      data: {
        assignedToId: null,
        assignedAt: null,
        prepStage: PrepStage.UNASSIGNED,
      },
    });
    return { reverted: res.count };
  }

  // ── Picking ────────────────────────────────────────────────────────────────
  private pickingWhere(user: any, opts: FlowListDto) {
    const base = this.baseWhere(user, opts.warehouseId);
    const where: any = {
      ...base,
      status: OrderStatus.PREPARING,
      prepStage: { in: [PrepStage.ASSIGNED, PrepStage.PICKING] },
    };
    const onlyMine = opts.mine === 'true' || !this.isManager(user);
    if (onlyMine) where.assignedToId = user.id;
    return where;
  }

  async pickingList(user: any, opts: FlowListDto) {
    return this.prisma.order.findMany({
      where: this.pickingWhere(user, opts),
      include: ORDER_CARD_INCLUDE,
      orderBy: [{ assignedAt: 'asc' }, { createdAt: 'asc' }],
      take: 200,
    });
  }

  private async loadOrderForFlow(user: any, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: ORDER_CARD_INCLUDE,
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    this.guardOrder(order, user);
    return order;
  }

  /** Resuelve un código a un pedido por id / trackingCode / nº de venta del canal. */
  private async resolveOrder(user: any, code: string, warehouseId?: string) {
    const base = this.baseWhere(user, warehouseId);
    const c = code.trim();
    return this.prisma.order.findFirst({
      where: {
        ...base,
        OR: [{ id: c }, { trackingCode: c }, { sale: { externalId: c } }],
      },
      include: ORDER_CARD_INCLUDE,
    });
  }

  async pickingScan(user: any, dto: ScanDto) {
    const code = dto.code.trim();
    if (!code) throw new BadRequestException('Código vacío');

    // 1) ¿Es un pedido? -> devolver su checklist
    const order = await this.resolveOrder(user, code, dto.warehouseId);
    if (order) {
      if (!PICKING_STAGES.includes(order.prepStage)) {
        return {
          kind: 'order',
          order,
          message: `El pedido ya está en etapa ${order.prepStage}`,
        };
      }
      if (!this.isManager(user) && order.assignedToId !== user.id) {
        throw new ForbiddenException(
          'Este pedido está asignado a otra persona',
        );
      }
      return { kind: 'order', order };
    }

    // 2) Tratar como SKU: marcar 1 unidad en el ítem pendiente más antiguo de mis pedidos
    const where = this.pickingWhere(user, { warehouseId: dto.warehouseId });
    const candidate = await this.prisma.orderItemCheck.findFirst({
      where: {
        checked: false,
        outOfStock: false,
        product: { sku: code },
        order: where,
      },
      orderBy: { order: { assignedAt: 'asc' } },
      include: { order: true },
    });
    if (!candidate) {
      return { kind: 'unmatched', message: `Sin coincidencia para "${code}"` };
    }

    const nextQty = Math.min(
      (candidate.checkedQty ?? 0) + 1,
      candidate.expectedQty,
    );
    await this.prisma.orderItemCheck.update({
      where: { id: candidate.id },
      data: {
        checkedQty: nextQty,
        checked: nextQty >= candidate.expectedQty,
        checkedById: user.id,
        checkedAt: new Date(),
      },
    });
    await this.bumpToPicking(candidate.orderId);
    const order2 = await this.loadOrderForFlow(user, candidate.orderId);
    return {
      kind: 'item',
      order: order2,
      itemId: candidate.id,
      message: `+1 ${code}`,
    };
  }

  private async bumpToPicking(orderId: string) {
    await this.prisma.order.updateMany({
      where: { id: orderId, prepStage: PrepStage.ASSIGNED },
      data: { prepStage: PrepStage.PICKING },
    });
  }

  async pickItem(user: any, orderId: string, itemId: string, dto: PickItemDto) {
    const order = await this.loadOrderForFlow(user, orderId);
    if (!this.isManager(user) && order.assignedToId !== user.id) {
      throw new ForbiddenException('Pedido asignado a otra persona');
    }
    const item = order.itemChecks.find((i: any) => i.id === itemId);
    if (!item) throw new NotFoundException('Ítem no encontrado');

    const qty = Math.max(0, Math.min(dto.pickedQty, item.expectedQty));
    await this.prisma.orderItemCheck.update({
      where: { id: itemId },
      data: {
        checkedQty: qty,
        checked: qty >= item.expectedQty,
        notes: dto.notes ?? item.notes,
        checkedById: user.id,
        checkedAt: new Date(),
      },
    });
    await this.bumpToPicking(orderId);
    return this.loadOrderForFlow(user, orderId);
  }

  async setOutOfStock(
    user: any,
    orderId: string,
    itemId: string,
    dto: OutOfStockDto,
  ) {
    const order = await this.loadOrderForFlow(user, orderId);
    const item = order.itemChecks.find((i: any) => i.id === itemId);
    if (!item) throw new NotFoundException('Ítem no encontrado');
    await this.prisma.orderItemCheck.update({
      where: { id: itemId },
      data: { outOfStock: dto.outOfStock, notes: dto.notes ?? item.notes },
    });
    return this.loadOrderForFlow(user, orderId);
  }

  async completePicking(user: any, orderId: string) {
    const order = await this.loadOrderForFlow(user, orderId);
    if (!this.isManager(user) && order.assignedToId !== user.id) {
      throw new ForbiddenException('Pedido asignado a otra persona');
    }
    const pending = order.itemChecks.filter(
      (i: any) => !i.checked && !i.outOfStock,
    );
    if (pending.length > 0) {
      throw new BadRequestException(
        `Faltan ${pending.length} ítem(s) por pickear o marcar sin stock`,
      );
    }
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        prepStage: PrepStage.PICKED,
        pickedById: user.id,
        pickedAt: new Date(),
      },
    });
    return this.loadOrderForFlow(user, orderId);
  }

  // ── Packing ────────────────────────────────────────────────────────────────
  private packingWhere(user: any, opts: FlowListDto) {
    const base = this.baseWhere(user, opts.warehouseId);
    return {
      ...base,
      status: OrderStatus.PREPARING,
      prepStage: { in: [PrepStage.PICKED, PrepStage.PACKING] },
    };
  }

  async packingList(user: any, opts: FlowListDto) {
    return this.prisma.order.findMany({
      where: this.packingWhere(user, opts),
      include: ORDER_CARD_INCLUDE,
      orderBy: [{ pickedAt: 'asc' }, { createdAt: 'asc' }],
      take: 200,
    });
  }

  async packingScan(user: any, dto: ScanDto) {
    const order = await this.resolveOrder(user, dto.code, dto.warehouseId);
    if (!order)
      return {
        kind: 'unmatched',
        message: `Sin coincidencia para "${dto.code}"`,
      };
    if (!PACKING_STAGES.includes(order.prepStage)) {
      return {
        kind: 'order',
        order,
        message: `El pedido está en etapa ${order.prepStage}, no listo para empacar`,
      };
    }
    return this.confirmPacked(user, order.id);
  }

  async confirmPacked(user: any, orderId: string) {
    const order = await this.loadOrderForFlow(user, orderId);
    if (!PACKING_STAGES.includes(order.prepStage)) {
      throw new BadRequestException(
        `El pedido está en etapa ${order.prepStage}`,
      );
    }
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        prepStage: PrepStage.PACKED,
        packedById: user.id,
        packedAt: new Date(),
        status: OrderStatus.READY,
      },
    });
    const fresh = await this.loadOrderForFlow(user, orderId);
    return {
      kind: 'packed',
      order: fresh,
      message: 'Pedido empacado y marcado como Listo',
    };
  }
}

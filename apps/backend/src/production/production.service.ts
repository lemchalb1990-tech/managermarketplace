import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  MovementType, OrderEventSource, OrderStatus, PaymentMethod, Prisma, ProductType, ProductionOrderKind,
  ProductionOrderStatus, ProductionStageStatus, Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockLedgerService } from '../purchases/stock-ledger.service';
import { StorageService } from '../common/storage/storage.service';
import { SyncService } from '../ecommerce/sync/sync.service';
import { isSuperAdmin } from '../common/tenant';
import { matchesModule } from '../common/modules.util';
import { ProductionConfigService, readProductionSettings } from './production-config.service';
import { newTrackingToken, nextOrderNumber, planMaterials, stagesFromProcess } from './production.util';

type Tx = Prisma.TransactionClient;

const OPEN: ProductionOrderStatus[] = ['PENDING', 'IN_PROGRESS', 'WAITING_APPROVAL', 'ON_HOLD'];
const FINISHED_STAGE: ProductionStageStatus[] = ['DONE', 'SKIPPED'];

export const KIND_LABEL: Record<ProductionOrderKind, string> = {
  MADE_TO_ORDER: 'A pedido',
  FOR_STOCK: 'Para stock',
  REPAIR: 'Reparación',
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const actor = (user: any) => user?.name ?? user?.email ?? 'Usuario';

export interface CreateOrderInput {
  companyId?: string;
  kind: ProductionOrderKind;
  productId?: string | null;
  productName?: string | null;
  quantity?: number;
  processId?: string | null;
  clientId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  specs?: Record<string, string> | null;
  repairInfo?: Record<string, string> | null;
  dueDate?: string | null;
  warehouseId?: string | null;
  notes?: string | null;
  priority?: number;
}

@Injectable()
export class ProductionService {
  private readonly logger = new Logger(ProductionService.name);

  constructor(
    private prisma: PrismaService,
    private config: ProductionConfigService,
    private ledger: StockLedgerService,
    private storage: StorageService,
    private sync: SyncService,
  ) {}

  // ── Helpers ──────────────────────────────────────────────────────────

  private async event(tx: Tx | PrismaService, orderId: string, type: string, message: string, opts: { stageName?: string | null; customerVisible?: boolean; notifyCustomer?: boolean; actorName?: string | null } = {}) {
    await tx.productionEvent.create({
      data: {
        orderId, type, message,
        stageName: opts.stageName ?? null,
        customerVisible: !!opts.customerVisible,
        // Queda marcado para los avisos automáticos; mientras estén apagados no se envía nada.
        notifyCustomer: !!opts.notifyCustomer,
        actorName: opts.actorName ?? null,
      },
    });
  }

  private async owned(user: any, id: string) {
    const order = await this.prisma.productionOrder.findUnique({ where: { id }, select: { id: true, companyId: true, status: true } });
    if (!order || (!isSuperAdmin(user) && order.companyId !== user.companyId)) throw new NotFoundException('Orden de fabricación no encontrada');
    await this.config.companyFor(user, order.companyId);
    return order;
  }

  private assertOpen(status: ProductionOrderStatus) {
    if (!OPEN.includes(status)) throw new BadRequestException('La orden ya está terminada o anulada');
  }

  private currentStage<T extends { status: ProductionStageStatus; position: number }>(stages: T[]): T | null {
    return [...stages].sort((a, b) => a.position - b.position).find((s) => !FINISHED_STAGE.includes(s.status)) ?? null;
  }

  private progress(stages: { status: ProductionStageStatus }[]) {
    if (!stages.length) return 0;
    return Math.round((stages.filter((s) => FINISHED_STAGE.includes(s.status)).length / stages.length) * 100);
  }

  private summary(o: any) {
    const stage: any = this.currentStage((o.stages || []) as any[]);
    return {
      id: o.id, number: o.number, kind: o.kind, kindLabel: KIND_LABEL[o.kind as ProductionOrderKind], status: o.status, priority: o.priority,
      productName: o.productName, productId: o.productId, quantity: o.quantity,
      customerName: o.customerName, customerPhone: o.customerPhone, customerEmail: o.customerEmail,
      dueDate: o.dueDate, createdAt: o.createdAt, completedAt: o.completedAt,
      overdue: !!o.dueDate && OPEN.includes(o.status) && new Date(o.dueDate).getTime() < Date.now(),
      processId: o.processId, processName: o.process?.name ?? null,
      currentStage: stage ? { id: stage.id, name: stage.name, status: stage.status, areaName: stage.area?.name ?? null, assignedToName: stage.assignedToName ?? null, dueDate: stage.dueDate } : null,
      progress: this.progress(o.stages || []),
      stagesCount: (o.stages || []).length,
      saleId: o.saleId, saleNumber: o.sale?.saleNumber ?? null, balanceDue: o.sale?.balanceDue != null ? Number(o.sale.balanceDue) : null,
      trackingToken: o.trackingToken,
      reopenedFromId: o.reopenedFromId,
    };
  }

  private listInclude = {
    stages: { orderBy: { position: 'asc' as const }, include: { area: { select: { id: true, name: true } } } },
    process: { select: { id: true, name: true } },
    sale: { select: { saleNumber: true, balanceDue: true } },
  };

  // ── Listado, tablero y detalle ───────────────────────────────────────

  async list(user: any, q: { companyId?: string; status?: string; kind?: string; processId?: string; search?: string; open?: string; overdue?: string; page?: string }) {
    const cId = await this.config.companyFor(user, q.companyId);
    const where: Prisma.ProductionOrderWhereInput = { companyId: cId };
    if (q.status && (Object.values(ProductionOrderStatus) as string[]).includes(q.status)) where.status = q.status as ProductionOrderStatus;
    else if (q.open === 'true') where.status = { in: OPEN };
    if (q.kind && (Object.values(ProductionOrderKind) as string[]).includes(q.kind)) where.kind = q.kind as ProductionOrderKind;
    if (q.processId) where.processId = q.processId;
    if (q.overdue === 'true') { where.status = { in: OPEN }; where.dueDate = { lt: new Date() }; }
    const search = q.search?.trim();
    if (search) {
      const n = Number(search.replace(/^#|^OF-?/i, ''));
      where.OR = [
        { productName: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        ...(Number.isInteger(n) && n > 0 ? [{ number: n }] : []),
      ];
    }
    const page = Math.max(1, Number(q.page) || 1);
    const take = 40;
    const [rows, total] = await Promise.all([
      this.prisma.productionOrder.findMany({ where, include: this.listInclude, orderBy: [{ status: 'asc' }, { dueDate: { sort: 'asc', nulls: 'last' } }, { number: 'desc' }], skip: (page - 1) * take, take }),
      this.prisma.productionOrder.count({ where }),
    ]);
    return { items: rows.map((r) => this.summary(r)), total, page, pages: Math.max(1, Math.ceil(total / take)) };
  }

  /** Tablero: órdenes abiertas (y terminadas en los últimos 7 días). Con proceso, columnas por etapa. */
  async board(user: any, q: { companyId?: string; processId?: string }) {
    const cId = await this.config.companyFor(user, q.companyId);
    const since = new Date(Date.now() - 7 * 24 * 3600_000);
    const rows = await this.prisma.productionOrder.findMany({
      where: {
        companyId: cId,
        ...(q.processId ? { processId: q.processId } : {}),
        OR: [{ status: { in: OPEN } }, { status: 'DONE', completedAt: { gte: since } }],
      },
      include: this.listInclude,
      orderBy: [{ priority: 'desc' }, { dueDate: { sort: 'asc', nulls: 'last' } }],
      take: 500,
    });
    const stats = {
      open: rows.filter((r) => OPEN.includes(r.status)).length,
      overdue: rows.filter((r) => r.dueDate && OPEN.includes(r.status) && r.dueDate.getTime() < Date.now()).length,
      waitingApproval: rows.filter((r) => r.status === 'WAITING_APPROVAL').length,
      doneWeek: rows.filter((r) => r.status === 'DONE').length,
    };
    return { items: rows.map((r) => this.summary(r)), stats };
  }

  async get(user: any, id: string) {
    await this.owned(user, id);
    const o = await this.prisma.productionOrder.findUnique({
      where: { id },
      include: {
        stages: { orderBy: { position: 'asc' }, include: { area: { select: { id: true, name: true, hourlyCost: true } } } },
        process: { select: { id: true, name: true, isRepair: true } },
        product: { select: { id: true, name: true, sku: true, specFields: true, stock: true, warehouseId: true, supplyMode: true } },
        sale: {
          select: {
            id: true, saleNumber: true, total: true, balanceDue: true, channel: true, externalId: true, createdAt: true,
            payments: { select: { id: true, method: true, amount: true, isBalance: true, reference: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
            order: { select: { id: true, status: true } },
          },
        },
        saleItem: { select: { unitPrice: true, quantity: true } },
        events: { orderBy: { createdAt: 'desc' }, take: 200 },
        attachments: { orderBy: { createdAt: 'desc' } },
        timeEntries: { orderBy: { workDate: 'desc' } },
        materialUses: { include: { material: { select: { id: true, name: true, sku: true, stock: true } } }, orderBy: { material: { name: 'asc' } } },
        reopenedFrom: { select: { id: true, number: true } },
        warrantyOrders: { select: { id: true, number: true, status: true, warrantyReason: true } },
      },
    });
    if (!o) throw new NotFoundException('Orden de fabricación no encontrada');
    const materialsCost = Number(o.materialsCost);
    const laborCost = Number(o.laborCost);
    const estimatedMaterials = o.materialUses.reduce((s, m) => s + Number(m.plannedQty) * Number(m.unitCost), 0);
    const estimatedLabor = o.stages.reduce((s, st) => s + Number(st.estimatedHours ?? 0) * o.quantity * Number(st.area?.hourlyCost ?? 0), 0);
    const salePrice = o.saleItem ? Number(o.saleItem.unitPrice) * o.saleItem.quantity : null;
    return {
      ...this.summary(o),
      specs: o.specs, repairInfo: o.repairInfo, notes: o.notes, startedAt: o.startedAt, cancelledAt: o.cancelledAt, cancelReason: o.cancelReason,
      warrantyReason: o.warrantyReason, warehouseId: o.warehouseId, clientId: o.clientId, assignedToId: o.assignedToId,
      createdByName: o.createdByName,
      process: o.process,
      product: o.product ? { ...o.product } : null,
      stages: o.stages.map((s) => ({
        id: s.id, position: s.position, name: s.name, status: s.status, areaId: s.areaId, areaName: s.area?.name ?? null,
        estimatedDays: s.estimatedDays != null ? Number(s.estimatedDays) : null, estimatedHours: s.estimatedHours != null ? Number(s.estimatedHours) : null,
        requiresApproval: s.requiresApproval, notifyCustomer: s.notifyCustomer, customerVisible: s.customerVisible,
        checklist: (s.checklist as Array<{ label: string; done: boolean }>) || [],
        dueDate: s.dueDate, startedAt: s.startedAt, completedAt: s.completedAt,
        approvalStatus: s.approvalStatus, approvalNote: s.approvalNote, approvalAt: s.approvalAt,
        assignedToId: s.assignedToId, assignedToName: s.assignedToName,
      })),
      sale: o.sale ? {
        id: o.sale.id, saleNumber: o.sale.saleNumber, total: Number(o.sale.total), balanceDue: o.sale.balanceDue != null ? Number(o.sale.balanceDue) : 0,
        channel: o.sale.channel, externalId: o.sale.externalId, createdAt: o.sale.createdAt, orderId: o.sale.order?.id ?? null, orderStatus: o.sale.order?.status ?? null,
        payments: o.sale.payments.map((p) => ({ ...p, amount: Number(p.amount) })),
      } : null,
      events: o.events,
      attachments: o.attachments,
      timeEntries: o.timeEntries.map((t) => ({ ...t, hourlyCost: Number(t.hourlyCost), cost: round2((t.minutes / 60) * Number(t.hourlyCost)) })),
      materials: o.materialUses.map((m) => ({
        id: m.id, materialId: m.materialId, name: m.material.name, sku: m.material.sku, stock: m.material.stock,
        plannedQty: Number(m.plannedQty), reservedQty: Number(m.reservedQty), consumedQty: Number(m.consumedQty), unitCost: Number(m.unitCost),
        stageName: m.stageName, warehouseId: m.warehouseId,
      })),
      costs: {
        materials: round2(materialsCost), labor: round2(laborCost), total: round2(materialsCost + laborCost),
        estimatedMaterials: round2(estimatedMaterials), estimatedLabor: round2(estimatedLabor), estimatedTotal: round2(estimatedMaterials + estimatedLabor),
        salePrice, margin: salePrice != null ? round2(salePrice - materialsCost - laborCost) : null,
      },
      reopenedFrom: o.reopenedFrom, warrantyOrders: o.warrantyOrders,
    };
  }

  // ── Crear y editar ───────────────────────────────────────────────────

  async create(user: any, dto: CreateOrderInput) {
    const cId = await this.config.companyFor(user, dto.companyId);
    const kind = (Object.values(ProductionOrderKind) as string[]).includes(dto.kind) ? dto.kind : ProductionOrderKind.MADE_TO_ORDER;
    const quantity = Math.max(1, Math.round(Number(dto.quantity) || 1));
    let product: { id: string; name: string; type: ProductType; productionProcessId: string | null; manufacturingDays: number | null; warehouseId: string | null } | null = null;
    if (dto.productId) {
      product = await this.prisma.product.findFirst({ where: { id: dto.productId, companyId: cId }, select: { id: true, name: true, type: true, productionProcessId: true, manufacturingDays: true, warehouseId: true } });
      if (!product) throw new BadRequestException('Producto no válido');
    }
    if (kind === ProductionOrderKind.FOR_STOCK) {
      if (!product || product.type !== ProductType.ARTICULO) throw new BadRequestException('Un lote para stock necesita un artículo del catálogo');
    }
    const productName = product?.name || dto.productName?.trim();
    if (!productName) throw new BadRequestException('Indica qué se fabrica o repara');
    const processId = dto.processId || product?.productionProcessId || null;
    if (processId) {
      const p = await this.prisma.productionProcess.findFirst({ where: { id: processId, companyId: cId } });
      if (!p) throw new BadRequestException('Proceso no válido');
    }
    let warehouseId: string | null = null;
    if (kind === ProductionOrderKind.FOR_STOCK) {
      warehouseId = dto.warehouseId || product!.warehouseId || null;
      if (warehouseId) {
        const wh = await this.prisma.warehouse.findFirst({ where: { id: warehouseId, companyId: cId } });
        if (!wh) throw new BadRequestException('Bodega no válida');
      }
    }
    let client: { name: string; email: string | null; phone: string | null } | null = null;
    if (dto.clientId) {
      const c = await this.prisma.client.findFirst({ where: { id: dto.clientId, companyId: cId } });
      if (!c) throw new BadRequestException('Cliente no válido');
      client = { name: c.name, email: c.email, phone: c.phone };
    }

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const stages = await stagesFromProcess(tx, processId, now);
      const days = product?.manufacturingDays ?? stages.reduce((s, st) => s + Number(st.estimatedDays ?? 0), 0);
      const due = dto.dueDate ? new Date(dto.dueDate) : days > 0 ? new Date(now.getTime() + days * 24 * 3600_000) : null;
      const order = await tx.productionOrder.create({
        data: {
          number: await nextOrderNumber(tx, cId),
          kind, quantity, productName,
          priority: Math.max(0, Math.min(2, Math.round(Number(dto.priority) || 0))),
          specs: (dto.specs ?? undefined) as Prisma.InputJsonValue | undefined,
          repairInfo: (dto.repairInfo ?? undefined) as Prisma.InputJsonValue | undefined,
          notes: dto.notes?.trim() || null,
          dueDate: due && !isNaN(due.getTime()) ? due : null,
          trackingToken: newTrackingToken(),
          customerName: dto.customerName?.trim() || client?.name || null,
          customerEmail: dto.customerEmail?.trim() || client?.email || null,
          customerPhone: dto.customerPhone?.trim() || client?.phone || null,
          clientId: dto.clientId || null,
          companyId: cId,
          productId: product?.id ?? null,
          processId,
          warehouseId,
          createdById: user.id ?? null,
          createdByName: actor(user),
          stages: { create: stages },
        },
      });
      await this.event(tx, order.id, 'CREATED', `Orden creada (${KIND_LABEL[kind]})`, { actorName: actor(user), customerVisible: kind !== 'FOR_STOCK' });
      if (product) await planMaterials(tx, order.id, product.id, quantity);
      return { id: order.id, number: order.number };
    });
  }

  async update(user: any, id: string, dto: Partial<CreateOrderInput> & { assignedToId?: string | null }) {
    const order = await this.owned(user, id);
    const data: Prisma.ProductionOrderUpdateInput = {};
    if (dto.dueDate !== undefined) {
      const d = dto.dueDate ? new Date(dto.dueDate) : null;
      data.dueDate = d && !isNaN(d.getTime()) ? d : null;
    }
    if (dto.priority !== undefined) data.priority = Math.max(0, Math.min(2, Math.round(Number(dto.priority) || 0)));
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;
    if (dto.specs !== undefined) data.specs = (dto.specs ?? Prisma.DbNull) as any;
    if (dto.repairInfo !== undefined) data.repairInfo = (dto.repairInfo ?? Prisma.DbNull) as any;
    if (dto.customerName !== undefined) data.customerName = dto.customerName?.trim() || null;
    if (dto.customerEmail !== undefined) data.customerEmail = dto.customerEmail?.trim() || null;
    if (dto.customerPhone !== undefined) data.customerPhone = dto.customerPhone?.trim() || null;
    if (dto.assignedToId !== undefined) data.assignedToId = dto.assignedToId || null;
    if (dto.quantity !== undefined && order.status === 'PENDING') data.quantity = Math.max(1, Math.round(Number(dto.quantity) || 1));
    await this.prisma.productionOrder.update({ where: { id }, data });
    if (dto.dueDate !== undefined) await this.event(this.prisma, id, 'UPDATED', `Fecha comprometida: ${data.dueDate ? (data.dueDate as Date).toLocaleDateString('es-CL') : 'sin fecha'}`, { actorName: actor(user), customerVisible: true });
    return this.get(user, id);
  }

  // ── Etapas ───────────────────────────────────────────────────────────

  private async stageFor(user: any, orderId: string, stageId: string) {
    const order = await this.owned(user, orderId);
    const stage = await this.prisma.productionOrderStage.findUnique({ where: { id: stageId } });
    if (!stage || stage.orderId !== orderId) throw new NotFoundException('Etapa no encontrada');
    return { order, stage };
  }

  async startStage(user: any, orderId: string, stageId: string) {
    const { order, stage } = await this.stageFor(user, orderId, stageId);
    this.assertOpen(order.status);
    if (order.status === 'ON_HOLD') throw new BadRequestException('La orden está en pausa; reanúdala primero');
    if (stage.status !== 'PENDING') throw new BadRequestException('La etapa ya fue iniciada');
    const settings = await this.settingsFor(order.companyId);
    await this.prisma.$transaction(async (tx) => {
      const first = await tx.productionOrder.findUnique({ where: { id: orderId }, select: { startedAt: true } });
      await tx.productionOrderStage.update({ where: { id: stageId }, data: { status: 'IN_PROGRESS', startedAt: new Date(), assignedToId: stage.assignedToId ?? user.id ?? null, assignedToName: stage.assignedToName ?? actor(user) } });
      await tx.productionOrder.update({ where: { id: orderId }, data: { status: 'IN_PROGRESS', ...(first?.startedAt ? {} : { startedAt: new Date() }) } });
      await this.event(tx, orderId, 'STAGE_STARTED', `Etapa «${stage.name}» iniciada`, { stageName: stage.name, customerVisible: stage.customerVisible, notifyCustomer: stage.notifyCustomer, actorName: actor(user) });
      // Materiales: al iniciar la orden (los sin etapa) o al iniciar la etapa que los usa.
      if (settings.consumeMaterialsAt === 'START' && !first?.startedAt) await this.consumeWhere(tx, orderId, user, () => true);
      if (settings.consumeMaterialsAt === 'STAGE') {
        await this.consumeWhere(tx, orderId, user, (m) => (m.stageName ? m.stageName.toLowerCase() === stage.name.toLowerCase() : !first?.startedAt));
      }
    });
    return this.get(user, orderId);
  }

  async completeStage(user: any, orderId: string, stageId: string) {
    const { order, stage } = await this.stageFor(user, orderId, stageId);
    this.assertOpen(order.status);
    if (FINISHED_STAGE.includes(stage.status)) throw new BadRequestException('La etapa ya está terminada');
    // Etapa con aprobación del cliente: queda esperando su respuesta.
    if (stage.requiresApproval && stage.approvalStatus !== 'APPROVED') {
      await this.prisma.$transaction(async (tx) => {
        await tx.productionOrderStage.update({ where: { id: stageId }, data: { status: 'WAITING_APPROVAL', approvalStatus: 'PENDING', startedAt: stage.startedAt ?? new Date() } });
        await tx.productionOrder.update({ where: { id: orderId }, data: { status: 'WAITING_APPROVAL' } });
        await this.event(tx, orderId, 'APPROVAL_REQUESTED', `«${stage.name}» espera la aprobación del cliente`, { stageName: stage.name, customerVisible: true, notifyCustomer: true, actorName: actor(user) });
      });
      return this.get(user, orderId);
    }
    await this.finishStage(user, orderId, stage, 'DONE');
    return this.get(user, orderId);
  }

  async skipStage(user: any, orderId: string, stageId: string) {
    const { order, stage } = await this.stageFor(user, orderId, stageId);
    this.assertOpen(order.status);
    if (FINISHED_STAGE.includes(stage.status)) throw new BadRequestException('La etapa ya está terminada');
    await this.finishStage(user, orderId, stage, 'SKIPPED');
    return this.get(user, orderId);
  }

  // Vuelve una etapa terminada a «en curso» (corregir un avance por error).
  async reopenStage(user: any, orderId: string, stageId: string) {
    const { order, stage } = await this.stageFor(user, orderId, stageId);
    this.assertOpen(order.status);
    if (!FINISHED_STAGE.includes(stage.status) && stage.status !== 'WAITING_APPROVAL') throw new BadRequestException('La etapa no está terminada');
    await this.prisma.$transaction(async (tx) => {
      await tx.productionOrderStage.update({ where: { id: stageId }, data: { status: 'IN_PROGRESS', completedAt: null } });
      await tx.productionOrder.update({ where: { id: orderId }, data: { status: 'IN_PROGRESS' } });
      await this.event(tx, orderId, 'STAGE_REOPENED', `Etapa «${stage.name}» reabierta`, { stageName: stage.name, actorName: actor(user) });
    });
    return this.get(user, orderId);
  }

  private async finishStage(user: any, orderId: string, stage: { id: string; name: string; customerVisible: boolean; notifyCustomer: boolean; startedAt: Date | null }, status: 'DONE' | 'SKIPPED') {
    await this.prisma.$transaction(async (tx) => {
      await tx.productionOrderStage.update({ where: { id: stage.id }, data: { status, completedAt: new Date(), startedAt: stage.startedAt ?? new Date() } });
      await this.event(tx, orderId, status === 'DONE' ? 'STAGE_DONE' : 'STAGE_SKIPPED', `Etapa «${stage.name}» ${status === 'DONE' ? 'terminada' : 'omitida'}`, {
        stageName: stage.name, customerVisible: stage.customerVisible && status === 'DONE', notifyCustomer: stage.notifyCustomer && status === 'DONE', actorName: actor(user),
      });
      const stages = await tx.productionOrderStage.findMany({ where: { orderId }, select: { status: true } });
      if (stages.some((s) => s.status === 'WAITING_APPROVAL')) await tx.productionOrder.update({ where: { id: orderId }, data: { status: 'WAITING_APPROVAL' } });
      else await tx.productionOrder.update({ where: { id: orderId }, data: { status: 'IN_PROGRESS', startedAt: undefined } });
    });
    // Todas las etapas listas: la orden se termina sola.
    const remaining = await this.prisma.productionOrderStage.count({ where: { orderId, status: { notIn: FINISHED_STAGE } } });
    if (remaining === 0) await this.completeInternal(user, orderId);
  }

  async assignStage(user: any, orderId: string, stageId: string, assignedToId: string | null) {
    const { order } = await this.stageFor(user, orderId, stageId);
    let name: string | null = null;
    if (assignedToId) {
      const u = await this.prisma.user.findFirst({ where: { id: assignedToId, companyId: order.companyId, active: true }, select: { name: true } });
      if (!u) throw new BadRequestException('Usuario no válido');
      name = u.name;
    }
    await this.prisma.productionOrderStage.update({ where: { id: stageId }, data: { assignedToId: assignedToId || null, assignedToName: name } });
    return this.get(user, orderId);
  }

  async updateStage(user: any, orderId: string, stageId: string, dto: { checklist?: Array<{ label: string; done: boolean }>; dueDate?: string | null; areaId?: string | null }) {
    const { order } = await this.stageFor(user, orderId, stageId);
    const data: Prisma.ProductionOrderStageUpdateInput = {};
    if (dto.checklist) data.checklist = dto.checklist.map((c) => ({ label: String(c.label), done: !!c.done })) as unknown as Prisma.InputJsonValue;
    if (dto.dueDate !== undefined) data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    if (dto.areaId !== undefined) {
      if (dto.areaId) {
        const a = await this.prisma.productionArea.findFirst({ where: { id: dto.areaId, companyId: order.companyId } });
        if (!a) throw new BadRequestException('Área no válida');
      }
      data.area = dto.areaId ? { connect: { id: dto.areaId } } : { disconnect: true };
    }
    await this.prisma.productionOrderStage.update({ where: { id: stageId }, data });
    return this.get(user, orderId);
  }

  /** Aprobación registrada por la empresa (el cliente aprobó por teléfono, en persona...). */
  async recordApproval(user: any, orderId: string, stageId: string, approved: boolean, note?: string) {
    const { stage } = await this.stageFor(user, orderId, stageId);
    await this.applyApproval(orderId, stage, approved, note, `${actor(user)} (en nombre del cliente)`, user);
    return this.get(user, orderId);
  }

  private async applyApproval(orderId: string, stage: { id: string; name: string; status: ProductionStageStatus; customerVisible: boolean; notifyCustomer: boolean; startedAt: Date | null }, approved: boolean, note: string | undefined, actorName: string, user: any) {
    if (stage.status !== 'WAITING_APPROVAL') throw new BadRequestException('Esta etapa no está esperando aprobación');
    if (approved) {
      await this.prisma.productionOrderStage.update({ where: { id: stage.id }, data: { approvalStatus: 'APPROVED', approvalNote: note?.trim() || null, approvalAt: new Date() } });
      await this.event(this.prisma, orderId, 'APPROVED', `El cliente aprobó «${stage.name}»${note?.trim() ? `: ${note.trim()}` : ''}`, { stageName: stage.name, customerVisible: true, actorName });
      await this.finishStage(user, orderId, stage, 'DONE');
    } else {
      await this.prisma.$transaction(async (tx) => {
        await tx.productionOrderStage.update({ where: { id: stage.id }, data: { status: 'IN_PROGRESS', approvalStatus: 'CHANGES_REQUESTED', approvalNote: note?.trim() || null, approvalAt: new Date() } });
        await tx.productionOrder.update({ where: { id: orderId }, data: { status: 'IN_PROGRESS' } });
        await this.event(tx, orderId, 'CHANGES_REQUESTED', `El cliente pidió cambios en «${stage.name}»${note?.trim() ? `: ${note.trim()}` : ''}`, { stageName: stage.name, customerVisible: true, actorName });
      });
    }
  }

  async hold(user: any, orderId: string, reason?: string) {
    const order = await this.owned(user, orderId);
    this.assertOpen(order.status);
    await this.prisma.productionOrder.update({ where: { id: orderId }, data: { status: 'ON_HOLD' } });
    await this.event(this.prisma, orderId, 'ON_HOLD', `Orden en pausa${reason?.trim() ? `: ${reason.trim()}` : ''}`, { actorName: actor(user) });
    return this.get(user, orderId);
  }

  async resume(user: any, orderId: string) {
    const order = await this.owned(user, orderId);
    if (order.status !== 'ON_HOLD') throw new BadRequestException('La orden no está en pausa');
    const waiting = await this.prisma.productionOrderStage.count({ where: { orderId, status: 'WAITING_APPROVAL' } });
    const started = await this.prisma.productionOrderStage.count({ where: { orderId, status: { not: 'PENDING' } } });
    await this.prisma.productionOrder.update({ where: { id: orderId }, data: { status: waiting ? 'WAITING_APPROVAL' : started ? 'IN_PROGRESS' : 'PENDING' } });
    await this.event(this.prisma, orderId, 'RESUMED', 'Orden reanudada', { actorName: actor(user) });
    return this.get(user, orderId);
  }

  // ── Término, anulación y garantía ────────────────────────────────────

  private async settingsFor(companyId: string) {
    const c = await this.prisma.company.findUnique({ where: { id: companyId }, select: { productionSettings: true } });
    return readProductionSettings(c?.productionSettings);
  }

  async complete(user: any, orderId: string) {
    const order = await this.owned(user, orderId);
    this.assertOpen(order.status);
    await this.completeInternal(user, orderId);
    return this.get(user, orderId);
  }

  // Término sin validar sesión: lo usan el endpoint y la última etapa (también desde el link del cliente).
  private async completeInternal(user: any, orderId: string) {
    const full = await this.prisma.productionOrder.findUnique({ where: { id: orderId }, include: { product: { select: { id: true, cost: true, stock: true } } } });
    if (!full) throw new NotFoundException('Orden no encontrada');
    if (!OPEN.includes(full.status)) return;
    let stockSynced: { productId: string; stock: number } | null = null;
    await this.prisma.$transaction(async (tx) => {
      // Lo que quedó sin consumir se descuenta al terminar (lo planificado en la lista de materiales).
      await this.consumeWhere(tx, orderId, user, () => true);
      await tx.productionOrderStage.updateMany({ where: { orderId, status: { notIn: FINISHED_STAGE } }, data: { status: 'DONE', completedAt: new Date() } });
      const costs = await this.recalcCosts(tx, orderId);
      await tx.productionOrder.update({ where: { id: orderId }, data: { status: 'DONE', completedAt: new Date() } });
      await this.event(tx, orderId, 'COMPLETED', full.kind === 'FOR_STOCK' ? `Lote terminado: ${full.quantity} unidad(es) a bodega` : 'Fabricación terminada: lista para entregar', {
        customerVisible: full.kind !== 'FOR_STOCK', notifyCustomer: full.kind !== 'FOR_STOCK', actorName: actor(user),
      });
      const total = costs.materials + costs.labor;
      if (full.kind === 'FOR_STOCK' && full.productId) {
        // Lote para stock: el producto terminado entra a bodega al costo real del lote, y el
        // costo del producto queda como promedio ponderado con lo que ya había.
        const unitCost = full.quantity > 0 ? round2(total / full.quantity) : 0;
        const moved = await this.ledger.move(tx, {
          productId: full.productId, warehouseId: full.warehouseId, delta: full.quantity, type: MovementType.PRODUCTION_IN,
          reason: `Fabricación OF-${full.number}`, userId: user?.id, unitCost, reference: { type: 'PRODUCTION', id: orderId, number: `OF-${full.number}` },
        });
        const prevStock = Math.max(0, moved.productStock - full.quantity);
        const prevCost = Number(full.product?.cost ?? 0);
        const avg = unitCost > 0 ? (prevStock * prevCost + full.quantity * unitCost) / Math.max(1, prevStock + full.quantity) : prevCost;
        await tx.product.update({ where: { id: full.productId }, data: { cost: round2(avg) } });
        stockSynced = { productId: full.productId, stock: moved.productStock };
      }
      if (full.saleItemId && total > 0) {
        // Venta a pedido: el costo real de fabricación pasa a la línea (Rentabilidad).
        await tx.saleItem.update({ where: { id: full.saleItemId }, data: { totalCost: round2(total) } });
      }
      if (full.saleId) await this.notifySaleOrder(tx, full.companyId, full.saleId, user);
    });
    if (stockSynced) this.sync.syncProduct((stockSynced as any).productId, (stockSynced as any).stock).catch(() => {});
  }

  // Cuando todas las órdenes de una venta terminan, la orden de despacho queda lista para seguir.
  private async notifySaleOrder(tx: Tx, companyId: string, saleId: string, user: any) {
    const open = await tx.productionOrder.count({ where: { saleId, status: { in: OPEN } } });
    if (open > 0) return;
    const order = await tx.order.findFirst({ where: { saleId }, select: { id: true, status: true } });
    if (!order) return;
    const company = await tx.company.findUnique({ where: { id: companyId }, select: { modules: true } });
    const usesOrders = matchesModule(company?.modules, 'orders');
    // Sin el módulo de órdenes no hay preparación en el panel: queda lista para entregar.
    if (!usesOrders && order.status === OrderStatus.PREPARING) await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.READY } });
    await tx.orderStatusEvent.create({
      data: {
        orderId: order.id, status: !usesOrders && order.status === OrderStatus.PREPARING ? OrderStatus.READY : order.status,
        source: OrderEventSource.SYSTEM, title: 'Fabricación terminada', detail: 'Todas las órdenes de fabricación de la venta están listas',
        actorName: actor(user), occurredAt: new Date(),
      },
    });
  }

  async cancel(user: any, orderId: string, reason?: string) {
    const order = await this.owned(user, orderId);
    this.assertOpen(order.status);
    await this.prisma.$transaction(async (tx) => {
      await this.releaseReservations(tx, orderId);
      await tx.productionOrder.update({ where: { id: orderId }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason?.trim() || null } });
      await this.event(tx, orderId, 'CANCELLED', `Orden anulada${reason?.trim() ? `: ${reason.trim()}` : ''}`, { customerVisible: true, actorName: actor(user) });
    });
    return this.get(user, orderId);
  }

  /** Garantía: reabre una orden terminada como una nueva, enlazada a la original. */
  async reopenWarranty(user: any, orderId: string, reason: string) {
    const order = await this.owned(user, orderId);
    if (order.status !== 'DONE') throw new BadRequestException('Solo se reabren órdenes terminadas');
    if (!reason?.trim()) throw new BadRequestException('Indica el motivo de la garantía');
    const src = await this.prisma.productionOrder.findUnique({ where: { id: orderId } });
    const created = await this.prisma.$transaction(async (tx) => {
      const stages = await stagesFromProcess(tx, src!.processId, new Date());
      const o = await tx.productionOrder.create({
        data: {
          number: await nextOrderNumber(tx, src!.companyId),
          kind: src!.kind === 'FOR_STOCK' ? 'REPAIR' : src!.kind,
          productName: src!.productName, quantity: src!.quantity,
          specs: (src!.specs ?? undefined) as Prisma.InputJsonValue | undefined,
          repairInfo: (src!.repairInfo ?? undefined) as Prisma.InputJsonValue | undefined,
          trackingToken: newTrackingToken(),
          customerName: src!.customerName, customerEmail: src!.customerEmail, customerPhone: src!.customerPhone, clientId: src!.clientId,
          companyId: src!.companyId, productId: src!.productId, processId: src!.processId,
          reopenedFromId: src!.id, warrantyReason: reason.trim(),
          createdById: user.id ?? null, createdByName: actor(user),
          stages: { create: stages },
        },
      });
      await this.event(tx, o.id, 'CREATED', `Garantía de la OF-${src!.number}: ${reason.trim()}`, { customerVisible: true, actorName: actor(user) });
      await this.event(tx, src!.id, 'WARRANTY', `Se abrió la garantía OF-${o.number}: ${reason.trim()}`, { actorName: actor(user) });
      return o;
    });
    return { id: created.id, number: created.number };
  }

  // ── Materiales ───────────────────────────────────────────────────────

  private async recalcCosts(tx: Tx, orderId: string) {
    const [mats, times] = await Promise.all([
      tx.productionMaterialUse.findMany({ where: { orderId }, select: { consumedQty: true, unitCost: true } }),
      tx.productionTimeEntry.findMany({ where: { orderId }, select: { minutes: true, hourlyCost: true } }),
    ]);
    const materials = round2(mats.reduce((s, m) => s + Number(m.consumedQty) * Number(m.unitCost), 0));
    const labor = round2(times.reduce((s, t) => s + (t.minutes / 60) * Number(t.hourlyCost), 0));
    await tx.productionOrder.update({ where: { id: orderId }, data: { materialsCost: materials, laborCost: labor } });
    return { materials, labor };
  }

  private async releaseReservations(tx: Tx, orderId: string) {
    const uses = await tx.productionMaterialUse.findMany({ where: { orderId, reservedQty: { gt: 0 } } });
    for (const u of uses) {
      const qty = Math.ceil(Number(u.reservedQty));
      if (u.warehouseId && qty > 0) {
        const row = await tx.productStock.findUnique({ where: { productId_warehouseId: { productId: u.materialId, warehouseId: u.warehouseId } } });
        if (row) await tx.productStock.update({ where: { id: row.id }, data: { reserved: Math.max(0, row.reserved - qty) } });
      }
      await tx.productionMaterialUse.update({ where: { id: u.id }, data: { reservedQty: 0 } });
    }
  }

  // Descuenta del inventario lo planificado y aún no consumido de los materiales que cumplan `pick`.
  private async consumeWhere(tx: Tx, orderId: string, user: any, pick: (m: { stageName: string | null }) => boolean) {
    const order = await tx.productionOrder.findUnique({ where: { id: orderId }, select: { number: true } });
    const uses = await tx.productionMaterialUse.findMany({ where: { orderId }, include: { material: { select: { cost: true, companyId: true, warehouseId: true } } } });
    let moved = false;
    for (const u of uses) {
      if (!pick(u)) continue;
      const pending = Number(u.plannedQty) - Number(u.consumedQty);
      // El inventario maneja unidades enteras: se descuenta redondeado hacia arriba.
      const qty = Math.ceil(pending - 1e-9);
      if (qty <= 0) continue;
      const unitCost = Number(u.material.cost ?? 0);
      await this.ledger.move(tx, {
        productId: u.materialId, warehouseId: u.warehouseId, delta: -qty, type: MovementType.PRODUCTION_OUT,
        reason: `Consumo OF-${order?.number}`, userId: user?.id, unitCost, reference: { type: 'PRODUCTION', id: orderId, number: `OF-${order?.number}` },
      });
      // Lo reservado para este material se libera al consumirlo.
      const reserved = Math.ceil(Number(u.reservedQty));
      if (reserved > 0 && u.warehouseId) {
        const row = await tx.productStock.findUnique({ where: { productId_warehouseId: { productId: u.materialId, warehouseId: u.warehouseId } } });
        if (row) await tx.productStock.update({ where: { id: row.id }, data: { reserved: Math.max(0, row.reserved - reserved) } });
      }
      await tx.productionMaterialUse.update({ where: { id: u.id }, data: { consumedQty: Number(u.consumedQty) + qty, reservedQty: 0, unitCost } });
      moved = true;
    }
    if (moved) {
      await this.recalcCosts(tx, orderId);
      await this.event(tx, orderId, 'MATERIALS_CONSUMED', 'Materiales descontados del inventario', { actorName: actor(user) });
    }
  }

  /** Reserva en bodega los materiales planificados (no los descuenta). */
  async reserveMaterials(user: any, orderId: string) {
    const order = await this.owned(user, orderId);
    this.assertOpen(order.status);
    const shortages: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      const uses = await tx.productionMaterialUse.findMany({ where: { orderId }, include: { material: { select: { id: true, name: true, companyId: true, warehouseId: true, stock: true } } } });
      for (const u of uses) {
        const need = Math.ceil(Number(u.plannedQty) - Number(u.consumedQty) - Number(u.reservedQty) - 1e-9);
        if (need <= 0) continue;
        const warehouseId = u.warehouseId || (await this.ledger.resolveWarehouseId(tx, u.material));
        await this.ledger.seedIfEmpty(tx, u.material, warehouseId, user?.id);
        const available = await this.ledger.available(tx, u.materialId, warehouseId);
        if (available < need) shortages.push(`${u.material.name}: faltan ${need - available}`);
        await tx.productStock.upsert({
          where: { productId_warehouseId: { productId: u.materialId, warehouseId } },
          update: { reserved: { increment: need } },
          create: { productId: u.materialId, warehouseId, quantity: 0, reserved: need },
        });
        await tx.productionMaterialUse.update({ where: { id: u.id }, data: { reservedQty: Number(u.reservedQty) + need, warehouseId } });
      }
      await this.event(tx, orderId, 'MATERIALS_RESERVED', 'Materiales reservados en bodega', { actorName: actor(user) });
    });
    const detail = await this.get(user, orderId);
    return { ...detail, shortages };
  }

  async consumeMaterialsNow(user: any, orderId: string) {
    const order = await this.owned(user, orderId);
    this.assertOpen(order.status);
    await this.prisma.$transaction((tx) => this.consumeWhere(tx, orderId, user, () => true));
    return this.get(user, orderId);
  }

  /** Agrega o ajusta un material de la orden (fuera de la lista de materiales del producto). */
  async setMaterial(user: any, orderId: string, dto: { materialId: string; plannedQty: number; stageName?: string | null }) {
    const order = await this.owned(user, orderId);
    this.assertOpen(order.status);
    const mat = await this.prisma.product.findFirst({ where: { id: dto.materialId, companyId: order.companyId }, select: { id: true, cost: true, warehouseId: true } });
    if (!mat) throw new BadRequestException('Material no válido');
    const qty = Math.max(0, Number(dto.plannedQty) || 0);
    const existing = await this.prisma.productionMaterialUse.findUnique({ where: { orderId_materialId: { orderId, materialId: mat.id } } });
    if (existing && qty < Number(existing.consumedQty)) throw new BadRequestException('No puedes dejar menos de lo ya consumido');
    if (!existing && qty <= 0) throw new BadRequestException('Indica la cantidad');
    await this.prisma.productionMaterialUse.upsert({
      where: { orderId_materialId: { orderId, materialId: mat.id } },
      update: { plannedQty: qty, stageName: dto.stageName ?? existing?.stageName ?? null },
      create: { orderId, materialId: mat.id, plannedQty: qty, unitCost: Number(mat.cost ?? 0), stageName: dto.stageName || null, warehouseId: mat.warehouseId },
    });
    return this.get(user, orderId);
  }

  async removeMaterial(user: any, orderId: string, useId: string) {
    const order = await this.owned(user, orderId);
    this.assertOpen(order.status);
    const use = await this.prisma.productionMaterialUse.findUnique({ where: { id: useId } });
    if (!use || use.orderId !== orderId) throw new NotFoundException('Material no encontrado');
    if (Number(use.consumedQty) > 0) throw new BadRequestException('Este material ya se consumió');
    await this.prisma.$transaction(async (tx) => {
      if (Number(use.reservedQty) > 0 && use.warehouseId) {
        const row = await tx.productStock.findUnique({ where: { productId_warehouseId: { productId: use.materialId, warehouseId: use.warehouseId } } });
        if (row) await tx.productStock.update({ where: { id: row.id }, data: { reserved: Math.max(0, row.reserved - Math.ceil(Number(use.reservedQty))) } });
      }
      await tx.productionMaterialUse.delete({ where: { id: useId } });
    });
    return this.get(user, orderId);
  }

  /** Faltantes: materiales que piden las órdenes abiertas contra el stock disponible. */
  async shortages(user: any, companyId?: string) {
    const cId = await this.config.companyFor(user, companyId);
    const uses = await this.prisma.productionMaterialUse.findMany({
      where: { order: { companyId: cId, status: { in: OPEN } } },
      include: { material: { select: { id: true, name: true, sku: true, stock: true, cost: true } }, order: { select: { number: true } } },
    });
    const byMaterial = new Map<string, { materialId: string; name: string; sku: string; stock: number; cost: number; needed: number; reserved: number; orders: number[] }>();
    for (const u of uses) {
      const pending = Number(u.plannedQty) - Number(u.consumedQty);
      if (pending <= 0) continue;
      const e = byMaterial.get(u.materialId) || { materialId: u.materialId, name: u.material.name, sku: u.material.sku, stock: u.material.stock, cost: Number(u.material.cost ?? 0), needed: 0, reserved: 0, orders: [] };
      e.needed += pending;
      e.reserved += Number(u.reservedQty);
      e.orders.push(u.order.number);
      byMaterial.set(u.materialId, e);
    }
    return [...byMaterial.values()]
      .map((e) => ({ ...e, needed: Math.ceil(e.needed), missing: Math.max(0, Math.ceil(e.needed) - e.stock), orders: [...new Set(e.orders)].sort((a, b) => a - b) }))
      .sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name));
  }

  // ── Horas de trabajo ─────────────────────────────────────────────────

  async addTime(user: any, orderId: string, dto: { stageId?: string | null; minutes: number; note?: string; workDate?: string; userId?: string | null }) {
    const order = await this.owned(user, orderId);
    const minutes = Math.round(Number(dto.minutes) || 0);
    if (minutes <= 0 || minutes > 24 * 60) throw new BadRequestException('Indica los minutos trabajados (hasta 24 horas)');
    let stageName: string | null = null;
    let hourlyCost = 0;
    if (dto.stageId) {
      const st = await this.prisma.productionOrderStage.findUnique({ where: { id: dto.stageId }, include: { area: { select: { hourlyCost: true } } } });
      if (!st || st.orderId !== orderId) throw new BadRequestException('Etapa no válida');
      stageName = st.name;
      hourlyCost = Number(st.area?.hourlyCost ?? 0);
    }
    let worker = { id: user.id as string | null, name: actor(user) };
    if (dto.userId && dto.userId !== user.id) {
      const u = await this.prisma.user.findFirst({ where: { id: dto.userId, companyId: order.companyId }, select: { id: true, name: true } });
      if (!u) throw new BadRequestException('Usuario no válido');
      worker = { id: u.id, name: u.name };
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.productionTimeEntry.create({
        data: {
          orderId, minutes, hourlyCost, stageName, note: dto.note?.trim() || null,
          userId: worker.id, userName: worker.name,
          workDate: dto.workDate ? new Date(dto.workDate) : new Date(),
        },
      });
      await this.recalcCosts(tx, orderId);
    });
    return this.get(user, orderId);
  }

  async removeTime(user: any, orderId: string, entryId: string) {
    await this.owned(user, orderId);
    const e = await this.prisma.productionTimeEntry.findUnique({ where: { id: entryId } });
    if (!e || e.orderId !== orderId) throw new NotFoundException('Registro no encontrado');
    await this.prisma.$transaction(async (tx) => {
      await tx.productionTimeEntry.delete({ where: { id: entryId } });
      await this.recalcCosts(tx, orderId);
    });
    return this.get(user, orderId);
  }

  // ── Adjuntos y notas ─────────────────────────────────────────────────

  async addAttachment(user: any, orderId: string, file: Express.Multer.File, dto: { stageName?: string; customerVisible?: string | boolean }) {
    const order = await this.owned(user, orderId);
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    if (file.size > 15 * 1024 * 1024) throw new BadRequestException('El archivo supera 15 MB');
    const stored = await this.storage.persist(file, { folder: 'production', owner: { category: 'production', companyId: order.companyId } });
    const visible = dto.customerVisible === true || dto.customerVisible === 'true';
    await this.prisma.productionAttachment.create({
      data: {
        orderId, url: stored.url, name: file.originalname || stored.filename, mimeType: file.mimetype,
        stageName: dto.stageName?.trim() || null, customerVisible: visible, createdByName: actor(user),
      },
    });
    await this.event(this.prisma, orderId, 'ATTACHMENT', `${file.mimetype?.startsWith('image/') ? 'Foto' : 'Archivo'} agregado${dto.stageName ? ` en «${dto.stageName}»` : ''}`, { stageName: dto.stageName || null, customerVisible: visible, actorName: actor(user) });
    return this.get(user, orderId);
  }

  async updateAttachment(user: any, orderId: string, attId: string, customerVisible: boolean) {
    await this.owned(user, orderId);
    const a = await this.prisma.productionAttachment.findUnique({ where: { id: attId } });
    if (!a || a.orderId !== orderId) throw new NotFoundException('Archivo no encontrado');
    await this.prisma.productionAttachment.update({ where: { id: attId }, data: { customerVisible: !!customerVisible } });
    return this.get(user, orderId);
  }

  async removeAttachment(user: any, orderId: string, attId: string) {
    await this.owned(user, orderId);
    const a = await this.prisma.productionAttachment.findUnique({ where: { id: attId } });
    if (!a || a.orderId !== orderId) throw new NotFoundException('Archivo no encontrado');
    await this.prisma.productionAttachment.delete({ where: { id: attId } });
    this.storage.remove([a.url]).catch(() => {});
    return this.get(user, orderId);
  }

  async addNote(user: any, orderId: string, message: string, customerVisible: boolean) {
    await this.owned(user, orderId);
    if (!message?.trim()) throw new BadRequestException('Escribe la nota');
    await this.event(this.prisma, orderId, 'NOTE', message.trim(), { customerVisible: !!customerVisible, actorName: actor(user) });
    return this.get(user, orderId);
  }

  // ── Cobros: saldo de la venta ────────────────────────────────────────

  async registerBalancePayment(user: any, orderId: string, dto: { method: PaymentMethod; amount: number; reference?: string }) {
    await this.owned(user, orderId);
    const o = await this.prisma.productionOrder.findUnique({ where: { id: orderId }, select: { saleId: true, number: true } });
    if (!o?.saleId) throw new BadRequestException('Esta orden no tiene una venta asociada');
    await registerSaleBalancePayment(this.prisma, o.saleId, { ...dto, collectedById: user.id ?? null });
    await this.event(this.prisma, orderId, 'PAYMENT', `Pago de saldo $${Math.round(Number(dto.amount)).toLocaleString('es-CL')}`, { actorName: actor(user) });
    return this.get(user, orderId);
  }

  // ── Mis tareas y calendario ──────────────────────────────────────────

  /** Etapas en curso o por iniciar (la actual de cada orden) asignadas al usuario o sin asignar. */
  async myTasks(user: any, q: { companyId?: string; all?: string }) {
    const cId = await this.config.companyFor(user, q.companyId);
    const orders = await this.prisma.productionOrder.findMany({
      where: { companyId: cId, status: { in: ['PENDING', 'IN_PROGRESS', 'WAITING_APPROVAL'] } },
      include: { stages: { orderBy: { position: 'asc' }, include: { area: { select: { id: true, name: true } } } } },
      orderBy: [{ priority: 'desc' }, { dueDate: { sort: 'asc', nulls: 'last' } }],
      take: 500,
    });
    const tasks: any[] = [];
    for (const o of orders) {
      const st = this.currentStage(o.stages);
      if (!st) continue;
      const mine = st.assignedToId === user.id;
      if (q.all !== 'true' && st.assignedToId && !mine) continue;
      tasks.push({
        orderId: o.id, number: o.number, productName: o.productName, quantity: o.quantity, customerName: o.customerName, priority: o.priority,
        dueDate: st.dueDate ?? o.dueDate, overdue: !!(st.dueDate ?? o.dueDate) && new Date((st.dueDate ?? o.dueDate)!).getTime() < Date.now(),
        stage: { id: st.id, name: st.name, status: st.status, areaName: st.area?.name ?? null, assignedToName: st.assignedToName, checklist: st.checklist },
        mine,
      });
    }
    return tasks;
  }

  /** Calendario de entregas y carga de trabajo por área y día. */
  async calendar(user: any, q: { companyId?: string; from?: string; to?: string }) {
    const cId = await this.config.companyFor(user, q.companyId);
    const from = q.from ? new Date(q.from) : new Date(new Date().setHours(0, 0, 0, 0));
    const to = q.to ? new Date(q.to) : new Date(from.getTime() + 28 * 24 * 3600_000);
    const [orders, stages, areas] = await Promise.all([
      this.prisma.productionOrder.findMany({
        where: { companyId: cId, status: { in: [...OPEN, 'DONE'] }, dueDate: { gte: from, lt: to } },
        include: this.listInclude, orderBy: { dueDate: 'asc' },
      }),
      this.prisma.productionOrderStage.findMany({
        where: { order: { companyId: cId, status: { in: OPEN } }, status: { notIn: FINISHED_STAGE }, dueDate: { gte: from, lt: to } },
        select: { dueDate: true, estimatedHours: true, areaId: true, order: { select: { quantity: true } } },
      }),
      this.prisma.productionArea.findMany({ where: { companyId: cId, active: true }, select: { id: true, name: true, dailyCapacityHours: true } }),
    ]);
    const load: Record<string, Record<string, number>> = {};
    for (const s of stages) {
      if (!s.areaId || !s.dueDate) continue;
      const day = s.dueDate.toISOString().slice(0, 10);
      load[s.areaId] = load[s.areaId] || {};
      load[s.areaId][day] = (load[s.areaId][day] || 0) + Number(s.estimatedHours ?? 0) * s.order.quantity;
    }
    return {
      from, to,
      orders: orders.map((o) => this.summary(o)),
      areas: areas.map((a) => ({ id: a.id, name: a.name, dailyCapacityHours: a.dailyCapacityHours != null ? Number(a.dailyCapacityHours) : null, load: load[a.id] || {} })),
    };
  }

  /** Órdenes de fabricación de una venta (detalle de la orden de despacho / venta). */
  async forSale(user: any, saleId: string) {
    const sale = await this.prisma.sale.findUnique({ where: { id: saleId }, select: { companyId: true } });
    if (!sale || (!isSuperAdmin(user) && sale.companyId !== user.companyId)) throw new NotFoundException('Venta no encontrada');
    const rows = await this.prisma.productionOrder.findMany({ where: { saleId }, include: this.listInclude, orderBy: { number: 'asc' } });
    return rows.map((r) => this.summary(r));
  }

  // ── Seguimiento público del cliente ──────────────────────────────────

  async publicView(token: string) {
    const o = await this.prisma.productionOrder.findUnique({
      where: { trackingToken: token },
      include: {
        company: { select: { name: true } },
        stages: { orderBy: { position: 'asc' } },
        attachments: { where: { customerVisible: true }, orderBy: { createdAt: 'asc' } },
        events: { where: { customerVisible: true }, orderBy: { createdAt: 'desc' }, take: 50 },
        sale: { select: { balanceDue: true } },
      },
    });
    if (!o || o.kind === 'FOR_STOCK') throw new NotFoundException('Seguimiento no encontrado');
    const visible = o.stages.filter((s) => s.customerVisible);
    return {
      number: o.number, kindLabel: KIND_LABEL[o.kind], status: o.status, productName: o.productName, quantity: o.quantity,
      companyName: o.company.name, customerName: o.customerName, dueDate: o.dueDate, createdAt: o.createdAt, completedAt: o.completedAt,
      specs: o.specs, progress: this.progress(o.stages),
      balanceDue: o.sale?.balanceDue != null ? Number(o.sale.balanceDue) : 0,
      stages: visible.map((s) => ({
        id: s.id, name: s.name, status: s.status, dueDate: s.dueDate, startedAt: s.startedAt, completedAt: s.completedAt,
        approval: s.requiresApproval ? { status: s.approvalStatus, note: s.approvalNote, at: s.approvalAt } : null,
        attachments: o.attachments.filter((a) => a.stageName && a.stageName === s.name).map((a) => ({ id: a.id, url: a.url, name: a.name, mimeType: a.mimeType })),
      })),
      attachments: o.attachments.filter((a) => !a.stageName || !visible.some((s) => s.name === a.stageName)).map((a) => ({ id: a.id, url: a.url, name: a.name, mimeType: a.mimeType })),
      events: o.events.map((e) => ({ message: e.message, createdAt: e.createdAt })),
    };
  }

  async publicApproval(token: string, stageId: string, approved: boolean, note?: string) {
    const o = await this.prisma.productionOrder.findUnique({ where: { trackingToken: token }, select: { id: true, status: true, customerName: true } });
    if (!o) throw new NotFoundException('Seguimiento no encontrado');
    if (!OPEN.includes(o.status)) throw new BadRequestException('La orden ya no está en curso');
    const stage = await this.prisma.productionOrderStage.findUnique({ where: { id: stageId } });
    if (!stage || stage.orderId !== o.id || !stage.customerVisible) throw new NotFoundException('Etapa no encontrada');
    if (!approved && !note?.trim()) throw new BadRequestException('Cuéntanos qué cambios necesitas');
    const name = o.customerName || 'Cliente';
    await this.applyApproval(o.id, stage, approved, note, name, { id: null, name });
    return this.publicView(token);
  }
}

/** Suma un pago al saldo de una venta con abono (manual o desde un link de pago en línea). */
export async function registerSaleBalancePayment(
  prisma: PrismaService | Tx,
  saleId: string,
  dto: { method: PaymentMethod; amount: number; reference?: string | null; collectedById?: string | null },
) {
  const sale = await prisma.sale.findUnique({ where: { id: saleId }, select: { id: true, balanceDue: true } });
  if (!sale) throw new NotFoundException('Venta no encontrada');
  const due = Number(sale.balanceDue ?? 0);
  const amount = round2(Number(dto.amount) || 0);
  if (!(amount > 0)) throw new BadRequestException('Indica el monto');
  if (due <= 0) throw new BadRequestException('La venta no tiene saldo por cobrar');
  if (amount > due + 0.5) throw new BadRequestException(`El saldo por cobrar es $${Math.round(due).toLocaleString('es-CL')}`);
  if (dto.method === PaymentMethod.MIXED) throw new BadRequestException('Medio de pago no válido');
  const next = round2(Math.max(0, due - amount));
  const run = async (tx: Tx) => {
    await tx.salePayment.create({
      data: { saleId, method: dto.method, amount, isBalance: true, collectedById: dto.collectedById ?? null, reference: dto.reference?.trim() || null },
    });
    // Con varios medios la venta pasa a «Mixto».
    const methods = await tx.salePayment.findMany({ where: { saleId }, select: { method: true }, distinct: ['method'] });
    await tx.sale.update({ where: { id: saleId }, data: { balanceDue: next > 0 ? next : null, ...(methods.length > 1 ? { paymentMethod: PaymentMethod.MIXED } : {}) } });
  };
  if ('$transaction' in prisma) await (prisma as PrismaService).$transaction(run);
  else await run(prisma as Tx);
  return { balanceDue: next };
}

// Uso desde órdenes/bodega/despacho: no dejar salir una orden con fabricación pendiente (ni con
// saldo, si la empresa lo configuró).
export async function assertDispatchable(prisma: PrismaService | Tx, saleId: string | null | undefined, companyId: string) {
  if (!saleId) return;
  const open = await prisma.productionOrder.count({ where: { saleId, status: { in: OPEN } } });
  if (open > 0) throw new BadRequestException(`La venta tiene ${open} orden(es) de fabricación en curso: termínalas antes de despachar`);
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { productionSettings: true } });
  if (readProductionSettings(company?.productionSettings).blockDispatchWithBalance) {
    const sale = await prisma.sale.findUnique({ where: { id: saleId }, select: { balanceDue: true } });
    if (Number(sale?.balanceDue ?? 0) > 0) throw new BadRequestException(`La venta tiene un saldo por cobrar de $${Math.round(Number(sale!.balanceDue)).toLocaleString('es-CL')}`);
  }
}

export const PRODUCTION_ROLES: Role[] = [Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR, Role.ORDER_MANAGER, Role.DESPACHADOR];
export { ForbiddenException };

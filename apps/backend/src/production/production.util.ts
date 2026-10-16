import { randomBytes } from 'crypto';
import { Prisma, ProductSupplyMode, ProductType, ProductionOrderKind } from '@prisma/client';
import { matchesModule } from '../common/modules.util';

type Tx = Prisma.TransactionClient;

// Módulo por empresa (Empresas → Módulos).
export const PRODUCTION_MODULE = 'produccion';

export async function productionActive(db: Tx | { company: Tx['company'] }, companyId: string): Promise<boolean> {
  const company = await db.company.findUnique({ where: { id: companyId }, select: { modules: true } });
  return matchesModule(company?.modules, PRODUCTION_MODULE);
}

type ProductLike = { type: ProductType | string; dropship?: boolean | null; supplyMode?: ProductSupplyMode | string | null; requiresProcess?: boolean | null };

/** Fabricado a pedido (con el módulo activo): se vende sin stock y abre una orden de fabricación. */
export function isMadeToOrder(p: ProductLike, moduleOn: boolean): boolean {
  return moduleOn && p.type !== ProductType.SERVICIO && p.supplyMode === ProductSupplyMode.MADE_TO_ORDER;
}

/** Servicio con proceso (reparación, instalación): cada venta abre una orden con su proceso. */
export function isProcessService(p: ProductLike, moduleOn: boolean): boolean {
  return moduleOn && p.type === ProductType.SERVICIO && !!p.requiresProcess;
}

/** Productos que no descuentan stock propio al venderse. */
export function isStockless(p: ProductLike, moduleOn: boolean): boolean {
  return p.type === ProductType.SERVICIO || !!p.dropship || isMadeToOrder(p, moduleOn);
}

export function newTrackingToken(): string {
  return randomBytes(18).toString('base64url');
}

export async function nextOrderNumber(tx: Tx, companyId: string): Promise<number> {
  const last = await tx.productionOrder.findFirst({ where: { companyId }, orderBy: { number: 'desc' }, select: { number: true } });
  return (last?.number ?? 0) + 1;
}

const DAY = 24 * 3600_000;

/** Etapas de la orden copiadas desde el proceso, con su fecha estimada encadenada. */
export async function stagesFromProcess(tx: Tx, processId: string | null | undefined, start: Date) {
  if (!processId) return [];
  const stages = await tx.productionProcessStage.findMany({ where: { processId }, orderBy: { position: 'asc' } });
  let cursor = start.getTime();
  return stages.map((st, i) => {
    cursor += Math.max(0, Number(st.estimatedDays ?? 0)) * DAY;
    return {
      position: i,
      name: st.name,
      areaId: st.areaId,
      estimatedDays: st.estimatedDays,
      estimatedHours: st.estimatedHours,
      requiresApproval: st.requiresApproval,
      notifyCustomer: st.notifyCustomer,
      customerVisible: st.customerVisible,
      checklist: st.checklist.map((label) => ({ label, done: false })) as unknown as Prisma.InputJsonValue,
      dueDate: st.estimatedDays != null ? new Date(cursor) : null,
    };
  });
}

/**
 * Crea la orden de fabricación de una línea de venta (producto a pedido o servicio con proceso).
 * Se llama dentro de la transacción de la venta; si la línea ya tiene orden, no hace nada.
 */
export async function createProductionOrderForSaleItem(tx: Tx, saleItemId: string, actorName?: string | null) {
  const existing = await tx.productionOrder.findUnique({ where: { saleItemId }, select: { id: true } });
  if (existing) return existing;
  const item = await tx.saleItem.findUnique({
    where: { id: saleItemId },
    include: {
      product: { select: { id: true, name: true, type: true, productionProcessId: true, manufacturingDays: true, companyId: true } },
      sale: { select: { id: true, companyId: true, customerName: true, customerEmail: true, customerPhone: true, clientId: true, channel: true, externalId: true } },
    },
  });
  if (!item) return null;
  const companyId = item.sale.companyId;
  const process = item.product.productionProcessId
    ? await tx.productionProcess.findUnique({ where: { id: item.product.productionProcessId }, select: { id: true, isRepair: true } })
    : null;
  const now = new Date();
  const stages = await stagesFromProcess(tx, process?.id, now);
  const days = item.product.manufacturingDays ?? stages.reduce((s, st) => s + Number(st.estimatedDays ?? 0), 0);
  const kind = item.product.type === ProductType.SERVICIO || process?.isRepair ? ProductionOrderKind.REPAIR : ProductionOrderKind.MADE_TO_ORDER;
  const number = await nextOrderNumber(tx, companyId);
  const order = await tx.productionOrder.create({
    data: {
      number, kind,
      productName: item.product.name,
      quantity: item.quantity,
      specs: (item.specs ?? undefined) as Prisma.InputJsonValue | undefined,
      dueDate: days > 0 ? new Date(now.getTime() + days * DAY) : null,
      trackingToken: newTrackingToken(),
      customerName: item.sale.customerName,
      customerEmail: item.sale.customerEmail,
      customerPhone: item.sale.customerPhone,
      clientId: item.sale.clientId,
      companyId,
      productId: item.product.id,
      processId: process?.id ?? null,
      saleId: item.sale.id,
      saleItemId: item.id,
      createdByName: actorName ?? null,
      stages: { create: stages },
      events: {
        create: {
          type: 'CREATED',
          message: `Orden creada desde la venta${item.sale.externalId ? ` ${item.sale.externalId}` : ''} (${item.sale.channel})`,
          actorName: actorName ?? 'Sistema',
          customerVisible: true,
        },
      },
    },
    select: { id: true },
  });
  // Materiales planificados según la lista de materiales del producto.
  await planMaterials(tx, order.id, item.product.id, item.quantity);
  return order;
}

/** Copia la lista de materiales del producto a la orden (cantidad × unidades a fabricar). */
export async function planMaterials(tx: Tx, orderId: string, productId: string, quantity: number) {
  const bom = await tx.productMaterial.findMany({ where: { productId }, include: { material: { select: { cost: true, warehouseId: true } } } });
  for (const m of bom) {
    await tx.productionMaterialUse.upsert({
      where: { orderId_materialId: { orderId, materialId: m.materialId } },
      update: { plannedQty: Number(m.quantity) * quantity, stageName: m.stageName },
      create: {
        orderId, materialId: m.materialId,
        plannedQty: Number(m.quantity) * quantity,
        unitCost: Number(m.material.cost ?? 0),
        stageName: m.stageName,
        warehouseId: m.material.warehouseId,
      },
    });
  }
}

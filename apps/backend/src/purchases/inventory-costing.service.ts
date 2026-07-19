import { Injectable, Logger } from '@nestjs/common';
import { MovementType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { matchesModule } from '../common/modules.util';

type Tx = Prisma.TransactionClient;

interface ConsumedLot {
  purchaseItemId: string;
  quantity: number;
  unitCost: number;
}

// Motor de costeo por lotes (FIFO), opt-in por empresa vía Company.modules ('purchases').
// Con el módulo apagado, todo el sistema se comporta exactamente igual que antes de que
// este servicio existiera (stock tradicional, sin lotes). Con el módulo activo, las
// compras generan lotes y las ventas/traspasos los consumen del más antiguo al más nuevo.
@Injectable()
export class InventoryCostingService {
  private readonly logger = new Logger(InventoryCostingService.name);

  constructor(private prisma: PrismaService) {}

  async isPurchasesModuleActive(companyId: string): Promise<boolean> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { modules: true } });
    return matchesModule(company?.modules, 'purchases');
  }

  // FIFO: consume `quantity` de los lotes vivos de un producto en una bodega, del más
  // antiguo al más nuevo. Si los lotes no alcanzan (dato inconsistente), deja el
  // remanente sin lote asociado, al costo de referencia actual del producto.
  private async consumeLotsFifo(tx: Tx, params: { productId: string; warehouseId: string; quantity: number }): Promise<ConsumedLot[]> {
    const { productId, warehouseId, quantity } = params;
    const lots = await tx.purchaseItem.findMany({
      where: { productId, warehouseId, remainingQuantity: { gt: 0 } },
      orderBy: { createdAt: 'asc' },
    });

    const consumed: ConsumedLot[] = [];
    let remaining = quantity;

    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(lot.remainingQuantity, remaining);
      await tx.purchaseItem.update({
        where: { id: lot.id },
        data: { remainingQuantity: { decrement: take } },
      });
      consumed.push({ purchaseItemId: lot.id, quantity: take, unitCost: Number(lot.unitCost) });
      remaining -= take;
    }

    if (remaining > 0) {
      const product = await tx.product.findUnique({ where: { id: productId }, select: { cost: true } });
      this.logger.warn(
        `FIFO: lotes insuficientes para producto ${productId} en bodega ${warehouseId}, faltan ${remaining} unidad(es); se usa costo de referencia`,
      );
      consumed.push({ purchaseItemId: '', quantity: remaining, unitCost: Number(product?.cost || 0) });
    }

    return consumed;
  }

  private async recomputeAverageCost(tx: Tx, productId: string) {
    const lots = await tx.purchaseItem.findMany({
      where: { productId, remainingQuantity: { gt: 0 } },
      select: { remainingQuantity: true, unitCost: true },
    });
    const totalQty = lots.reduce((s, l) => s + l.remainingQuantity, 0);
    if (totalQty === 0) return; // sin lotes vivos: se conserva el último costo conocido
    const totalValue = lots.reduce((s, l) => s + l.remainingQuantity * Number(l.unitCost), 0);
    await tx.product.update({ where: { id: productId }, data: { cost: totalValue / totalQty } });
  }

  // Lectura + escritura (en vez de increment/decrement atómico) para poder acotar el
  // resultado a 0 — replica el comportamiento previo a este servicio (tanto POS como el
  // webhook de ML ya evitaban dejar stock negativo).
  private async adjustProductStock(tx: Tx, productId: string, warehouseId: string, delta: number) {
    const stockRow = await tx.productStock.findUnique({ where: { productId_warehouseId: { productId, warehouseId } } });
    const newQty = Math.max(0, (stockRow?.quantity ?? 0) + delta);
    await tx.productStock.upsert({
      where: { productId_warehouseId: { productId, warehouseId } },
      create: { productId, warehouseId, quantity: newQty },
      update: { quantity: newQty },
    });

    const product = await tx.product.findUnique({ where: { id: productId }, select: { stock: true } });
    const newTotal = Math.max(0, (product?.stock ?? 0) + delta);
    await tx.product.update({ where: { id: productId }, data: { stock: newTotal } });
  }

  // Registra la entrada de un lote de compra: sube stock por bodega y el total del
  // producto, crea el movimiento y recalcula el costo promedio ponderado.
  async receivePurchaseItem(tx: Tx, params: {
    productId: string; warehouseId: string; quantity: number; unitCost: number;
    purchaseItemId: string; userId?: string; reason: string;
  }) {
    const { productId, warehouseId, quantity, unitCost, purchaseItemId, userId, reason } = params;

    await this.adjustProductStock(tx, productId, warehouseId, quantity);
    await tx.stockMovement.create({
      data: {
        type: MovementType.PURCHASE,
        quantity,
        reason,
        productId,
        warehouseId,
        purchaseItemId,
        unitCost,
        userId,
      },
    });
    await this.recomputeAverageCost(tx, productId);
  }

  // Consume stock para una línea de venta. Con el módulo de compras activo, hace FIFO
  // sobre los lotes vivos y devuelve el costo total consumido (para SaleItem.totalCost).
  // Sin el módulo activo (o sin bodega resuelta), resta stock tradicional —igual que el
  // comportamiento anterior a este servicio— y devuelve null.
  async consumeForSale(tx: Tx, params: {
    companyId: string; productId: string; warehouseId: string | null; quantity: number;
    saleItemId: string; reason: string; userId?: string;
  }): Promise<number | null> {
    const { companyId, productId, warehouseId, quantity, saleItemId, reason, userId } = params;
    const active = warehouseId ? await this.isPurchasesModuleActive(companyId) : false;

    if (!active || !warehouseId) {
      const product = await tx.product.findUnique({ where: { id: productId }, select: { stock: true } });
      const newStock = Math.max(0, (product?.stock ?? 0) - quantity);
      await tx.product.update({ where: { id: productId }, data: { stock: newStock } });
      await tx.stockMovement.create({
        data: { type: MovementType.SALE, quantity: -quantity, reason, productId, saleItemId, userId },
      });
      return null;
    }

    const consumedLots = await this.consumeLotsFifo(tx, { productId, warehouseId, quantity });

    let totalCost = 0;
    for (const lot of consumedLots) {
      totalCost += lot.quantity * lot.unitCost;
      await tx.stockMovement.create({
        data: {
          type: MovementType.SALE,
          quantity: -lot.quantity,
          reason,
          productId,
          saleItemId,
          userId,
          warehouseId,
          unitCost: lot.unitCost,
          purchaseItemId: lot.purchaseItemId || undefined,
        },
      });
    }

    await this.adjustProductStock(tx, productId, warehouseId, -quantity);
    await this.recomputeAverageCost(tx, productId);

    return totalCost;
  }

  // Traspasa stock entre bodegas consumiendo FIFO en el origen y creando lotes nuevos en
  // el destino con el mismo costo unitario original (preserva el costeo real). El total
  // del producto no cambia (misma cantidad, otra bodega).
  async transferStock(tx: Tx, params: {
    productId: string; fromWarehouseId: string; toWarehouseId: string;
    quantity: number; userId?: string; reason?: string;
  }) {
    const { productId, fromWarehouseId, toWarehouseId, quantity, userId } = params;
    const reason = params.reason || 'Traspaso de bodega';

    const consumedLots = await this.consumeLotsFifo(tx, { productId, warehouseId: fromWarehouseId, quantity });

    for (const lot of consumedLots) {
      await tx.stockMovement.create({
        data: {
          type: MovementType.TRANSFER_OUT,
          quantity: -lot.quantity,
          reason,
          productId,
          userId,
          warehouseId: fromWarehouseId,
          unitCost: lot.unitCost,
          purchaseItemId: lot.purchaseItemId || undefined,
        },
      });

      const newLot = await tx.purchaseItem.create({
        data: {
          productId,
          warehouseId: toWarehouseId,
          quantity: lot.quantity,
          remainingQuantity: lot.quantity,
          unitCost: lot.unitCost,
        },
      });

      await tx.stockMovement.create({
        data: {
          type: MovementType.TRANSFER_IN,
          quantity: lot.quantity,
          reason,
          productId,
          userId,
          warehouseId: toWarehouseId,
          unitCost: lot.unitCost,
          purchaseItemId: newLot.id,
        },
      });
    }

    await this.adjustProductStock(tx, productId, fromWarehouseId, -quantity);
    await this.adjustProductStock(tx, productId, toWarehouseId, quantity);
  }

  // Bootstrap al activar el módulo para una empresa: crea un lote de apertura por cada
  // producto activo con stock y sin lotes previos, usando su stock/costo actuales, para
  // que el FIFO nunca se quede sin de dónde descontar.
  async bootstrapOpeningLots(companyId: string) {
    const products = await this.prisma.product.findMany({
      where: { companyId, active: true, stock: { gt: 0 } },
      include: { _count: { select: { purchaseItems: true } } },
    });

    const migrated: string[] = [];
    const skipped: Array<{ productId: string; name: string; reason: string }> = [];

    for (const product of products) {
      if (product._count.purchaseItems > 0) continue;
      if (!product.warehouseId) {
        skipped.push({ productId: product.id, name: product.name, reason: 'Sin bodega asignada' });
        continue;
      }

      const warehouseId = product.warehouseId;
      const unitCost = Number(product.cost ?? 0);

      await this.prisma.$transaction(async (tx) => {
        const lot = await tx.purchaseItem.create({
          data: {
            productId: product.id,
            warehouseId,
            quantity: product.stock,
            remainingQuantity: product.stock,
            unitCost,
          },
        });
        await tx.productStock.upsert({
          where: { productId_warehouseId: { productId: product.id, warehouseId } },
          create: { productId: product.id, warehouseId, quantity: product.stock },
          update: { quantity: { increment: product.stock } },
        });
        await tx.stockMovement.create({
          data: {
            type: MovementType.PURCHASE,
            quantity: product.stock,
            reason: 'Inventario inicial (activación módulo Compras)',
            productId: product.id,
            warehouseId,
            purchaseItemId: lot.id,
            unitCost,
          },
        });
      });
      migrated.push(product.id);
    }

    return { migrated: migrated.length, skipped };
  }
}

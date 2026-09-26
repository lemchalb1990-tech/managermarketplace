import { Injectable, Logger } from '@nestjs/common';
import { MovementType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { matchesModule } from '../common/modules.util';
import { StockLedgerService, StockReference } from './stock-ledger.service';

type Tx = Prisma.TransactionClient;

interface ConsumedLot {
  purchaseItemId: string;
  quantity: number;
  unitCost: number;
}

// Motor de costeo por lotes (FIFO), opt-in por empresa vía Company.modules ('purchases').
// Con el módulo apagado, los movimientos pasan por StockLedgerService (stock por bodega +
// kardex, sin lotes). Con el módulo activo, las compras generan lotes y las ventas/traspasos
// los consumen del más antiguo al más nuevo; el stock por bodega y el kardex se mantienen igual.
@Injectable()
export class InventoryCostingService {
  private readonly logger = new Logger(InventoryCostingService.name);

  constructor(private prisma: PrismaService, private ledger: StockLedgerService) {}

  // Dentro de una transacción, pasar `client` (tx): consultar con otra conexión mientras la
  // transacción tiene la suya puede bloquearse con un pool chico.
  async isPurchasesModuleActive(companyId: string, client: Tx | PrismaService = this.prisma): Promise<boolean> {
    const company = await client.company.findUnique({ where: { id: companyId }, select: { modules: true } });
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

  // Deja cuadrado el stock por bodega del producto (ver StockLedgerService.seedIfEmpty) y
  // devuelve la existencia actual en `warehouseId`, para calcular el saldo de cada movimiento.
  private async prepareWarehouse(tx: Tx, productId: string, warehouseId: string, userId?: string): Promise<number> {
    const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, companyId: true, warehouseId: true, stock: true } });
    if (product) {
      const home = await this.ledger.resolveWarehouseId(tx, product);
      await this.ledger.seedIfEmpty(tx, product, home, userId);
    }
    const row = await tx.productStock.findUnique({ where: { productId_warehouseId: { productId, warehouseId } } });
    return row?.quantity ?? 0;
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
    purchaseItemId: string; userId?: string; reason: string; reference?: StockReference;
  }) {
    const { productId, warehouseId, quantity, unitCost, purchaseItemId, userId, reason } = params;

    const before = await this.prepareWarehouse(tx, productId, warehouseId, userId);
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
        balanceAfter: before + quantity,
        referenceType: params.reference?.type ?? 'PURCHASE',
        referenceId: params.reference?.id,
        documentNumber: params.reference?.number,
      },
    });
    await this.recomputeAverageCost(tx, productId);
  }

  // Consume stock para una línea de venta. Con el módulo de compras activo, hace FIFO
  // sobre los lotes vivos y devuelve el costo total consumido (para SaleItem.totalCost).
  // Sin el módulo activo (o sin bodega resuelta), descuenta por el motor de inventario
  // (bodega del producto o la por defecto) y devuelve null.
  async consumeForSale(tx: Tx, params: {
    companyId: string; productId: string; warehouseId: string | null; quantity: number;
    saleItemId: string; reason: string; userId?: string; reference?: StockReference;
  }): Promise<number | null> {
    const { companyId, productId, warehouseId, quantity, saleItemId, reason, userId } = params;
    const reference = params.reference ?? { type: 'SALE' as const };
    const active = warehouseId ? await this.isPurchasesModuleActive(companyId, tx) : false;

    if (!active || !warehouseId) {
      await this.ledger.move(tx, {
        productId, warehouseId, delta: -quantity, type: MovementType.SALE, reason, userId, saleItemId, reference,
      });
      return null;
    }

    let balance = await this.prepareWarehouse(tx, productId, warehouseId, userId);
    const consumedLots = await this.consumeLotsFifo(tx, { productId, warehouseId, quantity });

    let totalCost = 0;
    for (const lot of consumedLots) {
      totalCost += lot.quantity * lot.unitCost;
      balance = Math.max(0, balance - lot.quantity);
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
          balanceAfter: balance,
          referenceType: reference.type,
          referenceId: reference.id,
          documentNumber: reference.number,
        },
      });
    }

    await this.adjustProductStock(tx, productId, warehouseId, -quantity);
    await this.recomputeAverageCost(tx, productId);

    return totalCost;
  }

  // Salida de un traspaso desde la bodega de origen. Con el módulo Compras activo consume
  // lotes FIFO y devuelve su costo unitario promedio (se usa para crear los lotes en destino
  // al recibir). Sin el módulo, mueve por el motor de inventario. Descuenta el total del
  // producto: la mercadería en tránsito no se publica en los canales.
  async transferOut(tx: Tx, params: {
    companyId: string; productId: string; warehouseId: string; quantity: number;
    userId?: string; reason: string; reference: StockReference;
  }): Promise<number | null> {
    const { companyId, productId, warehouseId, quantity, userId, reason, reference } = params;
    if (!(await this.isPurchasesModuleActive(companyId, tx))) {
      await this.ledger.move(tx, { productId, warehouseId, delta: -quantity, type: MovementType.TRANSFER_OUT, reason, userId, reference });
      return null;
    }

    let balance = await this.prepareWarehouse(tx, productId, warehouseId, userId);
    const consumedLots = await this.consumeLotsFifo(tx, { productId, warehouseId, quantity });
    let totalCost = 0;
    for (const lot of consumedLots) {
      totalCost += lot.quantity * lot.unitCost;
      balance = Math.max(0, balance - lot.quantity);
      await tx.stockMovement.create({
        data: {
          type: MovementType.TRANSFER_OUT,
          quantity: -lot.quantity,
          reason,
          productId,
          userId,
          warehouseId,
          unitCost: lot.unitCost,
          purchaseItemId: lot.purchaseItemId || undefined,
          balanceAfter: balance,
          referenceType: reference.type,
          referenceId: reference.id,
          documentNumber: reference.number,
        },
      });
    }
    await this.adjustProductStock(tx, productId, warehouseId, -quantity);
    await this.recomputeAverageCost(tx, productId);
    return quantity > 0 ? totalCost / quantity : null;
  }

  // Entrada de un traspaso en la bodega de destino (recepción) o de vuelta en origen (anulación
  // en tránsito). Con el módulo Compras activo crea un lote con el costo con que salió.
  async transferIn(tx: Tx, params: {
    companyId: string; productId: string; warehouseId: string; quantity: number; unitCost: number | null;
    userId?: string; reason: string; reference: StockReference;
  }) {
    const { companyId, productId, warehouseId, quantity, unitCost, userId, reason, reference } = params;
    if (quantity <= 0) return;
    if (!(await this.isPurchasesModuleActive(companyId, tx))) {
      await this.ledger.move(tx, { productId, warehouseId, delta: quantity, type: MovementType.TRANSFER_IN, reason, userId, reference });
      return;
    }

    const before = await this.prepareWarehouse(tx, productId, warehouseId, userId);
    const cost = unitCost ?? Number((await tx.product.findUnique({ where: { id: productId }, select: { cost: true } }))?.cost ?? 0);
    const lot = await tx.purchaseItem.create({
      data: { productId, warehouseId, quantity, remainingQuantity: quantity, unitCost: cost },
    });
    await tx.stockMovement.create({
      data: {
        type: MovementType.TRANSFER_IN,
        quantity,
        reason,
        productId,
        userId,
        warehouseId,
        unitCost: cost,
        purchaseItemId: lot.id,
        balanceAfter: before + quantity,
        referenceType: reference.type,
        referenceId: reference.id,
        documentNumber: reference.number,
      },
    });
    await this.adjustProductStock(tx, productId, warehouseId, quantity);
    await this.recomputeAverageCost(tx, productId);
  }

  // Bootstrap al activar el módulo para una empresa: crea lotes de apertura por cada
  // producto activo con stock y sin lotes previos, usando su stock/costo actuales, para
  // que el FIFO nunca se quede sin de dónde descontar. Si el producto ya tiene stock por
  // bodega (motor de inventario), se crea un lote por bodega sin volver a sumar stock.
  async bootstrapOpeningLots(companyId: string) {
    const products = await this.prisma.product.findMany({
      where: { companyId, active: true, stock: { gt: 0 } },
      include: { _count: { select: { purchaseItems: true } }, productStocks: true },
    });

    const migrated: string[] = [];
    const skipped: Array<{ productId: string; name: string; reason: string }> = [];

    for (const product of products) {
      if (product._count.purchaseItems > 0) continue;
      const unitCost = Number(product.cost ?? 0);

      if (product.productStocks.length > 0) {
        await this.prisma.$transaction(async (tx) => {
          for (const row of product.productStocks) {
            if (row.quantity <= 0) continue;
            await tx.purchaseItem.create({
              data: { productId: product.id, warehouseId: row.warehouseId, quantity: row.quantity, remainingQuantity: row.quantity, unitCost },
            });
          }
        });
        migrated.push(product.id);
        continue;
      }

      if (!product.warehouseId) {
        skipped.push({ productId: product.id, name: product.name, reason: 'Sin bodega asignada' });
        continue;
      }

      const warehouseId = product.warehouseId;
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
        await tx.productStock.create({ data: { productId: product.id, warehouseId, quantity: product.stock } });
        await tx.stockMovement.create({
          data: {
            type: MovementType.PURCHASE,
            quantity: product.stock,
            reason: 'Inventario inicial (activación módulo Compras)',
            productId: product.id,
            warehouseId,
            purchaseItemId: lot.id,
            unitCost,
            balanceAfter: product.stock,
            referenceType: 'INITIAL',
          },
        });
      });
      migrated.push(product.id);
    }

    return { migrated: migrated.length, skipped };
  }
}

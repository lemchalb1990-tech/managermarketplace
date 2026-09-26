import { Injectable, BadRequestException } from '@nestjs/common';
import { MovementType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

export interface StockReference {
  type: 'SALE' | 'TRANSFER' | 'RETURN' | 'ADJUSTMENT' | 'PURCHASE' | 'COUNT' | 'INITIAL';
  id?: string;
  number?: string;
}

export interface StockMoveInput {
  productId: string;
  // Bodega del movimiento. Si no viene, se usa la bodega asignada al producto y, si tampoco
  // tiene, la bodega por defecto de la empresa.
  warehouseId?: string | null;
  delta: number;
  type: MovementType;
  reason?: string;
  userId?: string;
  reference?: StockReference;
  saleItemId?: string;
  purchaseItemId?: string;
  unitCost?: number;
  // false = solo mueve la bodega, sin tocar Product.stock (lo usa quien ya ajustó el total).
  touchTotal?: boolean;
}

export const DEFAULT_WAREHOUSE_NAME = 'Bodega principal';

// Motor único de movimientos de inventario por bodega. Invariante que mantiene:
//   Product.stock = Σ ProductStock.quantity de sus bodegas
// y deja cada cambio en StockMovement con bodega, saldo resultante y documento de origen
// (kardex). Product.stock se sigue moviendo por delta igual que antes, así la sincronización
// con marketplaces, el POS y el catálogo no cambian de comportamiento.
@Injectable()
export class StockLedgerService {
  constructor(private prisma: PrismaService) {}

  // Primera bodega activa de la empresa; si no tiene ninguna, crea "Bodega principal".
  async defaultWarehouseId(tx: Tx, companyId: string): Promise<string> {
    const existing = await tx.warehouse.findFirst({
      where: { companyId, active: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (existing) return existing.id;
    const any = await tx.warehouse.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (any) return any.id;
    const created = await tx.warehouse.create({ data: { companyId, name: DEFAULT_WAREHOUSE_NAME } });
    return created.id;
  }

  async resolveWarehouseId(tx: Tx, product: { companyId: string; warehouseId: string | null }, requested?: string | null): Promise<string> {
    if (requested) {
      const wh = await tx.warehouse.findUnique({ where: { id: requested }, select: { companyId: true } });
      if (!wh || wh.companyId !== product.companyId) throw new BadRequestException('Bodega inválida para esta empresa');
      return requested;
    }
    if (product.warehouseId) return product.warehouseId;
    return this.defaultWarehouseId(tx, product.companyId);
  }

  // Cuadratura perezosa: un producto que todavía no tiene stock por bodega (creado antes de
  // este motor, o importado) deja su stock total actual en la bodega indicada, con un
  // movimiento de saldo inicial, antes de aplicar cualquier movimiento nuevo.
  async seedIfEmpty(tx: Tx, product: { id: string; stock: number }, warehouseId: string, userId?: string) {
    const rows = await tx.productStock.count({ where: { productId: product.id } });
    if (rows > 0) return;
    await tx.productStock.create({ data: { productId: product.id, warehouseId, quantity: Math.max(0, product.stock) } });
    if (product.stock > 0) {
      await tx.stockMovement.create({
        data: {
          type: MovementType.INITIAL,
          quantity: product.stock,
          reason: 'Saldo inicial por bodega',
          productId: product.id,
          warehouseId,
          userId,
          balanceAfter: product.stock,
          referenceType: 'INITIAL',
        },
      });
    }
  }

  async move(tx: Tx, input: StockMoveInput): Promise<{ warehouseId: string; balanceAfter: number; productStock: number }> {
    const product = await tx.product.findUnique({
      where: { id: input.productId },
      select: { id: true, companyId: true, warehouseId: true, stock: true },
    });
    if (!product) throw new BadRequestException('Producto no encontrado');
    const warehouseId = await this.resolveWarehouseId(tx, product, input.warehouseId);
    await this.seedIfEmpty(tx, product, warehouseId, input.userId);

    const row = await tx.productStock.findUnique({ where: { productId_warehouseId: { productId: product.id, warehouseId } } });
    const balanceAfter = Math.max(0, (row?.quantity ?? 0) + input.delta);
    await tx.productStock.upsert({
      where: { productId_warehouseId: { productId: product.id, warehouseId } },
      create: { productId: product.id, warehouseId, quantity: balanceAfter },
      update: { quantity: balanceAfter },
    });

    let productStock = product.stock;
    if (input.touchTotal !== false) {
      productStock = Math.max(0, product.stock + input.delta);
      await tx.product.update({ where: { id: product.id }, data: { stock: productStock } });
    }

    await tx.stockMovement.create({
      data: {
        type: input.type,
        quantity: input.delta,
        reason: input.reason,
        productId: product.id,
        warehouseId,
        userId: input.userId,
        saleItemId: input.saleItemId,
        purchaseItemId: input.purchaseItemId,
        unitCost: input.unitCost,
        balanceAfter,
        referenceType: input.reference?.type,
        referenceId: input.reference?.id,
        documentNumber: input.reference?.number,
      },
    });

    return { warehouseId, balanceAfter, productStock };
  }

  // Stock disponible en una bodega: existencia menos lo reservado por órdenes de trabajo.
  async available(tx: Tx | PrismaService, productId: string, warehouseId: string): Promise<number> {
    const row = await tx.productStock.findUnique({ where: { productId_warehouseId: { productId, warehouseId } } });
    return Math.max(0, (row?.quantity ?? 0) - (row?.reserved ?? 0));
  }
}

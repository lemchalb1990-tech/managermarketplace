import { Injectable, BadRequestException, NotFoundException, ForbiddenException, ConflictException, Logger } from '@nestjs/common';
import { Prisma, ProductType, Role, TransferStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryCostingService } from '../purchases/inventory-costing.service';
import { StockLedgerService } from '../purchases/stock-ledger.service';
import { SyncService } from '../ecommerce/sync/sync.service';
import { CreateTransferDocumentDto, UpdateTransferDocumentDto, ReceiveTransferDto, CancelTransferDto, TransferLineDto } from './dto/inventory.dto';

type Tx = Prisma.TransactionClient;

export const transferNumber = (n: number) => `TR-${String(n).padStart(6, '0')}`;

const DOC_INCLUDE = {
  fromWarehouse: { select: { id: true, name: true } },
  toWarehouse: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  dispatchedBy: { select: { id: true, name: true } },
  receivedBy: { select: { id: true, name: true } },
  cancelledBy: { select: { id: true, name: true } },
  lines: { include: { product: { select: { id: true, sku: true, name: true } } }, orderBy: { id: 'asc' as const } },
} satisfies Prisma.TransferDocumentInclude;

// Traspasos entre bodegas con documento y recepción:
//   DRAFT ──despachar──▶ IN_TRANSIT ──recibir──▶ RECEIVED | RECEIVED_WITH_DIFF
//     └──anular──▶ CANCELLED ◀──anular (vuelve a origen)──┘
// Al despachar sale de la bodega de origen (y del total publicado: lo que está en tránsito
// no se vende en los canales); al recibir entra a la bodega de destino. Lo que no llega
// queda registrado como diferencia en el documento.
@Injectable()
export class TransferDocumentsService {
  private readonly logger = new Logger(TransferDocumentsService.name);

  constructor(
    private prisma: PrismaService,
    private costing: InventoryCostingService,
    private ledger: StockLedgerService,
    private sync: SyncService,
  ) {}

  resolveCompanyId(user: any, companyId?: string): string {
    if (user.role === Role.SUPER_ADMIN) {
      if (!companyId) throw new BadRequestException('companyId requerido para Super Admin');
      return companyId;
    }
    if (!user.companyId) throw new ForbiddenException('Sin empresa asignada');
    return user.companyId;
  }

  private async getOwned(user: any, id: string) {
    const doc = await this.prisma.transferDocument.findUnique({ where: { id }, include: DOC_INCLUDE });
    if (!doc) throw new NotFoundException('Traspaso no encontrado');
    if (user.role !== Role.SUPER_ADMIN && doc.companyId !== user.companyId) throw new ForbiddenException();
    return doc;
  }

  private decorate<T extends { number: number }>(doc: T) {
    return { ...doc, documentNumber: transferNumber(doc.number) };
  }

  // Los traspasos inmediatos antiguos (StockTransfer) ya movieron el stock: se convierten a
  // documentos recibidos, en orden cronológico y antes de numerar traspasos nuevos, para que
  // el historial de traspasos quede completo en un solo lugar.
  private async convertLegacy(companyId: string) {
    const pending = await this.prisma.stockTransfer.findMany({
      where: { companyId, id: { notIn: (await this.prisma.transferDocument.findMany({ where: { companyId, legacyTransferId: { not: null } }, select: { legacyTransferId: true } })).map((d) => d.legacyTransferId!) } },
      orderBy: { createdAt: 'asc' },
    });
    if (!pending.length) return;
    await this.prisma.$transaction(async (tx) => {
      let next = ((await tx.transferDocument.aggregate({ where: { companyId }, _max: { number: true } }))._max.number ?? 0) + 1;
      for (const t of pending) {
        await tx.transferDocument.create({
          data: {
            companyId,
            number: next++,
            status: TransferStatus.RECEIVED,
            notes: t.reason || 'Traspaso registrado antes de los documentos de traspaso',
            legacyTransferId: t.id,
            fromWarehouseId: t.fromWarehouseId,
            toWarehouseId: t.toWarehouseId,
            createdById: t.userId,
            dispatchedById: t.userId,
            receivedById: t.userId,
            createdAt: t.createdAt,
            dispatchedAt: t.createdAt,
            receivedAt: t.createdAt,
            lines: { create: [{ productId: t.productId, quantity: t.quantity, receivedQuantity: t.quantity }] },
          },
        });
      }
    });
    this.logger.log(`Convertidos ${pending.length} traspasos antiguos a documentos (empresa ${companyId})`);
  }

  async list(user: any, q: { companyId?: string; status?: string; warehouseId?: string; search?: string; page?: string }) {
    const companyId = this.resolveCompanyId(user, q.companyId);
    await this.convertLegacy(companyId);

    const where: Prisma.TransferDocumentWhereInput = { companyId };
    if (q.status && (Object.values(TransferStatus) as string[]).includes(q.status)) where.status = q.status as TransferStatus;
    if (q.warehouseId) where.OR = [{ fromWarehouseId: q.warehouseId }, { toWarehouseId: q.warehouseId }];
    const term = q.search?.trim();
    if (term) {
      const n = Number(term.replace(/^TR-?/i, ''));
      where.AND = [{
        OR: [
          ...(Number.isInteger(n) && n > 0 ? [{ number: n }] : []),
          { notes: { contains: term, mode: 'insensitive' as const } },
          { lines: { some: { product: { OR: [{ name: { contains: term, mode: 'insensitive' as const } }, { sku: { contains: term, mode: 'insensitive' as const } }] } } } },
        ],
      }];
    }

    const page = Math.max(1, parseInt(q.page || '1') || 1);
    const take = 25;
    const [docs, total, counts] = await Promise.all([
      this.prisma.transferDocument.findMany({ where, include: DOC_INCLUDE, orderBy: { number: 'desc' }, take, skip: (page - 1) * take }),
      this.prisma.transferDocument.count({ where }),
      this.prisma.transferDocument.groupBy({ by: ['status'], where: { companyId }, _count: { _all: true } }),
    ]);
    const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));
    return { documents: docs.map((d) => this.decorate(d)), total, page, pages: Math.max(1, Math.ceil(total / take)), byStatus };
  }

  async get(user: any, id: string) {
    return this.decorate(await this.getOwned(user, id));
  }

  // Valida bodegas y productos, y agrupa líneas repetidas del mismo producto.
  private async validate(companyId: string, fromWarehouseId: string, toWarehouseId: string, lines: TransferLineDto[]) {
    if (fromWarehouseId === toWarehouseId) throw new BadRequestException('La bodega de origen y destino no pueden ser la misma');
    const whs = await this.prisma.warehouse.findMany({ where: { id: { in: [fromWarehouseId, toWarehouseId] }, companyId } });
    const from = whs.find((w) => w.id === fromWarehouseId);
    const to = whs.find((w) => w.id === toWarehouseId);
    if (!from) throw new BadRequestException('Bodega de origen inválida');
    if (!to) throw new BadRequestException('Bodega de destino inválida');
    if (!from.active || !to.active) throw new BadRequestException('Las dos bodegas deben estar activas');

    const merged = new Map<string, number>();
    for (const l of lines) merged.set(l.productId, (merged.get(l.productId) ?? 0) + l.quantity);
    const products = await this.prisma.product.findMany({ where: { id: { in: [...merged.keys()] }, companyId } });
    for (const pid of merged.keys()) {
      const p = products.find((x) => x.id === pid);
      if (!p) throw new BadRequestException('Uno de los productos no pertenece a esta empresa');
      if (p.type === ProductType.SERVICIO) throw new BadRequestException(`"${p.name}" es un servicio: no tiene stock que traspasar`);
      if (p.dropship) throw new BadRequestException(`"${p.name}" es dropship: su stock es del proveedor`);
      if (!p.active) throw new BadRequestException(`"${p.name}" está inactivo`);
    }
    return [...merged.entries()].map(([productId, quantity]) => ({ productId, quantity }));
  }

  async create(user: any, dto: CreateTransferDocumentDto) {
    const companyId = this.resolveCompanyId(user, dto.companyId);
    await this.convertLegacy(companyId);
    const lines = await this.validate(companyId, dto.fromWarehouseId, dto.toWarehouseId, dto.lines);

    let created: { id: string } | null = null;
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      try {
        created = await this.prisma.$transaction(async (tx) => {
          const number = ((await tx.transferDocument.aggregate({ where: { companyId }, _max: { number: true } }))._max.number ?? 0) + 1;
          return tx.transferDocument.create({
            data: {
              companyId, number,
              fromWarehouseId: dto.fromWarehouseId,
              toWarehouseId: dto.toWarehouseId,
              notes: dto.notes?.trim() || null,
              createdById: user.id,
              lines: { create: lines },
            },
            select: { id: true },
          });
        });
      } catch (err) {
        // Dos traspasos creados al mismo tiempo pueden tomar el mismo número: se reintenta.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && attempt < 2) continue;
        throw err;
      }
    }
    if (dto.dispatch) return this.dispatch(user, created!.id);
    return this.get(user, created!.id);
  }

  async update(user: any, id: string, dto: UpdateTransferDocumentDto) {
    const doc = await this.getOwned(user, id);
    if (doc.status !== TransferStatus.DRAFT) throw new ConflictException('Solo se puede editar un traspaso en borrador');
    const from = dto.fromWarehouseId ?? doc.fromWarehouseId;
    const to = dto.toWarehouseId ?? doc.toWarehouseId;
    const lines = await this.validate(doc.companyId, from, to, dto.lines ?? doc.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })));
    await this.prisma.$transaction(async (tx) => {
      await tx.transferDocument.update({
        where: { id },
        data: { fromWarehouseId: from, toWarehouseId: to, ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}) },
      });
      if (dto.lines) {
        await tx.transferDocumentLine.deleteMany({ where: { documentId: id } });
        await tx.transferDocumentLine.createMany({ data: lines.map((l) => ({ ...l, documentId: id })) });
      }
    });
    return this.get(user, id);
  }

  private async syncTotals(productIds: string[]) {
    const products = await this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, stock: true } });
    for (const p of products) this.sync.syncProduct(p.id, p.stock).catch(() => {});
  }

  async dispatch(user: any, id: string) {
    const doc = await this.getOwned(user, id);
    if (doc.status !== TransferStatus.DRAFT) throw new ConflictException('Solo se puede despachar un traspaso en borrador');
    await this.validate(doc.companyId, doc.fromWarehouseId, doc.toWarehouseId, doc.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })));
    const number = transferNumber(doc.number);
    const reference = { type: 'TRANSFER' as const, id: doc.id, number };

    await this.prisma.$transaction(async (tx) => {
      // Con el documento tomado en la transacción: dos despachos simultáneos no pasan ambos.
      const claimed = await tx.transferDocument.updateMany({
        where: { id, status: TransferStatus.DRAFT },
        data: { status: TransferStatus.IN_TRANSIT, dispatchedAt: new Date(), dispatchedById: user.id },
      });
      if (claimed.count === 0) throw new ConflictException('El traspaso ya fue despachado o anulado');

      for (const line of doc.lines) {
        await this.ensureSeeded(tx, line.productId, user.id);
        const available = await this.ledger.available(tx, line.productId, doc.fromWarehouseId);
        if (available < line.quantity) {
          throw new BadRequestException(
            `Stock insuficiente de "${line.product.name}" en ${doc.fromWarehouse.name}: disponible ${available}, solicitado ${line.quantity}`,
          );
        }
        const unitCost = await this.costing.transferOut(tx, {
          companyId: doc.companyId, productId: line.productId, warehouseId: doc.fromWarehouseId, quantity: line.quantity,
          userId: user.id, reason: `Traspaso ${number} a ${doc.toWarehouse.name}`, reference,
        });
        if (unitCost != null) await tx.transferDocumentLine.update({ where: { id: line.id }, data: { unitCost } });
      }
    });

    await this.syncTotals(doc.lines.map((l) => l.productId));
    return this.get(user, id);
  }

  async receive(user: any, id: string, dto: ReceiveTransferDto) {
    const doc = await this.getOwned(user, id);
    if (doc.status !== TransferStatus.IN_TRANSIT) throw new ConflictException('Solo se puede recibir un traspaso despachado (en tránsito)');
    const byLine = new Map(dto.lines.map((l) => [l.lineId, l.receivedQuantity]));
    for (const lineId of byLine.keys()) {
      if (!doc.lines.some((l) => l.id === lineId)) throw new BadRequestException('Una de las líneas no pertenece a este traspaso');
    }
    const received = doc.lines.map((l) => {
      const qty = byLine.has(l.id) ? byLine.get(l.id)! : l.quantity;
      if (qty > l.quantity) throw new BadRequestException(`No se puede recibir más de lo despachado para "${l.product.name}" (${l.quantity})`);
      return { line: l, qty };
    });
    const withDiff = received.some((r) => r.qty !== r.line.quantity);
    const number = transferNumber(doc.number);
    const reference = { type: 'TRANSFER' as const, id: doc.id, number };

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.transferDocument.updateMany({
        where: { id, status: TransferStatus.IN_TRANSIT },
        data: {
          status: withDiff ? TransferStatus.RECEIVED_WITH_DIFF : TransferStatus.RECEIVED,
          receivedAt: new Date(),
          receivedById: user.id,
          ...(dto.notes?.trim() ? { notes: [doc.notes, `Recepción: ${dto.notes.trim()}`].filter(Boolean).join('\n') } : {}),
        },
      });
      if (claimed.count === 0) throw new ConflictException('El traspaso ya fue recibido o anulado');

      for (const { line, qty } of received) {
        await tx.transferDocumentLine.update({ where: { id: line.id }, data: { receivedQuantity: qty } });
        await this.costing.transferIn(tx, {
          companyId: doc.companyId, productId: line.productId, warehouseId: doc.toWarehouseId, quantity: qty,
          unitCost: line.unitCost != null ? Number(line.unitCost) : null,
          userId: user.id, reason: `Recepción traspaso ${number} desde ${doc.fromWarehouse.name}`, reference,
        });
      }
    });

    await this.syncTotals(doc.lines.map((l) => l.productId));
    return this.get(user, id);
  }

  async cancel(user: any, id: string, dto: CancelTransferDto) {
    const doc = await this.getOwned(user, id);
    if (doc.status !== TransferStatus.DRAFT && doc.status !== TransferStatus.IN_TRANSIT) {
      throw new ConflictException('Un traspaso recibido no se puede anular: registra un traspaso de vuelta');
    }
    const wasInTransit = doc.status === TransferStatus.IN_TRANSIT;
    const number = transferNumber(doc.number);
    const reference = { type: 'TRANSFER' as const, id: doc.id, number };

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.transferDocument.updateMany({
        where: { id, status: doc.status },
        data: { status: TransferStatus.CANCELLED, cancelledAt: new Date(), cancelledById: user.id, cancelReason: dto.reason.trim() },
      });
      if (claimed.count === 0) throw new ConflictException('El traspaso cambió de estado; recarga e intenta de nuevo');
      if (!wasInTransit) return;
      // En tránsito: la mercadería vuelve a la bodega de origen con el mismo costo.
      for (const line of doc.lines) {
        await this.costing.transferIn(tx, {
          companyId: doc.companyId, productId: line.productId, warehouseId: doc.fromWarehouseId, quantity: line.quantity,
          unitCost: line.unitCost != null ? Number(line.unitCost) : null,
          userId: user.id, reason: `Anulación traspaso ${number}: vuelve a ${doc.fromWarehouse.name}`, reference,
        });
      }
    });

    if (wasInTransit) await this.syncTotals(doc.lines.map((l) => l.productId));
    return this.get(user, id);
  }

  private async ensureSeeded(tx: Tx, productId: string, userId?: string) {
    const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, companyId: true, warehouseId: true, stock: true } });
    if (!product) return;
    await this.ledger.seedIfEmpty(tx, product, await this.ledger.resolveWarehouseId(tx, product), userId);
  }
}

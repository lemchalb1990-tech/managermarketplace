import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryCostingService } from './inventory-costing.service';
import { CreatePurchaseDto } from './dto/purchase.dto';

@Injectable()
export class PurchasesService {
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

  async findAllPaginated(user: any, query: { companyId?: string; page?: string }) {
    const companyId = user.role === Role.SUPER_ADMIN ? query.companyId : user.companyId;
    const where: any = {};
    if (companyId) where.companyId = companyId;

    const page = Math.max(1, parseInt(query.page || '1'));
    const take = 30;
    const skip = (page - 1) * take;

    const [purchases, total] = await Promise.all([
      this.prisma.purchase.findMany({
        where,
        include: {
          supplier: { select: { id: true, name: true } },
          warehouse: { select: { id: true, name: true } },
          user: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { date: 'desc' },
        take,
        skip,
      }),
      this.prisma.purchase.count({ where }),
    ]);

    return { purchases, total, page, pages: Math.ceil(total / take) };
  }

  async findOne(id: string, user: any) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true } },
        user: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
    });
    if (!purchase) throw new NotFoundException('Compra no encontrada');
    if (user.role !== Role.SUPER_ADMIN && purchase.companyId !== user.companyId) throw new ForbiddenException();
    return purchase;
  }

  async create(dto: CreatePurchaseDto, user: any) {
    const companyId = this.resolveCompanyId(user, dto.companyId);

    const active = await this.costing.isPurchasesModuleActive(companyId);
    if (!active) throw new ForbiddenException('El módulo de Compras no está activo para esta empresa');

    const [supplier, warehouse, products] = await Promise.all([
      this.prisma.supplier.findUnique({ where: { id: dto.supplierId } }),
      this.prisma.warehouse.findUnique({ where: { id: dto.warehouseId } }),
      this.prisma.product.findMany({ where: { id: { in: dto.items.map((i) => i.productId) }, companyId } }),
    ]);
    if (!supplier || supplier.companyId !== companyId) throw new BadRequestException('Proveedor inválido');
    if (!warehouse || warehouse.companyId !== companyId) throw new BadRequestException('Bodega inválida');
    if (products.length !== dto.items.length) throw new BadRequestException('Uno o más productos no pertenecen a esta empresa');

    const total = dto.items.reduce((sum, i) => sum + i.quantity * i.unitCost, 0);

    const purchase = await this.prisma.$transaction(async (tx) => {
      const created = await tx.purchase.create({
        data: {
          companyId,
          supplierId: dto.supplierId,
          warehouseId: dto.warehouseId,
          documentNumber: dto.documentNumber,
          notes: dto.notes,
          date: dto.date ? new Date(dto.date) : undefined,
          total,
          userId: user.id,
          items: {
            create: dto.items.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
              unitCost: i.unitCost,
              remainingQuantity: i.quantity,
              warehouseId: dto.warehouseId,
            })),
          },
        },
        include: { items: true },
      });

      for (const item of created.items) {
        await this.costing.receivePurchaseItem(tx, {
          productId: item.productId,
          warehouseId: dto.warehouseId,
          quantity: item.quantity,
          unitCost: Number(item.unitCost),
          purchaseItemId: item.id,
          userId: user.id,
          reason: `Compra ${dto.documentNumber || created.id}`,
        });
      }

      return created;
    });

    return this.findOne(purchase.id, user);
  }
}

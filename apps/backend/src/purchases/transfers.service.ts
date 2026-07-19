import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryCostingService } from './inventory-costing.service';
import { CreateTransferDto } from './dto/transfer.dto';

@Injectable()
export class TransfersService {
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

    const [transfers, total] = await Promise.all([
      this.prisma.stockTransfer.findMany({
        where,
        include: {
          product: { select: { id: true, name: true, sku: true } },
          fromWarehouse: { select: { id: true, name: true } },
          toWarehouse: { select: { id: true, name: true } },
          user: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.stockTransfer.count({ where }),
    ]);

    return { transfers, total, page, pages: Math.ceil(total / take) };
  }

  async create(dto: CreateTransferDto, user: any) {
    const companyId = this.resolveCompanyId(user, dto.companyId);

    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException('La bodega de origen y destino no pueden ser la misma');
    }

    const active = await this.costing.isPurchasesModuleActive(companyId);
    if (!active) throw new ForbiddenException('El módulo de Compras no está activo para esta empresa');

    const [product, fromWarehouse, toWarehouse, stock] = await Promise.all([
      this.prisma.product.findUnique({ where: { id: dto.productId } }),
      this.prisma.warehouse.findUnique({ where: { id: dto.fromWarehouseId } }),
      this.prisma.warehouse.findUnique({ where: { id: dto.toWarehouseId } }),
      this.prisma.productStock.findUnique({
        where: { productId_warehouseId: { productId: dto.productId, warehouseId: dto.fromWarehouseId } },
      }),
    ]);
    if (!product || product.companyId !== companyId) throw new BadRequestException('Producto inválido');
    if (!fromWarehouse || fromWarehouse.companyId !== companyId) throw new BadRequestException('Bodega de origen inválida');
    if (!toWarehouse || toWarehouse.companyId !== companyId) throw new BadRequestException('Bodega de destino inválida');
    if (!stock || stock.quantity < dto.quantity) {
      throw new BadRequestException(
        `Stock insuficiente en la bodega de origen: disponible ${stock?.quantity ?? 0}, solicitado ${dto.quantity}`,
      );
    }

    const transfer = await this.prisma.$transaction(async (tx) => {
      const created = await tx.stockTransfer.create({
        data: {
          companyId,
          productId: dto.productId,
          fromWarehouseId: dto.fromWarehouseId,
          toWarehouseId: dto.toWarehouseId,
          quantity: dto.quantity,
          reason: dto.reason,
          userId: user.id,
        },
      });

      await this.costing.transferStock(tx, {
        productId: dto.productId,
        fromWarehouseId: dto.fromWarehouseId,
        toWarehouseId: dto.toWarehouseId,
        quantity: dto.quantity,
        userId: user.id,
        reason: dto.reason || `Traspaso #${created.id}`,
      });

      return created;
    });

    return this.prisma.stockTransfer.findUnique({
      where: { id: transfer.id },
      include: {
        product: { select: { id: true, name: true, sku: true } },
        fromWarehouse: { select: { id: true, name: true } },
        toWarehouse: { select: { id: true, name: true } },
      },
    });
  }
}

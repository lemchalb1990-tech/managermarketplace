import { Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException } from '@nestjs/common';
import { Role, TransferStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWarehouseDto, UpdateWarehouseDto } from './dto/warehouse.dto';

@Injectable()
export class WarehousesService {
  constructor(private prisma: PrismaService) {}

  private resolveCompanyId(user: any, companyId?: string): string {
    if (user.role === Role.SUPER_ADMIN) {
      if (!companyId) throw new BadRequestException('companyId requerido para Super Admin');
      return companyId;
    }
    if (!user.companyId) throw new ForbiddenException('Sin empresa asignada');
    return user.companyId;
  }

  async findAll(user: any, companyId?: string) {
    const where = user.role === Role.SUPER_ADMIN
      ? (companyId ? { companyId } : {})
      : { companyId: user.companyId };
    const warehouses = await this.prisma.warehouse.findMany({
      where,
      include: {
        _count: { select: { products: true } },
        company: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!warehouses.length) return warehouses;
    const ids = warehouses.map((w) => w.id);
    // Existencias reales por bodega (stock por bodega), no solo productos asignados.
    const [stats, openIn, openOut] = await Promise.all([
      this.prisma.$queryRaw<Array<{ warehouseId: string; units: bigint; skus: bigint; value: number | null }>>`
        SELECT ps."warehouseId", COALESCE(SUM(ps.quantity), 0) AS units,
               COUNT(*) FILTER (WHERE ps.quantity > 0) AS skus,
               COALESCE(SUM(ps.quantity * COALESCE(p.cost, 0)), 0)::float AS value
        FROM product_stock ps JOIN products p ON p.id = ps."productId"
        WHERE ps."warehouseId" = ANY(${ids})
        GROUP BY ps."warehouseId"`,
      this.prisma.transferDocument.groupBy({ by: ['toWarehouseId'], where: { toWarehouseId: { in: ids }, status: TransferStatus.IN_TRANSIT }, _count: { _all: true } }),
      this.prisma.transferDocument.groupBy({ by: ['fromWarehouseId'], where: { fromWarehouseId: { in: ids }, status: { in: [TransferStatus.DRAFT, TransferStatus.IN_TRANSIT] } }, _count: { _all: true } }),
    ]);
    return warehouses.map((w) => {
      const st = stats.find((x) => x.warehouseId === w.id);
      return {
        ...w,
        units: Number(st?.units ?? 0),
        skus: Number(st?.skus ?? 0),
        value: Math.round(Number(st?.value ?? 0)),
        incomingTransfers: openIn.find((x) => x.toWarehouseId === w.id)?._count._all ?? 0,
        outgoingTransfers: openOut.find((x) => x.fromWarehouseId === w.id)?._count._all ?? 0,
      };
    });
  }

  async create(dto: CreateWarehouseDto, user: any) {
    const companyId = this.resolveCompanyId(user, dto.companyId);
    const { companyId: _omit, ...data } = dto;
    return this.prisma.warehouse.create({
      data: { ...data, companyId },
      include: { _count: { select: { products: true } } },
    });
  }

  async update(id: string, dto: UpdateWarehouseDto, user: any) {
    const wh = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!wh) throw new NotFoundException('Bodega no encontrada');
    if (user.role !== Role.SUPER_ADMIN && wh.companyId !== user.companyId) throw new ForbiddenException();
    return this.prisma.warehouse.update({
      where: { id },
      data: dto,
      include: { _count: { select: { products: true } } },
    });
  }

  async remove(id: string, user: any) {
    const wh = await this.prisma.warehouse.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!wh) throw new NotFoundException('Bodega no encontrada');
    if (user.role !== Role.SUPER_ADMIN && wh.companyId !== user.companyId) throw new ForbiddenException();
    if (wh._count.products > 0) {
      throw new ConflictException(
        `La bodega tiene ${wh._count.products} producto(s) asignado(s). Reasígnalos antes de eliminar.`,
      );
    }
    const [stock, openTransfers, movements, documents, legacyTransfers] = await Promise.all([
      this.prisma.productStock.aggregate({ where: { warehouseId: id }, _sum: { quantity: true } }),
      this.prisma.transferDocument.count({
        where: { OR: [{ fromWarehouseId: id }, { toWarehouseId: id }], status: { in: [TransferStatus.DRAFT, TransferStatus.IN_TRANSIT] } },
      }),
      this.prisma.stockMovement.count({ where: { warehouseId: id } }),
      this.prisma.transferDocument.count({ where: { OR: [{ fromWarehouseId: id }, { toWarehouseId: id }] } }),
      this.prisma.stockTransfer.count({ where: { OR: [{ fromWarehouseId: id }, { toWarehouseId: id }] } }),
    ]);
    if ((stock._sum.quantity ?? 0) > 0) {
      throw new ConflictException(`La bodega tiene ${stock._sum.quantity} unidad(es) en stock. Traspásalas antes de eliminarla.`);
    }
    if (openTransfers > 0) {
      throw new ConflictException('La bodega tiene traspasos en borrador o en tránsito. Recíbelos o anúlalos antes de eliminarla.');
    }
    // Con historial de movimientos no se borra (perdería el kardex): se desactiva.
    if (movements + documents + legacyTransfers > 0) {
      throw new ConflictException('La bodega tiene historial de movimientos: desactívala en vez de eliminarla, así se conserva el historial.');
    }
    await this.prisma.productStock.deleteMany({ where: { warehouseId: id } });
    return this.prisma.warehouse.delete({ where: { id } });
  }
}

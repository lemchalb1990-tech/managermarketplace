import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWarehouseDto, UpdateWarehouseDto } from './dto/warehouse.dto';

@Injectable()
export class WarehousesService {
  constructor(private prisma: PrismaService) {}

  async findAll(user: any) {
    const where = user.role === Role.SUPER_ADMIN ? {} : { companyId: user.companyId };
    return this.prisma.warehouse.findMany({
      where,
      include: {
        _count: { select: { products: true } },
        company: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(dto: CreateWarehouseDto, user: any) {
    if (!user.companyId) throw new ForbiddenException('Sin empresa asignada');
    const companyId = user.role === Role.SUPER_ADMIN ? user.companyId : user.companyId;
    return this.prisma.warehouse.create({
      data: { ...dto, companyId },
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
    return this.prisma.warehouse.delete({ where: { id } });
  }
}

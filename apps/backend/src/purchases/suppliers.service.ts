import { Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';

@Injectable()
export class SuppliersService {
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
    return this.prisma.supplier.findMany({
      where,
      include: { _count: { select: { purchases: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: CreateSupplierDto, user: any) {
    const companyId = this.resolveCompanyId(user, dto.companyId);
    const { companyId: _omit, ...data } = dto;
    return this.prisma.supplier.create({ data: { ...data, companyId } });
  }

  async update(id: string, dto: UpdateSupplierDto, user: any) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException('Proveedor no encontrado');
    if (user.role !== Role.SUPER_ADMIN && supplier.companyId !== user.companyId) throw new ForbiddenException();
    return this.prisma.supplier.update({ where: { id }, data: dto });
  }

  async remove(id: string, user: any) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: { _count: { select: { purchases: true } } },
    });
    if (!supplier) throw new NotFoundException('Proveedor no encontrado');
    if (user.role !== Role.SUPER_ADMIN && supplier.companyId !== user.companyId) throw new ForbiddenException();
    if (supplier._count.purchases > 0) {
      throw new ConflictException(`El proveedor tiene ${supplier._count.purchases} compra(s) registrada(s). Desactívalo en vez de eliminarlo.`);
    }
    return this.prisma.supplier.delete({ where: { id } });
  }
}

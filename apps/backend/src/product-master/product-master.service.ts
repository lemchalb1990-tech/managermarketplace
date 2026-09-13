import { Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductMasterDto, UpdateProductMasterDto } from './dto/product-master.dto';

// Fase 1 de la reorganización de catálogo: CRUD del Producto Maestro y un enganche
// manual a productos existentes. A propósito NO hay nada automático acá — ni auto-crear
// un maestro por SKU, ni auto-vincular productos por coincidencia. Eso es exactamente lo
// que la fase 0 vino a evitar. La migración masiva de los 4.139 registros es la fase 10.
@Injectable()
export class ProductMasterService {
  constructor(private prisma: PrismaService) {}

  private resolveCompanyId(user: any, companyId?: string): string {
    if (user.role === Role.SUPER_ADMIN) {
      if (!companyId) throw new BadRequestException('companyId requerido para Super Admin');
      return companyId;
    }
    if (!user.companyId) throw new ForbiddenException('Sin empresa asignada');
    return user.companyId;
  }

  private baseWhere(user: any, companyId?: string) {
    return user.role === Role.SUPER_ADMIN
      ? (companyId ? { companyId } : {})
      : { companyId: user.companyId };
  }

  async findAll(user: any, companyId?: string) {
    return this.prisma.productMaster.findMany({
      where: this.baseWhere(user, companyId),
      include: { _count: { select: { products: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, user: any) {
    const master = await this.prisma.productMaster.findUnique({
      where: { id },
      include: {
        products: {
          select: {
            id: true, sku: true, name: true, stock: true, price: true, active: true,
            listings: { select: { id: true, status: true, connection: { select: { name: true, marketplace: true } } } },
          },
        },
      },
    });
    if (!master) throw new NotFoundException('Producto maestro no encontrado');
    if (user.role !== Role.SUPER_ADMIN && master.companyId !== user.companyId) throw new ForbiddenException();
    return master;
  }

  async create(dto: CreateProductMasterDto, user: any) {
    const companyId = this.resolveCompanyId(user, dto.companyId);
    const { companyId: _omit, ...data } = dto;
    const dup = await this.prisma.productMaster.findUnique({
      where: { masterSku_companyId: { masterSku: data.masterSku, companyId } },
    });
    if (dup) throw new ConflictException('Ya existe un producto maestro con ese SKU maestro');
    return this.prisma.productMaster.create({ data: { ...data, companyId } });
  }

  async update(id: string, dto: UpdateProductMasterDto, user: any) {
    const master = await this.prisma.productMaster.findUnique({ where: { id } });
    if (!master) throw new NotFoundException('Producto maestro no encontrado');
    if (user.role !== Role.SUPER_ADMIN && master.companyId !== user.companyId) throw new ForbiddenException();

    if (dto.masterSku && dto.masterSku !== master.masterSku) {
      const dup = await this.prisma.productMaster.findUnique({
        where: { masterSku_companyId: { masterSku: dto.masterSku, companyId: master.companyId } },
      });
      if (dup) throw new ConflictException('Ya existe un producto maestro con ese SKU maestro');
    }
    return this.prisma.productMaster.update({ where: { id }, data: dto });
  }

  async remove(id: string, user: any) {
    const master = await this.prisma.productMaster.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!master) throw new NotFoundException('Producto maestro no encontrado');
    if (user.role !== Role.SUPER_ADMIN && master.companyId !== user.companyId) throw new ForbiddenException();
    if (master._count.products > 0) {
      throw new ConflictException('Este producto maestro tiene productos vinculados. Desvincúlalos antes de eliminarlo.');
    }
    return this.prisma.productMaster.delete({ where: { id } });
  }

  // Enganche manual — el usuario elige explícitamente qué producto va bajo qué maestro.
  async linkProduct(masterId: string, productId: string, user: any) {
    const master = await this.prisma.productMaster.findUnique({ where: { id: masterId } });
    if (!master) throw new NotFoundException('Producto maestro no encontrado');
    if (user.role !== Role.SUPER_ADMIN && master.companyId !== user.companyId) throw new ForbiddenException();

    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Producto no encontrado');
    if (product.companyId !== master.companyId) {
      throw new BadRequestException('El producto no pertenece a la misma empresa que el producto maestro');
    }

    return this.prisma.product.update({
      where: { id: productId },
      data: { productMasterId: masterId },
    });
  }

  async unlinkProduct(productId: string, user: any) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Producto no encontrado');
    if (user.role !== Role.SUPER_ADMIN && product.companyId !== user.companyId) throw new ForbiddenException();
    return this.prisma.product.update({ where: { id: productId }, data: { productMasterId: null } });
  }
}

import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto, UpdateProductDto, AdjustStockDto } from './dto/product.dto';

@Injectable()
export class CatalogService {
  constructor(private prisma: PrismaService) {}

  private getCompanyId(user: any): string {
    if (!user.companyId) throw new ForbiddenException('Sin empresa asignada');
    return user.companyId;
  }

  async create(dto: CreateProductDto, user: any) {
    const companyId = this.getCompanyId(user);
    const exists = await this.prisma.product.findUnique({
      where: { sku_companyId: { sku: dto.sku, companyId } },
    });
    if (exists) throw new ConflictException(`El SKU ${dto.sku} ya existe en tu catálogo`);

    return this.prisma.product.create({
      data: { ...dto, companyId },
      include: { images: true },
    });
  }

  async findAll(user: any) {
    const companyId = user.role === Role.SUPER_ADMIN ? undefined : this.getCompanyId(user);
    return this.prisma.product.findMany({
      where: companyId ? { companyId } : {},
      include: { images: { orderBy: { order: 'asc' } }, _count: { select: { listings: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user: any) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        images: { orderBy: { order: 'asc' } },
        listings: { include: { connection: true } },
      },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
    if (user.role !== Role.SUPER_ADMIN && product.companyId !== user.companyId) {
      throw new ForbiddenException();
    }
    return product;
  }

  async update(id: string, dto: UpdateProductDto, user: any) {
    await this.findOne(id, user);
    return this.prisma.product.update({
      where: { id },
      data: dto,
      include: { images: true },
    });
  }

  async adjustStock(id: string, dto: AdjustStockDto, user: any) {
    const product = await this.findOne(id, user);
    const newStock = product.stock + dto.quantity;
    if (newStock < 0) throw new BadRequestException('El stock no puede ser negativo');

    return this.prisma.product.update({
      where: { id },
      data: { stock: newStock },
    });
  }

  async addImage(productId: string, filename: string, url: string, user: any) {
    await this.findOne(productId, user);
    const count = await this.prisma.productImage.count({ where: { productId } });
    return this.prisma.productImage.create({
      data: { productId, filename, url, isPrimary: count === 0, order: count },
    });
  }

  async removeImage(productId: string, imageId: string, user: any) {
    await this.findOne(productId, user);
    return this.prisma.productImage.delete({ where: { id: imageId, productId } });
  }

  async setPrimaryImage(productId: string, imageId: string, user: any) {
    await this.findOne(productId, user);
    await this.prisma.productImage.updateMany({
      where: { productId },
      data: { isPrimary: false },
    });
    return this.prisma.productImage.update({
      where: { id: imageId },
      data: { isPrimary: true },
    });
  }
}

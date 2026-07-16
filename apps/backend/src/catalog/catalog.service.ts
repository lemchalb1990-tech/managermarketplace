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

export interface BulkDeleteFailure {
  id: string;
  name: string;
  reason: string;
}

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
      include: {
        images: { orderBy: { order: 'asc' } },
        listings: { include: { connection: { select: { id: true, name: true } } } },
        warehouse: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user: any) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        images: { orderBy: { order: 'asc' } },
        listings: { include: { connection: true } },
        warehouse: { select: { id: true, name: true } },
      },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
    if (user.role !== Role.SUPER_ADMIN && product.companyId !== user.companyId) {
      throw new ForbiddenException();
    }
    return product;
  }

  async update(id: string, dto: UpdateProductDto, user: any) {
    const product = await this.findOne(id, user);
    if (!product.active && dto.active !== true) {
      throw new BadRequestException('El producto está inactivo. Reactívalo antes de modificarlo.');
    }
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

  private async filterOwned(ids: string[], user: any) {
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, companyId: true },
    });
    return products.filter((p) => user.role === Role.SUPER_ADMIN || p.companyId === user.companyId);
  }

  async bulkSetActive(ids: string[], active: boolean, user: any) {
    const owned = await this.filterOwned(ids, user);
    if (!owned.length) return { updated: 0 };
    await this.prisma.product.updateMany({
      where: { id: { in: owned.map((p) => p.id) } },
      data: { active },
    });
    return { updated: owned.length };
  }

  async bulkDelete(ids: string[], user: any) {
    const owned = await this.filterOwned(ids, user);
    let deleted = 0;
    const failed: BulkDeleteFailure[] = [];
    for (const p of owned) {
      const [listingCount, saleItemCount, stockMovementCount] = await Promise.all([
        this.prisma.listing.count({ where: { productId: p.id } }),
        this.prisma.saleItem.count({ where: { productId: p.id } }),
        this.prisma.stockMovement.count({ where: { productId: p.id } }),
      ]);
      if (listingCount > 0) {
        failed.push({
          id: p.id,
          name: p.name,
          reason: 'Tiene una publicación en Mercado Libre (u otra plataforma). Despublícala desde la pestaña "Mercado Libre" del producto antes de eliminarlo.',
        });
        continue;
      }
      if (saleItemCount > 0 || stockMovementCount > 0) {
        failed.push({
          id: p.id,
          name: p.name,
          reason: 'Tiene ventas o movimientos de stock registrados. Desactívalo en vez de eliminarlo para conservar el historial.',
        });
        continue;
      }
      try {
        await this.prisma.product.delete({ where: { id: p.id } });
        deleted++;
      } catch {
        failed.push({ id: p.id, name: p.name, reason: 'No se pudo eliminar por registros asociados.' });
      }
    }
    return { deleted, failed };
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

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
import { InventoryCostingService } from '../purchases/inventory-costing.service';

export interface BulkDeleteFailure {
  id: string;
  name: string;
  reason: string;
  canForce?: boolean;
}

@Injectable()
export class CatalogService {
  constructor(
    private prisma: PrismaService,
    private costing: InventoryCostingService,
  ) {}

  private getCompanyId(user: any): string {
    if (!user.companyId) throw new ForbiddenException('Sin empresa asignada');
    return user.companyId;
  }

  private async validateWarehouseId(warehouseId: string | null | undefined, companyId: string) {
    if (!warehouseId) return;
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id: warehouseId } });
    if (!warehouse || warehouse.companyId !== companyId) {
      throw new BadRequestException('La bodega seleccionada no pertenece a esta empresa');
    }
  }

  async create(dto: CreateProductDto, user: any) {
    const companyId = this.getCompanyId(user);
    const exists = await this.prisma.product.findUnique({
      where: { sku_companyId: { sku: dto.sku, companyId } },
    });
    if (exists) throw new ConflictException(`El SKU ${dto.sku} ya existe en tu catálogo`);
    await this.validateWarehouseId(dto.warehouseId, companyId);

    return this.prisma.product.create({
      data: { ...dto, companyId },
      include: { images: true },
    });
  }

  async findAll(user: any, companyIdParam?: string) {
    const companyId = user.role === Role.SUPER_ADMIN ? companyIdParam : this.getCompanyId(user);
    return this.prisma.product.findMany({
      where: companyId ? { companyId } : {},
      include: {
        images: { orderBy: { order: 'asc' } },
        listings: { include: { connection: { select: { id: true, name: true } } } },
        warehouse: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findAllPaginated(user: any, query: { page?: string; search?: string; warehouseId?: string; category?: string; type?: string; active?: string; companyId?: string; inStock?: string; pageSize?: string; sortBy?: string; sortDir?: string }) {
    const companyId = user.role === Role.SUPER_ADMIN ? query.companyId : this.getCompanyId(user);

    const where: any = {};
    if (companyId) where.companyId = companyId;
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.category) where.category = query.category;
    if (query.type) where.type = query.type;
    if (query.inStock === 'true') where.stock = { gt: 0 };
    if (query.active === 'true') where.active = true;
    else if (query.active === 'false') where.active = false;
    else if (query.active === 'paused') where.listings = { some: { status: 'PAUSED' } };
    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { sku: { contains: term, mode: 'insensitive' } },
      ];
    }

    const page = Math.max(1, parseInt(query.page || '1'));
    const take = Math.min(100, Math.max(1, parseInt(query.pageSize || '50') || 50));
    const skip = (page - 1) * take;

    const SORTABLE_FIELDS = ['sku', 'name', 'cost', 'price', 'mlPrice', 'stock'];
    const dir = query.sortDir === 'desc' ? 'desc' : 'asc';
    let orderBy: any = { name: 'asc' };
    if (query.sortBy === 'warehouse') {
      orderBy = { warehouse: { name: dir } };
    } else if (query.sortBy && SORTABLE_FIELDS.includes(query.sortBy)) {
      orderBy = { [query.sortBy]: dir };
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          images: { orderBy: { order: 'asc' } },
          listings: { include: { connection: { select: { id: true, name: true } } } },
          warehouse: { select: { id: true, name: true } },
          _count: { select: { purchaseItems: true } },
        },
        orderBy,
        take,
        skip,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { products, total, page, pages: Math.ceil(total / take) };
  }

  async listCategories(user: any, companyIdParam?: string): Promise<string[]> {
    const companyId = user.role === Role.SUPER_ADMIN ? companyIdParam : this.getCompanyId(user);
    const rows = await this.prisma.product.findMany({
      where: { ...(companyId ? { companyId } : {}), category: { not: null } },
      distinct: ['category'],
      select: { category: true },
      orderBy: { category: 'asc' },
    });
    return rows.map((r) => r.category!).filter(Boolean);
  }

  async findOne(id: string, user: any) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        images: { orderBy: { order: 'asc' } },
        listings: { include: { connection: true } },
        warehouse: { select: { id: true, name: true } },
        _count: { select: { purchaseItems: true } },
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
    if (dto.sku && dto.sku !== product.sku) {
      const exists = await this.prisma.product.findUnique({
        where: { sku_companyId: { sku: dto.sku, companyId: product.companyId } },
      });
      if (exists) throw new ConflictException(`El SKU ${dto.sku} ya existe en tu catálogo`);
    }
    if (dto.warehouseId) await this.validateWarehouseId(dto.warehouseId, product.companyId);

    const data = { ...dto };
    // Con el módulo de Compras activo, el costo de un producto que ya tiene lotes se
    // calcula automáticamente (promedio ponderado) — no se puede sobreescribir a mano.
    // Los productos sin lotes todavía (sin compras registradas) siguen aceptando costo
    // manual hasta su primera compra.
    if ((product as any)._count?.purchaseItems > 0 && (await this.costing.isPurchasesModuleActive(product.companyId))) {
      delete data.cost;
    }

    return this.prisma.product.update({
      where: { id },
      data,
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

  // Para SUPER_ADMIN y COMPANY_ADMIN (acotado a los productos de su propia empresa): borra
  // el vínculo interno (Listing) de los productos indicados, sin llamar a la API del
  // marketplace. La publicación sigue viva en Mercado Libre (u otra plataforma); el sistema
  // simplemente deja de rastrearla.
  async bulkDeleteListings(ids: string[], user: any) {
    if (user.role !== Role.SUPER_ADMIN && user.role !== Role.COMPANY_ADMIN) throw new ForbiddenException();
    const owned = await this.filterOwned(ids, user);
    if (!owned.length) return { deleted: 0 };
    const result = await this.prisma.listing.deleteMany({
      where: { productId: { in: owned.map((p) => p.id) } },
    });
    return { deleted: result.count };
  }

  // Igual que bulkDeleteListings pero para un solo producto/conexión, desde la ficha del
  // producto: borra el vínculo interno sin llamar a la API del marketplace.
  async deleteListing(productId: string, connectionId: string, user: any) {
    if (user.role !== Role.SUPER_ADMIN && user.role !== Role.COMPANY_ADMIN) throw new ForbiddenException();
    const listing = await this.prisma.listing.findUnique({
      where: { productId_connectionId: { productId, connectionId } },
      include: { product: { select: { companyId: true } } },
    });
    if (!listing) throw new NotFoundException('Publicación no encontrada');
    if (user.role !== Role.SUPER_ADMIN && listing.product.companyId !== user.companyId) {
      throw new ForbiddenException();
    }
    await this.prisma.listing.delete({ where: { id: listing.id } });
    return { deleted: true };
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
          // Si no hay saleItemCount, los movimientos son solo el registro histórico de ventas
          // que ya fueron eliminadas (StockMovement.saleItemId queda en null al borrar la venta) —
          // en ese caso es seguro forzar el borrado desde el aplicativo (ver forceDeleteProduct).
          canForce: saleItemCount === 0,
          reason: saleItemCount > 0
            ? 'Tiene ventas registradas. Desactívalo en vez de eliminarlo para conservar el historial.'
            : 'Tiene movimientos de stock registrados (venta ya eliminada). Puedes forzar la eliminación para borrar también ese historial.',
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

  // Fuerza el borrado de un producto que quedó bloqueado solo por historial de inventario
  // (movimientos de stock huérfanos de una venta ya eliminada, lotes de compra, stock por
  // bodega, traspasos, etc.), nunca si tiene ventas (SaleItem) o una publicación activa —
  // esos casos siguen bloqueados y deben resolverse desde sus flujos correspondientes.
  async forceDeleteProduct(id: string, user: any) {
    const product = await this.findOne(id, user);

    const [listingCount, saleItemCount] = await Promise.all([
      this.prisma.listing.count({ where: { productId: id } }),
      this.prisma.saleItem.count({ where: { productId: id } }),
    ]);
    if (listingCount > 0) {
      throw new BadRequestException(
        'Tiene una publicación en Mercado Libre (u otra plataforma). Despublícala desde la pestaña "Mercado Libre" del producto antes de eliminarlo.',
      );
    }
    if (saleItemCount > 0) {
      throw new BadRequestException('Tiene ventas registradas. Desactívalo en vez de eliminarlo para conservar el historial.');
    }

    await this.prisma.$transaction([
      this.prisma.stockMovement.deleteMany({ where: { productId: id } }),
      this.prisma.purchaseItem.deleteMany({ where: { productId: id } }),
      this.prisma.productStock.deleteMany({ where: { productId: id } }),
      this.prisma.stockTransfer.deleteMany({ where: { productId: id } }),
      this.prisma.orderRequestItem.deleteMany({ where: { productId: id } }),
      this.prisma.orderItemCheck.updateMany({ where: { productId: id }, data: { productId: null } }),
      this.prisma.product.delete({ where: { id: product.id } }),
    ]);
    return { deleted: true };
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
      where: { id: imageId, productId },
      data: { isPrimary: true },
    });
  }
}

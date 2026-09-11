import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, ProductType, Role } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto, UpdateProductDto, AdjustStockDto, MergeProductsDto } from './dto/product.dto';
import { InventoryCostingService } from '../purchases/inventory-costing.service';
import { SyncService } from '../ecommerce/sync/sync.service';

// Campos "de identidad" del producto que se pueden elegir campo por campo al unificar
// duplicados (ver mergeProducts). Imágenes y proveedor dropship se resuelven aparte porque
// no son un valor simple (una lista de imágenes / una relación 1 a 1), no un campo escalar.
const MERGE_FIELD_KEYS = [
  'sku', 'name', 'type', 'description', 'mlDescription', 'mlAttributes',
  'price', 'mlPrice', 'cost', 'supplierPrice', 'stock', 'criticalStock',
  'category', 'mlCategoryId', 'warehouseId', 'dropship',
] as const;

export interface BulkImportError {
  row: number;
  sku: string;
  reason: string;
}

export interface BulkImportResult {
  updated: number;
  skipped: number;
  errors: BulkImportError[];
}

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
    private sync: SyncService,
  ) {}

  private getCompanyId(user: any): string {
    if (!user.companyId) throw new ForbiddenException('Sin empresa asignada');
    return user.companyId;
  }

  private resolveCompanyId(user: any, companyIdParam?: string): string {
    if (user.role === Role.SUPER_ADMIN) {
      if (!companyIdParam) throw new BadRequestException('companyId requerido para Super Admin');
      return companyIdParam;
    }
    return this.getCompanyId(user);
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

  async findAllPaginated(user: any, query: { page?: string; search?: string; warehouseId?: string; category?: string; type?: string; active?: string; listingStatus?: string; companyId?: string; inStock?: string; stockFilter?: string; pageSize?: string; sortBy?: string; sortDir?: string }) {
    const companyId = user.role === Role.SUPER_ADMIN ? query.companyId : this.getCompanyId(user);

    const where: any = {};
    if (companyId) where.companyId = companyId;
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.category) where.category = query.category;
    if (query.type) where.type = query.type;
    if (query.inStock === 'true') where.stock = { gt: 0 };

    // "Estado" (activo/inactivo): combinable con "Publicación" porque son dos filtros
    // independientes. Un servicio no maneja stock propio (siempre 0 por diseño), así que
    // queda exento de la condición de stock — para él, "Activo" depende solo del flag manual.
    const andConditions: any[] = [];
    if (query.active === 'true') {
      andConditions.push({ active: true });
      andConditions.push({ OR: [{ type: 'SERVICIO' }, { stock: { gt: 0 } }] });
    } else if (query.active === 'false') {
      andConditions.push({ OR: [{ active: false }, { type: 'ARTICULO', stock: { lte: 0 } }] });
    }
    // "Publicación": estado real guardado del Listing (igual criterio que el color de los
    // chips en el catálogo), independiente del stock o del flag "Activo" del producto.
    if (query.listingStatus === 'ACTIVE') {
      andConditions.push({ listings: { some: { status: 'ACTIVE' } } });
    } else if (query.listingStatus === 'PAUSED') {
      andConditions.push({ listings: { some: { status: 'PAUSED' } } });
    } else if (query.listingStatus === 'ERROR_CLOSED') {
      andConditions.push({ listings: { some: { status: { in: ['DRAFT', 'ERROR', 'CLOSED'] } } } });
    } else if (query.listingStatus === 'NONE') {
      andConditions.push({ listings: { none: {} } });
    }
    if (andConditions.length) where.AND = andConditions;

    if (query.stockFilter === 'critical') {
      // Prisma no compara dos columnas de la misma fila directamente: se resuelven los
      // ids con stock <= criticalStock por SQL crudo y se filtra el resto de la búsqueda por esos ids.
      const critical = await this.prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM "Product" WHERE active = true AND stock <= "criticalStock"${
          companyId ? Prisma.sql` AND "companyId" = ${companyId}` : Prisma.empty
        }`,
      );
      where.id = { in: critical.map((r) => r.id) };
    }
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

    const updated = await this.prisma.product.update({
      where: { id },
      data,
      include: { images: true },
    });

    // Si se editó el precio del proveedor y el producto está vinculado a un proveedor
    // dropship, se mantiene sincronizado el costo que usa el módulo de dropshipping.
    if (data.supplierPrice != null) {
      await this.prisma.dropshipProduct.updateMany({
        where: { productId: id },
        data: { supplierCost: data.supplierPrice },
      });
    }

    return updated;
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

  // Detecta si dos o más de los productos indicados ya tienen cada uno una publicación en la
  // MISMA conexión de marketplace — un producto no puede tener 2 publicaciones en una misma
  // conexión (Listing es único por productId+connectionId), así que ese caso bloquea la fusión.
  private async findMergeConnectionConflicts(productIds: string[]) {
    const listings = await this.prisma.listing.findMany({
      where: { productId: { in: productIds } },
      include: {
        connection: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
      },
    });
    const byConnection = new Map<string, typeof listings>();
    for (const l of listings) {
      if (!byConnection.has(l.connectionId)) byConnection.set(l.connectionId, []);
      byConnection.get(l.connectionId)!.push(l);
    }
    const conflicts: { connectionId: string; connectionName: string; products: { id: string; name: string }[] }[] = [];
    for (const group of byConnection.values()) {
      const distinctProducts = new Map(group.map((l) => [l.product.id, l.product]));
      if (distinctProducts.size > 1) {
        conflicts.push({
          connectionId: group[0].connectionId,
          connectionName: group[0].connection.name,
          products: Array.from(distinctProducts.values()),
        });
      }
    }
    return conflicts;
  }

  // Trae el detalle completo de los productos candidatos a unificar (para que el frontend
  // arme el selector campo por campo) más cuántos registros de cada tipo tiene cada uno, y
  // si hay conflictos de publicaciones duplicadas en una misma conexión que bloquean la fusión.
  async getMergeCandidates(ids: string[], user: any) {
    const uniqueIds = Array.from(new Set(ids));
    if (uniqueIds.length < 2) throw new BadRequestException('Selecciona al menos 2 productos para unificar');

    const products = await this.prisma.product.findMany({
      where: { id: { in: uniqueIds } },
      include: {
        images: { orderBy: { order: 'asc' } },
        warehouse: { select: { id: true, name: true } },
        dropshipProduct: { include: { dropshipSupplier: { include: { supplier: { select: { id: true, name: true } } } } } },
        _count: {
          select: {
            saleItems: true, stockMovements: true, purchaseItems: true, listings: true,
            orderItemChecks: true, stockTransfers: true, orderRequestItems: true,
            returnItems: true, dropshipOrderItems: true,
          },
        },
      },
    });
    if (products.length !== uniqueIds.length) throw new NotFoundException('Uno o más productos no existen');

    const companyId = products[0].companyId;
    if (products.some((p) => p.companyId !== companyId)) {
      throw new BadRequestException('Todos los productos deben pertenecer a la misma empresa');
    }
    if (user.role !== Role.SUPER_ADMIN && companyId !== user.companyId) throw new ForbiddenException();

    const connectionConflicts = await this.findMergeConnectionConflicts(uniqueIds);
    return { products, connectionConflicts };
  }

  // Unifica 2+ productos duplicados (p.ej. importados desde distintas cuentas/conexiones de
  // marketplace) en uno solo: el producto "sobreviviente" conserva su fila y adopta, campo por
  // campo, los valores elegidos entre todos los productos del grupo; las publicaciones y todo
  // el historial (ventas, movimientos de stock, compras, etc.) de los demás se reasignan a ese
  // mismo SKU y esos otros productos se eliminan. Operación irreversible — se ejecuta completa
  // en una sola transacción (todo o nada).
  async mergeProducts(dto: MergeProductsDto, user: any) {
    const ids = Array.from(new Set(dto.productIds));
    if (ids.length < 2) throw new BadRequestException('Selecciona al menos 2 productos para unificar');
    if (!ids.includes(dto.survivorId)) {
      throw new BadRequestException('El producto sobreviviente debe estar entre los seleccionados');
    }

    const products = await this.prisma.product.findMany({ where: { id: { in: ids } } });
    if (products.length !== ids.length) throw new NotFoundException('Uno o más productos no existen');

    const companyId = products[0].companyId;
    if (products.some((p) => p.companyId !== companyId)) {
      throw new BadRequestException('Todos los productos deben pertenecer a la misma empresa');
    }
    if (user.role !== Role.SUPER_ADMIN && companyId !== user.companyId) throw new ForbiddenException();

    const byId = new Map(products.map((p) => [p.id, p]));
    const fs: any = dto.fieldSources;
    for (const key of MERGE_FIELD_KEYS) {
      if (!fs[key] || !byId.has(fs[key])) {
        throw new BadRequestException(`Falta elegir el producto de origen para el campo "${key}"`);
      }
    }
    if (dto.imagesFromProductId && !byId.has(dto.imagesFromProductId)) {
      throw new BadRequestException('Producto de origen de imágenes inválido');
    }
    if (dto.dropshipFromProductId && !byId.has(dto.dropshipFromProductId)) {
      throw new BadRequestException('Producto de origen del proveedor dropship inválido');
    }

    const conflicts = await this.findMergeConnectionConflicts(ids);
    if (conflicts.length) {
      const detail = conflicts
        .map((c) => `${c.connectionName} (${c.products.map((p) => p.name).join(' y ')})`)
        .join('; ');
      throw new BadRequestException(
        `No se puede unificar: hay publicaciones de más de un producto en la misma conexión — ${detail}. Desvincula una de esas publicaciones antes de unificar.`,
      );
    }

    const survivorId = dto.survivorId;
    const loserIds = ids.filter((id) => id !== survivorId);
    const stockSourceId = fs.stock;
    const imagesFrom = dto.imagesFromProductId || null;
    const dropshipFrom = dto.dropshipFromProductId || null;

    const pick = (key: string) => (byId.get(fs[key]) as any)[key];
    const data: any = {
      sku: pick('sku'),
      name: pick('name'),
      type: pick('type'),
      description: pick('description'),
      mlDescription: pick('mlDescription'),
      mlAttributes: pick('mlAttributes'),
      price: pick('price'),
      mlPrice: pick('mlPrice'),
      cost: pick('cost'),
      supplierPrice: pick('supplierPrice'),
      stock: pick('stock'),
      criticalStock: pick('criticalStock'),
      category: pick('category'),
      mlCategoryId: pick('mlCategoryId'),
      warehouseId: pick('warehouseId'),
      dropship: pick('dropship'),
    };
    // Un servicio no tiene stock propio ni bodega (misma regla que aplica al editar a mano).
    if (data.type === ProductType.SERVICIO) {
      data.stock = 0;
      data.warehouseId = null;
    }

    await this.prisma.$transaction(async (tx) => {
      if (loserIds.length) {
        const where = { productId: { in: loserIds } };
        const move = { productId: survivorId };
        await tx.listing.updateMany({ where, data: move });
        await tx.saleItem.updateMany({ where, data: move });
        await tx.stockMovement.updateMany({ where, data: move });
        await tx.orderItemCheck.updateMany({ where, data: move });
        await tx.purchaseItem.updateMany({ where, data: move });
        await tx.stockTransfer.updateMany({ where, data: move });
        await tx.orderRequestItem.updateMany({ where, data: move });
        await tx.returnItem.updateMany({ where, data: move });
        await tx.dropshipOrderItem.updateMany({ where, data: move });
      }

      // Stock por bodega: solo se conserva el del producto elegido para el campo "stock";
      // el del resto se descarta (se asume que es el mismo inventario contado dos veces).
      if (stockSourceId !== survivorId) {
        await tx.productStock.deleteMany({ where: { productId: survivorId } });
        await tx.productStock.updateMany({ where: { productId: stockSourceId }, data: { productId: survivorId } });
      }
      const otherLoserIds = loserIds.filter((id) => id !== stockSourceId);
      if (otherLoserIds.length) {
        await tx.productStock.deleteMany({ where: { productId: { in: otherLoserIds } } });
      }

      // Proveedor dropship: relación 1 a 1, solo sobrevive el elegido (o ninguno).
      await tx.dropshipProduct.deleteMany({
        where: {
          productId: { in: ids },
          ...(dropshipFrom ? { NOT: { productId: dropshipFrom } } : {}),
        },
      });
      if (dropshipFrom && dropshipFrom !== survivorId) {
        await tx.dropshipProduct.updateMany({ where: { productId: dropshipFrom }, data: { productId: survivorId } });
      }

      // Imágenes: solo sobrevive el set elegido (o ninguna).
      if (imagesFrom && imagesFrom !== survivorId) {
        await tx.productImage.deleteMany({ where: { productId: survivorId } });
        await tx.productImage.updateMany({ where: { productId: imagesFrom }, data: { productId: survivorId } });
      } else if (!imagesFrom) {
        await tx.productImage.deleteMany({ where: { productId: { in: ids } } });
      }

      // Recién ahora se puede borrar a los perdedores: ya no les queda ningún registro
      // asociado que bloquee el borrado (todo se reasignó o se eliminó arriba). Se hace antes
      // de actualizar al sobreviviente para no chocar con la restricción única de SKU si el
      // valor elegido pertenecía a uno de los productos que se está eliminando.
      if (loserIds.length) {
        await tx.product.deleteMany({ where: { id: { in: loserIds } } });
      }

      await tx.product.update({ where: { id: survivorId }, data });
    });

    // Empuja el precio y stock finales a todas las publicaciones del sobreviviente (incluidas
    // las que se le acaban de reasignar) — sin esperar la respuesta ni romper la fusión si
    // alguna plataforma falla; el error queda registrado en esa publicación como de costumbre.
    this.sync.syncProduct(survivorId, data.stock, Number(data.price)).catch(() => {});

    return this.findOne(survivorId, user);
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

  // Plantilla con el catálogo activo actual (SKU, nombre, precio, stock) para que el usuario
  // edite Precio/Stock en Excel y la vuelva a subir — el nombre solo es referencia visual.
  async exportBulkTemplate(user: any, companyIdParam?: string): Promise<Buffer> {
    const companyId = this.resolveCompanyId(user, companyIdParam);
    const products = await this.prisma.product.findMany({
      where: { companyId, active: true },
      orderBy: { name: 'asc' },
      select: { sku: true, name: true, price: true, stock: true },
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Stock y precios');
    sheet.columns = [
      { header: 'SKU', key: 'sku', width: 22 },
      { header: 'Nombre', key: 'name', width: 45 },
      { header: 'Precio', key: 'price', width: 15 },
      { header: 'Stock', key: 'stock', width: 12 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const p of products) {
      sheet.addRow({ sku: p.sku, name: p.name, price: Number(p.price), stock: p.stock });
    }
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  // Sube la plantilla editada y actualiza precio y/o stock solo de productos que ya existen
  // en el catálogo (emparejados por SKU) — nunca crea productos nuevos. Reutiliza update()
  // para que el efecto sea idéntico a editar el producto a mano (mismas reglas y permisos).
  async bulkImportStockPrice(buffer: Buffer, user: any, companyIdParam?: string): Promise<BulkImportResult> {
    const companyId = this.resolveCompanyId(user, companyIdParam);
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as any);
    } catch {
      throw new BadRequestException('No se pudo leer el archivo. Asegúrate de subir un Excel (.xlsx) válido.');
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('El archivo no tiene ninguna hoja con datos');

    let updated = 0;
    let skipped = 0;
    const errors: BulkImportError[] = [];

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const rawSku = row.getCell(1).value;
      const sku = rawSku != null ? String(rawSku).trim() : '';
      if (!sku) continue;

      const dto: { price?: number; stock?: number } = {};
      const rawPrice = row.getCell(3).value;
      if (rawPrice !== null && rawPrice !== undefined && rawPrice !== '') {
        const n = Number(rawPrice);
        if (!Number.isNaN(n)) dto.price = n;
      }
      const rawStock = row.getCell(4).value;
      if (rawStock !== null && rawStock !== undefined && rawStock !== '') {
        const n = Number(rawStock);
        if (!Number.isNaN(n)) dto.stock = Math.trunc(n);
      }
      if (dto.price === undefined && dto.stock === undefined) {
        skipped++;
        continue;
      }

      const product = await this.prisma.product.findUnique({ where: { sku_companyId: { sku, companyId } } });
      if (!product) {
        errors.push({ row: rowNumber, sku, reason: 'SKU no encontrado en tu catálogo' });
        continue;
      }
      try {
        await this.update(product.id, dto, user);
        updated++;
      } catch (err: any) {
        errors.push({ row: rowNumber, sku, reason: err.message || 'Error al actualizar' });
      }
    }

    return { updated, skipped, errors };
  }
}

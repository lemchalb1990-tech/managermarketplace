import { Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateProductMasterDto, UpdateProductMasterDto, VariantAttributeDto,
  CreateCategoryDto, UpdateCategoryDto, SetCategoryChannelMappingDto,
  UpsertProductContentDto, UpsertChannelContentDto, AddProductMasterImageDto,
  SetChannelPriceDto,
} from './dto/product-master.dto';

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
      include: { _count: { select: { products: true } }, category: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, user: any) {
    const master = await this.prisma.productMaster.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true, parentId: true } },
        content: true,
        channelContent: true,
        images: { orderBy: [{ isPrimary: 'desc' }, { order: 'asc' }] },
        products: {
          select: {
            id: true, sku: true, name: true, stock: true, price: true, active: true,
            listings: { select: { id: true, status: true, variationId: true, connection: { select: { name: true, marketplace: true } } } },
            variantAttributes: { select: { id: true, name: true, value: true } },
            channelPrices: { select: { id: true, price: true, connection: { select: { id: true, name: true, marketplace: true } } } },
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

  // Fase 2: qué distingue a este producto de sus hermanos bajo el mismo maestro (ej.
  // Color=Negro). Reemplaza el set completo — más simple para un formulario que hace
  // "guardar" con todos los atributos de la variante a la vez.
  async setVariantAttributes(productId: string, attributes: VariantAttributeDto[], user: any) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Producto no encontrado');
    if (user.role !== Role.SUPER_ADMIN && product.companyId !== user.companyId) throw new ForbiddenException();

    const names = attributes.map((a) => a.name.trim()).filter(Boolean);
    if (new Set(names).size !== names.length) {
      throw new BadRequestException('Hay atributos repetidos (el mismo nombre no puede aparecer dos veces)');
    }

    await this.prisma.$transaction([
      this.prisma.variantAttribute.deleteMany({ where: { productId } }),
      ...attributes
        .filter((a) => a.name.trim())
        .map((a) => this.prisma.variantAttribute.create({
          data: { productId, name: a.name.trim(), value: a.value.trim() },
        })),
    ]);

    return this.prisma.variantAttribute.findMany({ where: { productId } });
  }

  // ─── Fase 5: categorías internas ─────────────────────────────────────────────

  async listCategories(user: any, companyId?: string) {
    return this.prisma.category.findMany({
      where: this.baseWhere(user, companyId),
      include: { channelMappings: true, _count: { select: { productMasters: true, children: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async createCategory(dto: CreateCategoryDto, user: any) {
    const companyId = this.resolveCompanyId(user, dto.companyId);
    if (dto.parentId) {
      const parent = await this.prisma.category.findUnique({ where: { id: dto.parentId } });
      if (!parent || parent.companyId !== companyId) throw new BadRequestException('Categoría padre inválida');
    }
    return this.prisma.category.create({
      data: { name: dto.name, parentId: dto.parentId || null, companyId },
    });
  }

  async updateCategory(id: string, dto: UpdateCategoryDto, user: any) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Categoría no encontrada');
    if (user.role !== Role.SUPER_ADMIN && category.companyId !== user.companyId) throw new ForbiddenException();
    if (dto.parentId === id) throw new BadRequestException('Una categoría no puede ser su propia categoría padre');
    if (dto.parentId) {
      const parent = await this.prisma.category.findUnique({ where: { id: dto.parentId } });
      if (!parent || parent.companyId !== category.companyId) throw new BadRequestException('Categoría padre inválida');
    }
    return this.prisma.category.update({ where: { id }, data: dto });
  }

  async removeCategory(id: string, user: any) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { productMasters: true, children: true } } },
    });
    if (!category) throw new NotFoundException('Categoría no encontrada');
    if (user.role !== Role.SUPER_ADMIN && category.companyId !== user.companyId) throw new ForbiddenException();
    if (category._count.productMasters > 0 || category._count.children > 0) {
      throw new ConflictException('Esta categoría tiene productos maestros o subcategorías. Muévelos antes de eliminarla.');
    }
    return this.prisma.category.delete({ where: { id } });
  }

  // A qué categoría de un canal (ML, Jumpseller, etc.) corresponde esta categoría interna.
  async setCategoryChannelMapping(categoryId: string, dto: SetCategoryChannelMappingDto, user: any) {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) throw new NotFoundException('Categoría no encontrada');
    if (user.role !== Role.SUPER_ADMIN && category.companyId !== user.companyId) throw new ForbiddenException();

    return this.prisma.categoryChannelMapping.upsert({
      where: { categoryId_platform: { categoryId, platform: dto.platform } },
      update: { externalCategoryId: dto.externalCategoryId, externalCategoryName: dto.externalCategoryName },
      create: { categoryId, platform: dto.platform, externalCategoryId: dto.externalCategoryId, externalCategoryName: dto.externalCategoryName },
    });
  }

  async removeCategoryChannelMapping(categoryId: string, platform: string, user: any) {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) throw new NotFoundException('Categoría no encontrada');
    if (user.role !== Role.SUPER_ADMIN && category.companyId !== user.companyId) throw new ForbiddenException();
    return this.prisma.categoryChannelMapping.deleteMany({ where: { categoryId, platform } });
  }

  // ─── Fase 6: contenido/SEO ────────────────────────────────────────────────────

  private async getOwnedMaster(masterId: string, user: any) {
    const master = await this.prisma.productMaster.findUnique({ where: { id: masterId } });
    if (!master) throw new NotFoundException('Producto maestro no encontrado');
    if (user.role !== Role.SUPER_ADMIN && master.companyId !== user.companyId) throw new ForbiddenException();
    return master;
  }

  async upsertProductContent(masterId: string, dto: UpsertProductContentDto, user: any) {
    await this.getOwnedMaster(masterId, user);
    return this.prisma.productContent.upsert({
      where: { productMasterId: masterId },
      update: dto,
      create: { ...dto, productMasterId: masterId },
    });
  }

  async upsertChannelContent(masterId: string, dto: UpsertChannelContentDto, user: any) {
    await this.getOwnedMaster(masterId, user);
    const { platform, ...data } = dto;
    return this.prisma.channelContent.upsert({
      where: { productMasterId_platform: { productMasterId: masterId, platform } },
      update: data,
      create: { ...data, platform, productMasterId: masterId },
    });
  }

  async addProductMasterImage(masterId: string, dto: AddProductMasterImageDto, user: any) {
    await this.getOwnedMaster(masterId, user);
    if (dto.isPrimary) {
      await this.prisma.productMasterImage.updateMany({ where: { productMasterId: masterId }, data: { isPrimary: false } });
    }
    const count = await this.prisma.productMasterImage.count({ where: { productMasterId: masterId } });
    return this.prisma.productMasterImage.create({
      data: { ...dto, isPrimary: !!dto.isPrimary, order: count, productMasterId: masterId },
    });
  }

  async removeProductMasterImage(imageId: string, user: any) {
    const image = await this.prisma.productMasterImage.findUnique({
      where: { id: imageId },
      include: { productMaster: { select: { companyId: true } } },
    });
    if (!image) throw new NotFoundException('Imagen no encontrada');
    if (user.role !== Role.SUPER_ADMIN && image.productMaster.companyId !== user.companyId) throw new ForbiddenException();
    return this.prisma.productMasterImage.delete({ where: { id: imageId } });
  }

  // ─── Fase 7: precio por canal ─────────────────────────────────────────────────

  // Ausente = se sigue usando Product.mlPrice/price para publicar (ver publishProduct) —
  // esto es un override opcional para cuando la misma variante necesita un precio
  // distinto en, por ejemplo, dos cuentas de Mercado Libre.
  async setChannelPrice(productId: string, dto: SetChannelPriceDto, user: any) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Producto no encontrado');
    if (user.role !== Role.SUPER_ADMIN && product.companyId !== user.companyId) throw new ForbiddenException();

    const connection = await this.prisma.marketplaceConnection.findUnique({ where: { id: dto.connectionId } });
    if (!connection || connection.companyId !== product.companyId) {
      throw new BadRequestException('La conexión no pertenece a la misma empresa que el producto');
    }

    return this.prisma.channelPrice.upsert({
      where: { productId_connectionId: { productId, connectionId: dto.connectionId } },
      update: { price: dto.price },
      create: { productId, connectionId: dto.connectionId, price: dto.price },
    });
  }

  async removeChannelPrice(productId: string, connectionId: string, user: any) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Producto no encontrado');
    if (user.role !== Role.SUPER_ADMIN && product.companyId !== user.companyId) throw new ForbiddenException();
    return this.prisma.channelPrice.deleteMany({ where: { productId, connectionId } });
  }

  // ─── Fase 10: reporte de migración (solo lectura) ────────────────────────────

  // No mueve ni fusiona nada — solo clasifica lo que ya existe para que la revisión sea
  // manual, exactamente como recomienda la auditoría ("no fusión masiva ciega"). Cada
  // grupo es una SUGERENCIA a revisar, no una acción ya tomada.
  private normalizeForDuplicateCheck(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // sin tildes
      .replace(/\b(negro|blanco|rojo|azul|gris|verde|amarillo|rosado|beige|s|m|l|xl|xxl)\b/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  async getMigrationReport(user: any, companyId?: string) {
    const products = await this.prisma.product.findMany({
      where: this.baseWhere(user, companyId),
      select: {
        id: true, sku: true, name: true, productMasterId: true,
        listings: { select: { connectionId: true } },
      },
    });

    const consolidated = products.filter((p) => new Set(p.listings.map((l) => l.connectionId)).size > 1);

    const suspiciousSku = products.filter((p) => /^\d{10,}$/.test(p.sku));

    // Posibles variantes: SKUs que comparten el mismo prefijo antes del último "-"
    // (ej. SEN-RET-004-NEG / SEN-RET-004-BLA) y todavía no están bajo un mismo maestro.
    const byPrefix = new Map<string, typeof products>();
    for (const p of products) {
      const idx = p.sku.lastIndexOf('-');
      if (idx <= 0) continue;
      const prefix = p.sku.slice(0, idx);
      if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
      byPrefix.get(prefix)!.push(p);
    }
    const possibleVariantGroups = [...byPrefix.entries()]
      .filter(([, group]) => group.length > 1 && new Set(group.map((p) => p.productMasterId)).size !== 1)
      .map(([prefix, group]) => ({ prefix, products: group }));

    // Posibles duplicados: nombres casi idénticos (ignorando color/talla) en productos
    // con SKU distinto que todavía no comparten un mismo maestro.
    const byName = new Map<string, typeof products>();
    for (const p of products) {
      const key = this.normalizeForDuplicateCheck(p.name);
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key)!.push(p);
    }
    const possibleDuplicateGroups = [...byName.entries()]
      .filter(([, group]) => group.length > 1 && new Set(group.map((p) => p.productMasterId)).size !== 1)
      .map(([normalizedName, group]) => ({ normalizedName, products: group }));

    const flaggedIds = new Set([
      ...consolidated.map((p) => p.id),
      ...suspiciousSku.map((p) => p.id),
      ...possibleVariantGroups.flatMap((g) => g.products.map((p) => p.id)),
      ...possibleDuplicateGroups.flatMap((g) => g.products.map((p) => p.id)),
    ]);

    return {
      total: products.length,
      consolidated: consolidated.map((p) => ({ id: p.id, sku: p.sku, name: p.name, channels: p.listings.length })),
      suspiciousSku: suspiciousSku.map((p) => ({ id: p.id, sku: p.sku, name: p.name })),
      possibleVariantGroups,
      possibleDuplicateGroups,
      // Ni consolidado, ni sospechoso, ni parte de un grupo sugerido, ni ya vinculado a
      // un maestro: no hay nada que avise, pero tampoco está formalmente clasificado.
      unclassifiedCount: products.filter((p) => !flaggedIds.has(p.id) && !p.productMasterId).length,
    };
  }
}

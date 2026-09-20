import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { MarketplaceType, ListingStatus, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ShopifyAdapter } from '../platforms/shopify.adapter';
import { WooCommerceAdapter } from '../platforms/woocommerce.adapter';
import { JumpSellerAdapter } from '../platforms/jumpseller.adapter';
import { ParisAdapter } from '../platforms/paris.adapter';
import { RipleyAdapter } from '../platforms/ripley.adapter';
import { FalabellaAdapter } from '../platforms/falabella.adapter';
import { StubAdapter } from '../platforms/stub.adapter';
import { PlatformAdapter } from '../platforms/platform.interface';
import { CatalogService } from '../../catalog/catalog.service';
import { CreateConnectionDto, LinkProductDto, UpdateConnectionDto } from './connections.dto';
import { getEffectivePrice } from '../../common/effective-price.util';

const NON_ML_TYPES: MarketplaceType[] = [
  MarketplaceType.SHOPIFY, MarketplaceType.WOOCOMMERCE, MarketplaceType.JUMPSELLER,
  MarketplaceType.FALABELLA, MarketplaceType.PARIS, MarketplaceType.HITES,
  MarketplaceType.RIPLEY, MarketplaceType.WALMART,
];

@Injectable()
export class ConnectionsService {
  private readonly logger = new Logger(ConnectionsService.name);

  constructor(
    private prisma: PrismaService,
    private shopify: ShopifyAdapter,
    private woocommerce: WooCommerceAdapter,
    private jumpseller: JumpSellerAdapter,
    private paris: ParisAdapter,
    private ripley: RipleyAdapter,
    private falabella: FalabellaAdapter,
    private stub: StubAdapter,
    private catalog: CatalogService,
  ) {}

  private getAdapter(marketplace: MarketplaceType): PlatformAdapter {
    switch (marketplace) {
      case MarketplaceType.SHOPIFY: return this.shopify;
      case MarketplaceType.WOOCOMMERCE: return this.woocommerce;
      case MarketplaceType.JUMPSELLER: return this.jumpseller;
      case MarketplaceType.PARIS: return this.paris;
      case MarketplaceType.RIPLEY: return this.ripley;
      case MarketplaceType.FALABELLA: return this.falabella;
      default: return this.stub;
    }
  }

  private resolveCompanyId(user: any, companyId?: string): string {
    if (user.role === Role.SUPER_ADMIN) {
      if (!companyId) throw new BadRequestException('companyId requerido para Super Admin');
      return companyId;
    }
    return user.companyId;
  }

  async listConnections(user: any, marketplace?: string, companyId?: string) {
    const where: any = {
      active: true,
      marketplace: { in: NON_ML_TYPES },
    };
    if (user.role !== Role.SUPER_ADMIN) {
      where.companyId = user.companyId;
    } else if (companyId) {
      where.companyId = companyId;
    }
    if (marketplace && NON_ML_TYPES.includes(marketplace as MarketplaceType)) {
      where.marketplace = marketplace as MarketplaceType;
    }

    return this.prisma.marketplaceConnection.findMany({
      where,
      select: {
        id: true, name: true, marketplace: true, active: true, createdAt: true,
        credentials: false, // no exponer credenciales en listado
        expiresAt: true,
        sendInvoiceToPlatform: true,
        company: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createConnection(dto: CreateConnectionDto, user: any) {
    const companyId = this.resolveCompanyId(user, dto.companyId);
    const marketplace = dto.marketplace as MarketplaceType;
    if (!NON_ML_TYPES.includes(marketplace)) {
      throw new BadRequestException('Plataforma no válida');
    }

    const conn = await this.prisma.marketplaceConnection.create({
      data: {
        name: dto.name,
        marketplace,
        credentials: dto.credentials,
        accessToken: '',
        active: true,
        companyId,
      },
    });

    const adapter = this.getAdapter(marketplace);
    const testResult = await adapter.testConnection({ ...conn, credentials: dto.credentials }).catch((e) => ({
      success: false, message: e.message,
    }));

    if (!testResult.success) {
      await this.prisma.marketplaceConnection.delete({ where: { id: conn.id } });
      throw new BadRequestException(`No se pudo conectar: ${testResult.message}`);
    }

    return { ...conn, credentials: undefined, testMessage: testResult.message };
  }

  async deleteConnection(id: string, user: any) {
    const conn = await this.prisma.marketplaceConnection.findUnique({ where: { id } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) throw new ForbiddenException();
    return this.prisma.marketplaceConnection.update({ where: { id }, data: { active: false } });
  }

  // Solo Super Admin (ver controller): trae la conexión con sus credenciales, para
  // precargar el formulario de edición.
  async getConnection(id: string, user: any) {
    const conn = await this.prisma.marketplaceConnection.findUnique({ where: { id } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');
    if (!NON_ML_TYPES.includes(conn.marketplace)) throw new NotFoundException('Conexión no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) throw new ForbiddenException();
    return conn;
  }

  // Solo Super Admin (ver controller): permite corregir el nombre y/o las credenciales de
  // una conexión ya creada. Las credenciales se fusionan (solo se sobreescriben las claves
  // enviadas) y se prueban contra la plataforma ANTES de guardar — si fallan, no se toca
  // la conexión existente y esta sigue funcionando con las credenciales anteriores.
  async updateConnection(id: string, dto: UpdateConnectionDto, user: any) {
    const conn = await this.prisma.marketplaceConnection.findUnique({ where: { id } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');
    if (!NON_ML_TYPES.includes(conn.marketplace)) throw new NotFoundException('Conexión no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) throw new ForbiddenException();

    const mergedCredentials = dto.credentials
      ? { ...((conn.credentials as any) || {}), ...dto.credentials }
      : (conn.credentials as any);

    if (dto.credentials) {
      const adapter = this.getAdapter(conn.marketplace);
      const testResult = await adapter.testConnection({ ...conn, credentials: mergedCredentials }).catch((e) => ({
        success: false, message: e.message,
      }));
      if (!testResult.success) {
        throw new BadRequestException(`No se pudo conectar con las nuevas credenciales: ${testResult.message}`);
      }
    }

    const updated = await this.prisma.marketplaceConnection.update({
      where: { id },
      data: {
        ...(dto.name?.trim() ? { name: dto.name.trim() } : {}),
        ...(dto.credentials ? { credentials: mergedCredentials } : {}),
      },
    });
    return { ...updated, credentials: undefined };
  }

  async testConnection(id: string, user: any) {
    const conn = await this.prisma.marketplaceConnection.findUnique({ where: { id } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) throw new ForbiddenException();
    const adapter = this.getAdapter(conn.marketplace as MarketplaceType);
    return adapter.testConnection(conn);
  }

  async publishProduct(connectionId: string, productId: string, user: any) {
    const conn = await this.prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) throw new ForbiddenException();

    const product = await this.catalog.findOne(productId, user);
    const adapter = this.getAdapter(conn.marketplace as MarketplaceType);

    const result = await adapter.publishProduct(conn, product);

    return this.prisma.listing.upsert({
      where: { productId_connectionId: { productId, connectionId } },
      update: { externalId: result.externalId, externalUrl: result.externalUrl, status: ListingStatus.ACTIVE, syncedAt: new Date(), errorMsg: null },
      create: { productId, connectionId, externalId: result.externalId, externalUrl: result.externalUrl, status: ListingStatus.ACTIVE, syncedAt: new Date() },
    });
  }

  // Reenvía stock/precio actuales a una publicación YA existente en el canal — a
  // diferencia de publishProduct, no crea nada nuevo. Sirve para cualquier plataforma no-ML
  // que implemente syncListing (hoy Shopify/WooCommerce/JumpSeller/Paris).
  async syncListingNow(connectionId: string, productId: string, user: any) {
    const conn = await this.prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) throw new ForbiddenException();

    const listing = await this.prisma.listing.findUnique({ where: { productId_connectionId: { productId, connectionId } } });
    if (!listing?.externalId) throw new BadRequestException('El producto no está publicado en esta conexión todavía');

    const product = await this.catalog.findOne(productId, user);
    const adapter = this.getAdapter(conn.marketplace as MarketplaceType);
    const price = await getEffectivePrice(this.prisma, productId, connectionId, Number(product.price));

    try {
      await adapter.syncListing(conn, listing.externalId, { stock: product.stock, price });
      return this.prisma.listing.update({
        where: { id: listing.id },
        data: { syncedAt: new Date(), errorMsg: null, status: product.stock === 0 ? ListingStatus.PAUSED : ListingStatus.ACTIVE },
      });
    } catch (err: any) {
      await this.prisma.listing.update({ where: { id: listing.id }, data: { errorMsg: err.message } }).catch(() => {});
      throw new BadRequestException(err.message);
    }
  }

  async linkProduct(connectionId: string, productId: string, dto: LinkProductDto, user: any) {
    const conn = await this.prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) throw new ForbiddenException();
    await this.catalog.findOne(productId, user);

    return this.prisma.listing.upsert({
      where: { productId_connectionId: { productId, connectionId } },
      update: { externalId: dto.externalId, externalUrl: dto.externalUrl, status: ListingStatus.ACTIVE, syncedAt: new Date(), errorMsg: null },
      create: { productId, connectionId, externalId: dto.externalId, externalUrl: dto.externalUrl, status: ListingStatus.ACTIVE, syncedAt: new Date() },
    });
  }

  async getProductListings(productId: string, user: any) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Producto no encontrado');
    if (user.role !== Role.SUPER_ADMIN && product.companyId !== user.companyId) throw new ForbiddenException();

    return this.prisma.listing.findMany({
      where: { productId },
      include: {
        connection: {
          select: { id: true, name: true, marketplace: true, active: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── Campos/homologación y borrador de publicación por canal ─────────────────
  // upsertListingFields/addListingImage/removeListingImage/previewImport/confirmImport son
  // genéricos porque Paris y Ripley (ambos con adapter propio con estos mismos métodos) ya
  // los necesitan igual — la homologación específica (families/categorías/atributos de
  // Paris, hierarchies de Ripley) sigue siendo un método por plataforma, porque cada una
  // expone algo distinto y forzar una forma común solo complicaría el adapter más simple.

  private async getOwnedConnection(connectionId: string, user: any) {
    const conn = await this.prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) throw new ForbiddenException();
    return conn;
  }

  // Habilita/deshabilita el envío automático de boleta/factura a la plataforma para esta
  // conexión (ver BillingService.pushInvoiceToMarketplace). A diferencia de update() no
  // requiere Super Admin: es un ajuste operativo, no credenciales.
  async setSendInvoiceToPlatform(connectionId: string, enabled: boolean, user: any) {
    const conn = await this.getOwnedConnection(connectionId, user);
    return this.prisma.marketplaceConnection.update({
      where: { id: conn.id },
      data: { sendInvoiceToPlatform: enabled },
      select: { id: true, sendInvoiceToPlatform: true },
    });
  }

  private assertMarketplace(conn: any, marketplace: MarketplaceType, label: string) {
    if (conn.marketplace !== marketplace) {
      throw new BadRequestException(`Esta operación solo está disponible para conexiones de ${label}`);
    }
  }

  // Adapter con soporte de borrador/homologación por Listing (hoy Paris, Ripley y Falabella).
  private getListingAdapter(conn: any): ParisAdapter | RipleyAdapter | FalabellaAdapter {
    if (conn.marketplace === MarketplaceType.PARIS) return this.paris;
    if (conn.marketplace === MarketplaceType.RIPLEY) return this.ripley;
    if (conn.marketplace === MarketplaceType.FALABELLA) return this.falabella;
    throw new BadRequestException('Esta plataforma todavía no soporta homologación por producto');
  }

  async getParisFamilies(connectionId: string, user: any, q?: string) {
    const conn = await this.getOwnedConnection(connectionId, user);
    this.assertMarketplace(conn, MarketplaceType.PARIS, 'Paris');
    return this.paris.getFamilies(conn, q);
  }

  async getParisCategories(connectionId: string, user: any, familyId: string) {
    const conn = await this.getOwnedConnection(connectionId, user);
    this.assertMarketplace(conn, MarketplaceType.PARIS, 'Paris');
    return this.paris.getCategories(conn, familyId);
  }

  async getParisAttributes(connectionId: string, user: any, familyId: string) {
    const conn = await this.getOwnedConnection(connectionId, user);
    this.assertMarketplace(conn, MarketplaceType.PARIS, 'Paris');
    return this.paris.getAttributes(conn, familyId);
  }

  async getParisAttributeOptions(connectionId: string, user: any, attributeId: string, q?: string) {
    const conn = await this.getOwnedConnection(connectionId, user);
    this.assertMarketplace(conn, MarketplaceType.PARIS, 'Paris');
    return this.paris.getAttributeOptions(conn, attributeId, q);
  }

  async getParisStorePrices(connectionId: string, user: any) {
    const conn = await this.getOwnedConnection(connectionId, user);
    this.assertMarketplace(conn, MarketplaceType.PARIS, 'Paris');
    return this.paris.getStorePrices(conn);
  }

  async getRipleyHierarchies(connectionId: string, user: any) {
    const conn = await this.getOwnedConnection(connectionId, user);
    this.assertMarketplace(conn, MarketplaceType.RIPLEY, 'Ripley');
    return this.ripley.getHierarchies(conn);
  }

  async getFalabellaCategories(connectionId: string, user: any) {
    const conn = await this.getOwnedConnection(connectionId, user);
    this.assertMarketplace(conn, MarketplaceType.FALABELLA, 'Falabella');
    return this.falabella.getCategories(conn);
  }

  async upsertListingFields(connectionId: string, productId: string, dto: any, user: any) {
    const conn = await this.getOwnedConnection(connectionId, user);
    const adapter = this.getListingAdapter(conn);
    await this.catalog.findOne(productId, user);
    return adapter.upsertListingFields(productId, connectionId, dto);
  }

  async addListingImage(connectionId: string, productId: string, filename: string, url: string, user: any) {
    const conn = await this.getOwnedConnection(connectionId, user);
    const adapter = this.getListingAdapter(conn);
    await this.catalog.findOne(productId, user);
    return adapter.addListingImage(productId, connectionId, filename, url);
  }

  async removeListingImage(connectionId: string, productId: string, imageId: string, user: any) {
    const conn = await this.getOwnedConnection(connectionId, user);
    const adapter = this.getListingAdapter(conn);
    const listing = await this.prisma.listing.findUnique({ where: { productId_connectionId: { productId, connectionId } } });
    if (!listing) throw new NotFoundException('Publicación no encontrada');
    return adapter.removeListingImage(listing.id, imageId);
  }

  // ─── Importar catálogo existente desde el canal ──────────────────────────────

  async previewImport(connectionId: string, user: any, offset?: number) {
    const conn = await this.getOwnedConnection(connectionId, user);
    const adapter = this.getListingAdapter(conn);
    return adapter.previewImport(conn, conn.companyId, offset || 0);
  }

  async confirmImport(connectionId: string, user: any, externalIds: string[], unlinkIds?: string[]) {
    const conn = await this.getOwnedConnection(connectionId, user);
    const adapter = this.getListingAdapter(conn);
    return adapter.confirmImport(conn, conn.companyId, externalIds, unlinkIds);
  }

  // ─── Importar ventas (historial) ──────────────────────────────────────────────
  // Por ahora solo Paris implementa esto — se agrega un caso por plataforma a medida que
  // se construye (mismo criterio que ya usa SalesImportCronService para el auto-sync).
  private getSalesImportAdapter(conn: any): ParisAdapter | RipleyAdapter | FalabellaAdapter {
    if (conn.marketplace === MarketplaceType.PARIS) return this.paris;
    if (conn.marketplace === MarketplaceType.RIPLEY) return this.ripley;
    if (conn.marketplace === MarketplaceType.FALABELLA) return this.falabella;
    throw new BadRequestException('Esta plataforma todavía no soporta importar ventas');
  }

  async previewSalesImport(connectionId: string, user: any, from?: string, to?: string) {
    const conn = await this.getOwnedConnection(connectionId, user);
    const adapter = this.getSalesImportAdapter(conn);
    return adapter.previewSalesImport(conn, conn.companyId, from, to);
  }

  async confirmSalesImport(connectionId: string, user: any, externalIds: string[]) {
    const conn = await this.getOwnedConnection(connectionId, user);
    const adapter = this.getSalesImportAdapter(conn);
    return adapter.confirmSalesImport(conn, conn.companyId, externalIds);
  }
}

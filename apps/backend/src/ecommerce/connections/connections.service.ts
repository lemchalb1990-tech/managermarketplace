import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { buildLabelsPdf } from '../mercadolibre/label-detail';
import { assertIntegrationsEnabled } from '../../common/integrations.util';
import { MarketplaceType, ListingStatus, Role, SaleChannel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ShopifyAdapter } from '../platforms/shopify.adapter';
import { WooCommerceAdapter } from '../platforms/woocommerce.adapter';
import { JumpSellerAdapter } from '../platforms/jumpseller.adapter';
import { ParisAdapter } from '../platforms/paris.adapter';
import { RipleyAdapter } from '../platforms/ripley.adapter';
import { FalabellaAdapter } from '../platforms/falabella.adapter';
import { WalmartAdapter } from '../platforms/walmart.adapter';
import { StubAdapter } from '../platforms/stub.adapter';
import { PlatformAdapter } from '../platforms/platform.interface';
import { CatalogService } from '../../catalog/catalog.service';
import { ChannelOrdersService } from '../sync/channel-orders.service';
import { MercadolibreService } from '../mercadolibre/mercadolibre.service';
import { CreateConnectionDto, LinkProductDto, UpdateConnectionDto } from './connections.dto';
import { getEffectivePrice, getListingPrice } from '../../common/effective-price.util';

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
    private walmart: WalmartAdapter,
    private stub: StubAdapter,
    private catalog: CatalogService,
    private channelOrders: ChannelOrdersService,
    private mercadolibre: MercadolibreService,
  ) {}

  private getAdapter(marketplace: MarketplaceType): PlatformAdapter {
    assertIntegrationsEnabled();
    switch (marketplace) {
      case MarketplaceType.SHOPIFY: return this.shopify;
      case MarketplaceType.WOOCOMMERCE: return this.woocommerce;
      case MarketplaceType.JUMPSELLER: return this.jumpseller;
      case MarketplaceType.PARIS: return this.paris;
      case MarketplaceType.RIPLEY: return this.ripley;
      case MarketplaceType.FALABELLA: return this.falabella;
      case MarketplaceType.WALMART: return this.walmart;
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
        sendInvoiceToPlatform: true, syncEnabled: true,
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
        // La sincronización automática trae solo ventas desde que se conecta la tienda: las
        // anteriores se importan como historial (sin descontar stock) desde "Importar ventas".
        lastSalesImportAt: new Date(),
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
      where: { productId_connectionId_slot: { productId, connectionId, slot: 0 } },
      update: { externalId: result.externalId, externalUrl: result.externalUrl, status: ListingStatus.ACTIVE, syncedAt: new Date(), errorMsg: null },
      create: { productId, connectionId, externalId: result.externalId, externalUrl: result.externalUrl, status: ListingStatus.ACTIVE, syncedAt: new Date() },
    });
  }

  // Reenvía stock/precio actuales a una publicación YA existente en el canal — a
  // diferencia de publishProduct, no crea nada nuevo. Sirve para cualquier plataforma no-ML
  // que implemente syncListing (hoy Shopify/WooCommerce/JumpSeller/Paris).
  // listingId: una publicación puntual (adicional de la misma cuenta); si no, la principal.
  async syncListingNow(connectionId: string, productId: string, user: any, listingId?: string) {
    const conn = await this.prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) throw new ForbiddenException();

    const listing = await this.findTargetListing(productId, connectionId, listingId);
    if (!listing?.externalId) throw new BadRequestException('El producto no está publicado en esta conexión todavía');

    const product = await this.catalog.findOne(productId, user);
    const adapter = this.getAdapter(conn.marketplace as MarketplaceType);
    const price = await getListingPrice(this.prisma, listing, Number(product.price));

    try {
      await adapter.syncListing(conn, listing.externalId, { stock: product.stock, price });
      let status: ListingStatus = product.stock === 0 ? ListingStatus.PAUSED : ListingStatus.ACTIVE;
      if (adapter.setListingStatus) {
        // Stock 0 → pausa real en la tienda; con stock se reactiva salvo pausa manual.
        const manualPaused = !!(listing.channelAttributes as any)?.manualPaused;
        const wantActive = product.stock > 0 && !manualPaused;
        if (wantActive !== (listing.status === ListingStatus.ACTIVE)) await adapter.setListingStatus(conn, listing.externalId, wantActive);
        status = wantActive ? ListingStatus.ACTIVE : ListingStatus.PAUSED;
      }
      return this.prisma.listing.update({
        where: { id: listing.id },
        data: { syncedAt: new Date(), errorMsg: null, status },
      });
    } catch (err: any) {
      await this.prisma.listing.update({ where: { id: listing.id }, data: { errorMsg: err.message } }).catch(() => {});
      throw new BadRequestException(err.message);
    }
  }

  private async findTargetListing(productId: string, connectionId: string, listingId?: string) {
    if (!listingId) {
      return this.prisma.listing.findUnique({ where: { productId_connectionId_slot: { productId, connectionId, slot: 0 } } });
    }
    const l = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!l || l.productId !== productId || l.connectionId !== connectionId) throw new NotFoundException('Publicación no encontrada');
    return l;
  }

  // Pausar / activar una publicación en el canal (si el canal lo permite, p. ej. JumpSeller).
  async toggleListingNow(connectionId: string, productId: string, user: any, listingId?: string) {
    const conn = await this.prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) throw new ForbiddenException();
    const listing = await this.findTargetListing(productId, connectionId, listingId);
    if (!listing?.externalId) throw new BadRequestException('El producto no está publicado en esta conexión todavía');
    const adapter = this.getAdapter(conn.marketplace as MarketplaceType);
    if (!adapter.setListingStatus) throw new BadRequestException('Este canal no permite pausar o activar desde el sistema.');
    const activate = listing.status !== ListingStatus.ACTIVE;
    if (activate) {
      const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { stock: true } });
      if (!product?.stock) throw new BadRequestException('No se puede activar la publicación: el producto no tiene stock.');
    }
    try {
      await adapter.setListingStatus(conn, listing.externalId, activate);
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }
    // Pausa manual: la sincronización no la reactiva sola cuando vuelve el stock.
    const attrs = { ...((listing.channelAttributes as any) || {}), manualPaused: !activate };
    return this.prisma.listing.update({
      where: { id: listing.id },
      data: { status: activate ? ListingStatus.ACTIVE : ListingStatus.PAUSED, syncedAt: new Date(), errorMsg: null, channelAttributes: attrs },
    });
  }

  // Borra la publicación EN LA TIENDA y luego su vínculo (si el canal lo permite).
  async deleteRemoteListing(connectionId: string, productId: string, user: any, listingId?: string) {
    if (user.role !== Role.SUPER_ADMIN && user.role !== Role.COMPANY_ADMIN) throw new ForbiddenException();
    const conn = await this.prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) throw new ForbiddenException();
    const listing = await this.findTargetListing(productId, connectionId, listingId);
    if (!listing) throw new NotFoundException('Publicación no encontrada');
    const adapter = this.getAdapter(conn.marketplace as MarketplaceType);
    if (!adapter.deleteRemoteListing) throw new BadRequestException('Este canal no permite borrar la publicación desde el sistema: usa "Quitar vínculo".');
    if (listing.externalId) {
      try {
        await adapter.deleteRemoteListing(conn, listing.externalId);
      } catch (err: any) {
        throw new BadRequestException(err.message);
      }
    }
    await this.prisma.listing.delete({ where: { id: listing.id } });
    return { deleted: true };
  }

  // Precio propio de una publicación adicional (null = usa el de la cuenta / base).
  async setListingPrice(listingId: string, price: number | null, user: any) {
    const l = await this.prisma.listing.findUnique({ where: { id: listingId }, include: { product: { select: { companyId: true } } } });
    if (!l) throw new NotFoundException('Publicación no encontrada');
    if (user.role !== Role.SUPER_ADMIN && l.product.companyId !== user.companyId) throw new ForbiddenException();
    return this.prisma.listing.update({ where: { id: listingId }, data: { price: price != null && Number(price) > 0 ? price : null } });
  }

  async linkProduct(connectionId: string, productId: string, dto: LinkProductDto, user: any) {
    const conn = await this.prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) throw new ForbiddenException();
    await this.catalog.findOne(productId, user);

    return this.prisma.listing.upsert({
      where: { productId_connectionId_slot: { productId, connectionId, slot: 0 } },
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

  // Check "Sincronizar" de la tienda (Mis conexiones). Sirve también para Mercado Libre.
  async setSyncEnabled(connectionId: string, enabled: boolean, user: any) {
    const conn = await this.getOwnedConnection(connectionId, user);
    return this.prisma.marketplaceConnection.update({
      where: { id: conn.id },
      data: { syncEnabled: enabled },
      select: { id: true, syncEnabled: true },
    });
  }

  private assertMarketplace(conn: any, marketplace: MarketplaceType, label: string) {
    if (conn.marketplace !== marketplace) {
      throw new BadRequestException(`Esta operación solo está disponible para conexiones de ${label}`);
    }
  }

  // Adapter con soporte de borrador/homologación por Listing (hoy Paris, Ripley y Falabella).
  // Walmart todavía no tiene publish/homologación — solo import (ver getCatalogImportAdapter).
  private getListingAdapter(conn: any): ParisAdapter | RipleyAdapter | FalabellaAdapter | WalmartAdapter {
    if (conn.marketplace === MarketplaceType.PARIS) return this.paris;
    if (conn.marketplace === MarketplaceType.RIPLEY) return this.ripley;
    if (conn.marketplace === MarketplaceType.FALABELLA) return this.falabella;
    if (conn.marketplace === MarketplaceType.WALMART) return this.walmart;
    throw new BadRequestException('Esta plataforma todavía no soporta homologación por producto');
  }

  // Adapter con soporte de "traer catálogo ya publicado" (previewImport/confirmImport) —
  // superconjunto de getListingAdapter: Walmart importa catálogo/ventas pero no publica, y
  // JumpSeller publica con el flujo genérico (sin homologación por producto).
  private getCatalogImportAdapter(conn: any): ParisAdapter | RipleyAdapter | FalabellaAdapter | WalmartAdapter | JumpSellerAdapter {
    if (conn.marketplace === MarketplaceType.WALMART) return this.walmart;
    if (conn.marketplace === MarketplaceType.JUMPSELLER) return this.jumpseller;
    return this.getListingAdapter(conn);
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
    const listing = await this.prisma.listing.findUnique({ where: { productId_connectionId_slot: { productId, connectionId, slot: 0 } } });
    if (!listing) throw new NotFoundException('Publicación no encontrada');
    return adapter.removeListingImage(listing.id, imageId);
  }

  // ─── Importar catálogo existente desde el canal ──────────────────────────────

  async previewImport(connectionId: string, user: any, offset?: number) {
    const conn = await this.getOwnedConnection(connectionId, user);
    const adapter = this.getCatalogImportAdapter(conn);
    return adapter.previewImport(conn, conn.companyId, offset || 0);
  }

  async confirmImport(connectionId: string, user: any, externalIds: string[], unlinkIds?: string[]) {
    const conn = await this.getOwnedConnection(connectionId, user);
    const adapter = this.getCatalogImportAdapter(conn);
    return adapter.confirmImport(conn, conn.companyId, externalIds, unlinkIds);
  }

  // ─── Walmart: fotos (el listado de Walmart no trae imágenes) ───────────────────
  async walmartImageDiagnostic(connectionId: string, user: any, sku: string) {
    const conn = await this.getOwnedConnection(connectionId, user);
    this.assertMarketplace(conn, MarketplaceType.WALMART, 'Walmart');
    return this.walmart.findItemImages(conn, sku);
  }

  // Miniatura para la vista previa de importación (primera fuente con fotos).
  async walmartThumbnail(connectionId: string, user: any, sku: string) {
    const conn = await this.getOwnedConnection(connectionId, user);
    this.assertMarketplace(conn, MarketplaceType.WALMART, 'Walmart');
    const { images } = await this.walmart.findItemImages(conn, sku, undefined, 'first');
    return { url: images[0] || null, count: images.length };
  }

  // Publicar en Walmart (feed asíncrono): enviar y luego consultar su resultado.
  async walmartPublish(connectionId: string, productId: string, user: any) {
    const conn = await this.getOwnedConnection(connectionId, user);
    this.assertMarketplace(conn, MarketplaceType.WALMART, 'Walmart');
    await this.catalog.findOne(productId, user);
    return this.walmart.submitItemFeed(conn, productId);
  }

  async walmartPublishStatus(connectionId: string, productId: string, user: any) {
    const conn = await this.getOwnedConnection(connectionId, user);
    this.assertMarketplace(conn, MarketplaceType.WALMART, 'Walmart');
    await this.catalog.findOne(productId, user);
    return this.walmart.checkItemFeed(conn, productId);
  }

  async walmartFetchMissingImages(connectionId: string, user: any) {
    const conn = await this.getOwnedConnection(connectionId, user);
    this.assertMarketplace(conn, MarketplaceType.WALMART, 'Walmart');
    return this.walmart.fetchMissingImages(conn);
  }

  // ─── Importar ventas (historial) ──────────────────────────────────────────────
  private getSalesImportAdapter(conn: any): ParisAdapter | RipleyAdapter | FalabellaAdapter | WalmartAdapter | JumpSellerAdapter {
    if (conn.marketplace === MarketplaceType.PARIS) return this.paris;
    if (conn.marketplace === MarketplaceType.RIPLEY) return this.ripley;
    if (conn.marketplace === MarketplaceType.FALABELLA) return this.falabella;
    if (conn.marketplace === MarketplaceType.WALMART) return this.walmart;
    if (conn.marketplace === MarketplaceType.JUMPSELLER) return this.jumpseller;
    throw new BadRequestException('Esta plataforma todavía no soporta importar ventas');
  }

  async previewSalesImport(connectionId: string, user: any, from?: string, to?: string) {
    const conn = await this.getOwnedConnection(connectionId, user);
    const adapter = this.getSalesImportAdapter(conn);
    return adapter.previewSalesImport(conn, conn.companyId, from, to);
  }

  // Mercado Libre tiene su propio flujo (cliente, envío y etiqueta de Mercado Envíos).
  // Etiqueta de despacho de una orden de JumpSeller (igual que la de Mercado Libre): solo la
  // etiqueta, o la etiqueta + una página con los productos del pedido (withDetail).
  async printChannelLabel(orderId: string, user: any, withDetail = false): Promise<Buffer> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { sale: { include: { connection: true } } },
    });
    if (!order) throw new NotFoundException('Orden no encontrada');
    if (user.role !== Role.SUPER_ADMIN && order.companyId !== user.companyId) throw new ForbiddenException();
    const conn = order.sale?.connection;
    if (!conn || conn.marketplace !== MarketplaceType.JUMPSELLER || !order.sale?.externalId) {
      throw new BadRequestException('La etiqueta solo está disponible para órdenes de JumpSeller.');
    }
    let label: Buffer;
    try {
      label = await this.jumpseller.getShippingLabelPdf(conn, order.sale.externalId);
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }
    if (!withDetail) return label;
    return buildLabelsPdf([{ label, detail: await this.mercadolibre.loadLabelDetail(order.id) }]);
  }

  async createOrderForExistingSale(saleId: string, user: any, opts: { withoutStock?: boolean } = {}) {
    const sale = await this.prisma.sale.findUnique({ where: { id: saleId }, select: { channel: true } });
    if (sale?.channel === SaleChannel.MERCADO_LIBRE) return this.mercadolibre.createOrderForExistingSale(saleId, user, opts);
    return this.channelOrders.createOrderForExistingSale(saleId, user, opts);
  }

  async confirmSalesImport(connectionId: string, user: any, externalIds: string[], createOrders = false) {
    const conn = await this.getOwnedConnection(connectionId, user);
    this.getSalesImportAdapter(conn); // valida que la plataforma soporte importar ventas
    return this.channelOrders.confirmSalesImport(conn, externalIds, createOrders);
  }

  // Revisa ahora (sin esperar al cron) el estado en la plataforma de las órdenes abiertas.
  async syncOrderStatuses(connectionId: string, user: any) {
    const conn = await this.getOwnedConnection(connectionId, user);
    this.getSalesImportAdapter(conn);
    return this.channelOrders.syncOrderStatuses(conn);
  }
}

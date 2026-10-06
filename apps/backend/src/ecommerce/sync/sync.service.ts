import { Injectable, Logger } from '@nestjs/common';
import { assertIntegrationsEnabled, integrationsDisabled } from '../../common/integrations.util';
import { MarketplaceType, ListingStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ShopifyAdapter } from '../platforms/shopify.adapter';
import { WooCommerceAdapter } from '../platforms/woocommerce.adapter';
import { JumpSellerAdapter } from '../platforms/jumpseller.adapter';
import { ParisAdapter } from '../platforms/paris.adapter';
import { RipleyAdapter } from '../platforms/ripley.adapter';
import { FalabellaAdapter } from '../platforms/falabella.adapter';
import { WalmartAdapter } from '../platforms/walmart.adapter';
import { StubAdapter } from '../platforms/stub.adapter';
import { PlatformAdapter, SyncPayload } from '../platforms/platform.interface';
import { getEffectivePrice, getListingPrice } from '../../common/effective-price.util';

const ML_API = 'https://api.mercadolibre.com';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

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

  // Sincroniza stock (y opcionalmente precio) en TODAS las plataformas donde el producto está publicado.
  async syncProduct(productId: string, newStock: number, price?: number) {
    if (integrationsDisabled()) return;
    const listings = await this.prisma.listing.findMany({
      where: { productId, status: { in: [ListingStatus.ACTIVE, ListingStatus.PAUSED] } },
      include: { connection: true, product: { select: { price: true, mlPrice: true } } },
    });
    if (!listings.length) return;

    const payload: SyncPayload = { stock: newStock, price };

    await Promise.allSettled(
      listings.map((listing) => this.syncOneListing(listing, payload)),
    );
  }

  private async syncOneListing(listing: any, payload: SyncPayload) {
    const { connection } = listing;
    try {
      // `payload.price` solo indica que hay que enviar precio. El precio de cada publicación es:
      // su precio propio de la conexión (ChannelPrice) si existe; si no, en Mercado Libre el
      // precio base de ML (mlPrice, o el de venta si no hay) y en los demás canales el precio de
      // venta. Antes se usaba un solo precio para todos (p. ej. mlPrice terminaba en Paris, o el
      // precio de venta en ML tras unificar productos).
      const fallback = listing.product
        ? (connection.marketplace === MarketplaceType.MERCADO_LIBRE
          ? Number(listing.product.mlPrice ?? listing.product.price)
          : Number(listing.product.price))
        : payload.price;
      const effectivePrice = payload.price !== undefined && fallback !== undefined
        ? await getListingPrice(this.prisma, { productId: listing.productId, connectionId: connection.id, price: listing.price }, fallback)
        : undefined;
      const effectivePayload: SyncPayload = { ...payload, price: effectivePrice };

      if (connection.marketplace === MarketplaceType.MERCADO_LIBRE) {
        await this.syncMlListing(listing, effectivePayload.stock, effectivePayload.price);
      } else {
        if (!listing.externalId) {
          this.logger.warn(`Sin externalId para listing=${listing.id} marketplace=${connection.marketplace}`);
          return;
        }
        const adapter = this.getAdapter(connection.marketplace);
        await adapter.syncListing(connection, listing.externalId, effectivePayload);
        // Canales que permiten pausar (JumpSeller, Shopify, WooCommerce): con stock 0 la
        // publicación se pausa de verdad en la tienda; al volver el stock se reactiva, salvo que
        // se haya pausado a mano (channelAttributes.manualPaused). Los demás canales solo
        // reciben el stock en 0.
        if (adapter.setListingStatus) {
          const manualPaused = !!(listing.channelAttributes as any)?.manualPaused;
          const wantActive = payload.stock > 0 && !manualPaused;
          const isActive = listing.status === ListingStatus.ACTIVE;
          if (wantActive !== isActive && !(payload.stock > 0 && manualPaused)) {
            await adapter.setListingStatus(connection, listing.externalId, wantActive);
          }
          await this.prisma.listing.update({
            where: { id: listing.id },
            data: { status: wantActive ? ListingStatus.ACTIVE : ListingStatus.PAUSED, syncedAt: new Date(), errorMsg: null },
          });
          return;
        }
      }

      const newStatus = payload.stock === 0 ? ListingStatus.PAUSED : ListingStatus.ACTIVE;
      await this.prisma.listing.update({
        where: { id: listing.id },
        data: { status: newStatus, syncedAt: new Date() },
      });
    } catch (err: any) {
      this.logger.error(`Sync error listing=${listing.id} marketplace=${connection.marketplace}: ${err.message}`);
      await this.prisma.listing.update({
        where: { id: listing.id },
        data: { errorMsg: err.message },
      }).catch(() => {});
    }
  }

  private async syncMlListing(listing: any, newStock: number, price?: number) {
    if (!listing.externalId) return;
    const token = await this.getValidMlToken(listing.connection);
    const newMlStatus = newStock === 0 ? 'paused' : 'active';
    const body: Record<string, unknown> = { available_quantity: newStock, status: newMlStatus };
    if (price != null) body.price = Math.round(price);
    const res = await fetch(`${ML_API}/items/${listing.externalId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json() as any;
      throw new Error(err.message || `ML HTTP ${res.status}`);
    }
    this.logger.log(`ML sync: item=${listing.externalId} stock=${newStock}${price != null ? ` price=${Math.round(price)}` : ''} status=${newMlStatus}`);
  }

  private async getValidMlToken(connection: any): Promise<string> {
    assertIntegrationsEnabled();
    let conn = await this.prisma.marketplaceConnection.findUnique({ where: { id: connection.id } });
    if (!conn) throw new Error('Conexión no encontrada');

    if (conn.expiresAt && conn.expiresAt < new Date(Date.now() + 5 * 60 * 1000)) {
      if (!conn.refreshToken) return conn.accessToken;
      const clientId = conn.mlClientId;
      const clientSecret = conn.mlClientSecret;
      if (!clientId || !clientSecret) return conn.accessToken;

      const res = await fetch(`${ML_API}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: conn.refreshToken,
        }),
      });
      if (!res.ok) return conn.accessToken;
      const tokens = await res.json() as any;
      conn = await this.prisma.marketplaceConnection.update({
        where: { id: conn.id },
        data: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        },
      });
    }
    return conn.accessToken;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { MarketplaceType, ListingStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ShopifyAdapter } from '../platforms/shopify.adapter';
import { WooCommerceAdapter } from '../platforms/woocommerce.adapter';
import { JumpSellerAdapter } from '../platforms/jumpseller.adapter';
import { StubAdapter } from '../platforms/stub.adapter';
import { PlatformAdapter, SyncPayload } from '../platforms/platform.interface';

const ML_API = 'https://api.mercadolibre.com';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private prisma: PrismaService,
    private shopify: ShopifyAdapter,
    private woocommerce: WooCommerceAdapter,
    private jumpseller: JumpSellerAdapter,
    private stub: StubAdapter,
  ) {}

  private getAdapter(marketplace: MarketplaceType): PlatformAdapter {
    switch (marketplace) {
      case MarketplaceType.SHOPIFY: return this.shopify;
      case MarketplaceType.WOOCOMMERCE: return this.woocommerce;
      case MarketplaceType.JUMPSELLER: return this.jumpseller;
      default: return this.stub;
    }
  }

  // Sincroniza stock (y opcionalmente precio) en TODAS las plataformas donde el producto está publicado.
  async syncProduct(productId: string, newStock: number, price?: number) {
    const listings = await this.prisma.listing.findMany({
      where: { productId, status: { in: [ListingStatus.ACTIVE, ListingStatus.PAUSED] } },
      include: { connection: true },
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
      if (connection.marketplace === MarketplaceType.MERCADO_LIBRE) {
        await this.syncMlListing(listing, payload.stock);
      } else {
        if (!listing.externalId) {
          this.logger.warn(`Sin externalId para listing=${listing.id} marketplace=${connection.marketplace}`);
          return;
        }
        const adapter = this.getAdapter(connection.marketplace);
        await adapter.syncListing(connection, listing.externalId, payload);
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

  private async syncMlListing(listing: any, newStock: number) {
    if (!listing.externalId) return;
    const token = await this.getValidMlToken(listing.connection);
    const newMlStatus = newStock === 0 ? 'paused' : 'active';
    const res = await fetch(`${ML_API}/items/${listing.externalId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ available_quantity: newStock, status: newMlStatus }),
    });
    if (!res.ok) {
      const err = await res.json() as any;
      throw new Error(err.message || `ML HTTP ${res.status}`);
    }
    this.logger.log(`ML sync: item=${listing.externalId} stock=${newStock} status=${newMlStatus}`);
  }

  private async getValidMlToken(connection: any): Promise<string> {
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

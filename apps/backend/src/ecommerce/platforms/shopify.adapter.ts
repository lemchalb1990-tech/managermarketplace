import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAdapter, SyncPayload, PublishResult } from './platform.interface';

const API_VERSION = '2024-01';

@Injectable()
export class ShopifyAdapter implements PlatformAdapter {
  private readonly logger = new Logger(ShopifyAdapter.name);

  constructor(private prisma: PrismaService) {}

  private creds(conn: any): any {
    return (conn.credentials as any) || {};
  }

  private baseUrl(conn: any): string {
    const { shopDomain, apiVersion } = this.creds(conn);
    return `https://${shopDomain}/admin/api/${apiVersion || API_VERSION}`;
  }

  private headers(conn: any): Record<string, string> {
    return {
      'X-Shopify-Access-Token': this.creds(conn).accessToken || conn.accessToken,
      'Content-Type': 'application/json',
    };
  }

  async testConnection(conn: any): Promise<{ success: boolean; message?: string }> {
    try {
      const res = await fetch(`${this.baseUrl(conn)}/shop.json`, { headers: this.headers(conn) });
      if (!res.ok) return { success: false, message: `HTTP ${res.status}` };
      const data = await res.json() as any;
      return { success: true, message: `Tienda: ${data.shop?.name}` };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  async publishProduct(conn: any, product: any): Promise<PublishResult> {
    const base = this.baseUrl(conn);
    const hdrs = this.headers(conn);

    const body = {
      product: {
        title: product.name,
        body_html: product.description || '',
        status: 'active',
        variants: [{
          price: Number(product.price).toFixed(2),
          sku: product.sku,
          inventory_management: 'shopify',
          fulfillment_service: 'manual',
        }],
      },
    };

    const res = await fetch(`${base}/products.json`, {
      method: 'POST', headers: hdrs, body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json() as any;
      throw new Error(err.errors?.title?.[0] || JSON.stringify(err.errors) || `HTTP ${res.status}`);
    }

    const data = await res.json() as any;
    const variant = data.product?.variants?.[0];
    if (!variant) throw new Error('Shopify no devolvió variante');

    const locationId = await this.getOrFetchLocationId(conn, base, hdrs);

    if (locationId && variant.inventory_item_id) {
      await fetch(`${base}/inventory_levels/set.json`, {
        method: 'POST', headers: hdrs,
        body: JSON.stringify({
          location_id: locationId,
          inventory_item_id: variant.inventory_item_id,
          available: product.stock,
        }),
      });
    }

    return {
      externalId: `${variant.id}:${variant.inventory_item_id}`,
      externalUrl: `https://${this.creds(conn).shopDomain}/products/${data.product.handle}`,
    };
  }

  async syncListing(conn: any, externalId: string, payload: SyncPayload): Promise<void> {
    const base = this.baseUrl(conn);
    const hdrs = this.headers(conn);
    const [variantId, inventoryItemId] = externalId.split(':');

    if (payload.price !== undefined) {
      await fetch(`${base}/variants/${variantId}.json`, {
        method: 'PUT', headers: hdrs,
        body: JSON.stringify({ variant: { id: Number(variantId), price: payload.price.toFixed(2) } }),
      }).catch((e) => this.logger.warn(`Shopify price update failed: ${e.message}`));
    }

    const locationId = await this.getOrFetchLocationId(conn, base, hdrs);
    if (!locationId || !inventoryItemId) {
      this.logger.warn(`Shopify: sin location_id o inventory_item_id para conn=${conn.id}`);
      return;
    }

    const res = await fetch(`${base}/inventory_levels/set.json`, {
      method: 'POST', headers: hdrs,
      body: JSON.stringify({
        location_id: locationId,
        inventory_item_id: inventoryItemId,
        available: payload.stock,
      }),
    });
    if (!res.ok) {
      const err = await res.json() as any;
      throw new Error(`Shopify stock update failed: ${JSON.stringify(err)}`);
    }
    this.logger.log(`Shopify sync: variant=${variantId} stock=${payload.stock}`);
  }

  private async getOrFetchLocationId(conn: any, base: string, hdrs: Record<string, string>): Promise<number | null> {
    const creds = this.creds(conn);
    if (creds.locationId) return creds.locationId;

    const res = await fetch(`${base}/locations.json`, { headers: hdrs });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const locationId = data.locations?.[0]?.id;
    if (locationId) {
      await this.prisma.marketplaceConnection.update({
        where: { id: conn.id },
        data: { credentials: { ...creds, locationId } },
      });
    }
    return locationId || null;
  }
}

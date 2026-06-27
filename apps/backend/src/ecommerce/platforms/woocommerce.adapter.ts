import { Injectable, Logger } from '@nestjs/common';
import { PlatformAdapter, SyncPayload, PublishResult } from './platform.interface';

@Injectable()
export class WooCommerceAdapter implements PlatformAdapter {
  private readonly logger = new Logger(WooCommerceAdapter.name);

  private creds(conn: any): any {
    return (conn.credentials as any) || {};
  }

  private baseUrl(conn: any): string {
    const { siteUrl } = this.creds(conn);
    return `${siteUrl?.replace(/\/$/, '')}/wp-json/wc/v3`;
  }

  private authParams(conn: any): string {
    const { consumerKey, consumerSecret } = this.creds(conn);
    return `consumer_key=${encodeURIComponent(consumerKey)}&consumer_secret=${encodeURIComponent(consumerSecret)}`;
  }

  async testConnection(conn: any): Promise<{ success: boolean; message?: string }> {
    try {
      const res = await fetch(`${this.baseUrl(conn)}/system_status?${this.authParams(conn)}`);
      if (!res.ok) return { success: false, message: `HTTP ${res.status}` };
      const data = await res.json() as any;
      return { success: true, message: `Conectado a WooCommerce ${data.environment?.version || ''}` };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  async publishProduct(conn: any, product: any): Promise<PublishResult> {
    const res = await fetch(`${this.baseUrl(conn)}/products?${this.authParams(conn)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: product.name,
        sku: product.sku,
        regular_price: Number(product.price).toFixed(2),
        description: product.description || '',
        short_description: '',
        manage_stock: true,
        stock_quantity: product.stock,
        status: 'publish',
      }),
    });
    if (!res.ok) {
      const err = await res.json() as any;
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    const data = await res.json() as any;
    return {
      externalId: String(data.id),
      externalUrl: data.permalink,
    };
  }

  async syncListing(conn: any, externalId: string, payload: SyncPayload): Promise<void> {
    const body: any = { manage_stock: true, stock_quantity: payload.stock };
    if (payload.price !== undefined) body.regular_price = payload.price.toFixed(2);

    const res = await fetch(`${this.baseUrl(conn)}/products/${externalId}?${this.authParams(conn)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json() as any;
      throw new Error(`WooCommerce sync failed: ${err.message || res.status}`);
    }
    this.logger.log(`WooCommerce sync: product=${externalId} stock=${payload.stock}`);
  }
}

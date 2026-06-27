import { Injectable, Logger } from '@nestjs/common';
import { PlatformAdapter, SyncPayload, PublishResult } from './platform.interface';

const BASE = 'https://app.jumpseller.com/api/v1';

@Injectable()
export class JumpSellerAdapter implements PlatformAdapter {
  private readonly logger = new Logger(JumpSellerAdapter.name);

  private creds(conn: any): any {
    return (conn.credentials as any) || {};
  }

  private auth(conn: any): string {
    const { loginToken, storeHandle } = this.creds(conn);
    return `login_token=${loginToken}&store=${storeHandle}`;
  }

  async testConnection(conn: any): Promise<{ success: boolean; message?: string }> {
    try {
      const res = await fetch(`${BASE}/stores.json?${this.auth(conn)}`);
      if (!res.ok) return { success: false, message: `HTTP ${res.status}` };
      const data = await res.json() as any;
      return { success: true, message: `Tienda: ${data?.name || this.creds(conn).storeHandle}` };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  async publishProduct(conn: any, product: any): Promise<PublishResult> {
    const res = await fetch(`${BASE}/products.json?${this.auth(conn)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: {
          name: product.name,
          description: product.description || '',
          price: Number(product.price),
          stock: product.stock,
          sku: product.sku,
          status: 'available',
        },
      }),
    });
    if (!res.ok) {
      const err = await res.json() as any;
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    const data = await res.json() as any;
    return {
      externalId: String(data.product?.id || data.id),
      externalUrl: data.product?.permalink,
    };
  }

  async syncListing(conn: any, externalId: string, payload: SyncPayload): Promise<void> {
    const body: any = { product: { stock: payload.stock } };
    if (payload.price !== undefined) body.product.price = payload.price;

    const res = await fetch(`${BASE}/products/${externalId}.json?${this.auth(conn)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json() as any;
      throw new Error(`JumpSeller sync failed: ${err.message || res.status}`);
    }
    this.logger.log(`JumpSeller sync: product=${externalId} stock=${payload.stock}`);
  }
}

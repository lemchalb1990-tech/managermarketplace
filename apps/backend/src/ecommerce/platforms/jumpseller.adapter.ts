import { Injectable, Logger } from '@nestjs/common';
import { PlatformAdapter, SyncPayload, PublishResult } from './platform.interface';

// Doc oficial: https://github.com/jumpseller/api-docs (spec OpenAPI en
// https://api.jumpseller.com/swagger.json). Confirmado ahí, no en pruebas en vivo (las
// credenciales que nos dieron fallan con "Failed to Login" incluso con este esquema
// exacto — pendiente de resolver del lado de la cuenta del cliente): Basic Auth con
// "login:authtoken" (o los mismos como query params ?login=&authtoken=). La base URL y
// los nombres de parámetro de la versión anterior de este adapter (app.jumpseller.com,
// login_token/store) no existen en el spec oficial.
const BASE = 'https://api.jumpseller.com/v1';

@Injectable()
export class JumpSellerAdapter implements PlatformAdapter {
  private readonly logger = new Logger(JumpSellerAdapter.name);

  private creds(conn: any): any {
    return (conn.credentials as any) || {};
  }

  private authHeader(conn: any): Record<string, string> {
    const { login, authtoken } = this.creds(conn);
    const basic = Buffer.from(`${login}:${authtoken}`).toString('base64');
    return { Authorization: `Basic ${basic}` };
  }

  async testConnection(conn: any): Promise<{ success: boolean; message?: string }> {
    try {
      const res = await fetch(`${BASE}/store/info.json`, { headers: this.authHeader(conn) });
      if (!res.ok) {
        const err = await res.json().catch(() => null) as any;
        return { success: false, message: err?.message || `HTTP ${res.status}` };
      }
      const data = await res.json() as any;
      const store = data?.store || data;
      return { success: true, message: `Tienda: ${store?.name || store?.url || 'conectada'}` };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  async publishProduct(conn: any, product: any): Promise<PublishResult> {
    const res = await fetch(`${BASE}/products.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeader(conn) },
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

    const res = await fetch(`${BASE}/products/${externalId}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...this.authHeader(conn) },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json() as any;
      throw new Error(`JumpSeller sync failed: ${err.message || res.status}`);
    }
    this.logger.log(`JumpSeller sync: product=${externalId} stock=${payload.stock}`);
  }
}

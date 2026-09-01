import { Injectable, Logger } from '@nestjs/common';
import { PlatformAdapter, SyncPayload, PublishResult } from './platform.interface';

// Paris / Cencosud Marketplace. Doc: https://developers.ecomm.cencosud.com/docs
// La API de producción es la misma URL sin el "-stg".
const PROD_BASE = 'https://api-developers.ecomm.cencosud.com';
const STG_BASE = 'https://api-developers.ecomm-stg.cencosud.com';

interface ParisAuth {
  accessToken: string;
  expiresIn: number; // segundos (típicamente 14400 = 4h)
  seller: { id?: string; name?: string; email?: string; status?: string };
}

@Injectable()
export class ParisAdapter implements PlatformAdapter {
  private readonly logger = new Logger(ParisAdapter.name);

  private creds(conn: any): any {
    return (conn.credentials as any) || {};
  }

  private baseUrl(conn: any): string {
    return this.creds(conn).env === 'staging' ? STG_BASE : PROD_BASE;
  }

  /**
   * Paris autentica en dos pasos: se envía la API Key en el header Authorization
   * y responde un accessToken JWT (válido ~4h) que se usa en el resto de llamadas.
   * No conviene pedir este token en cada request; cuando implementemos sync de
   * stock/precio habrá que cachearlo hasta poco antes de expiresIn.
   */
  private async authenticate(conn: any): Promise<ParisAuth> {
    const apiKey = this.creds(conn).apiKey;
    if (!apiKey) throw new Error('Falta la API Key de Paris');

    const res = await fetch(`${this.baseUrl(conn)}/v1/auth/apiKey`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(
        `Paris rechazó la autenticación (HTTP ${res.status})${txt ? `: ${txt.slice(0, 200)}` : ''}`,
      );
    }

    const data = (await res.json()) as any;
    const p = data.jwtPayload || {};
    return {
      accessToken: data.accessToken,
      expiresIn: Number(data.expiresIn) || 0,
      seller: {
        id: p.seller_id,
        name: p.seller_name,
        email: p.email,
        status: p.seller_status,
      },
    };
  }

  async testConnection(conn: any): Promise<{ success: boolean; message?: string }> {
    try {
      const { seller } = await this.authenticate(conn);
      const who = seller.name || seller.email || seller.id || 'seller';
      const env = this.creds(conn).env === 'staging' ? ' [ambiente de pruebas]' : '';
      const inactive = seller.status && seller.status !== 'active' ? ` (estado: ${seller.status})` : '';
      return { success: true, message: `Conectado como ${who}${inactive}${env}` };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  async publishProduct(): Promise<PublishResult> {
    throw new Error(
      'La publicación de productos a Paris aún no está disponible. Crea el producto en Paris e ingresa el SKU manualmente.',
    );
  }

  async syncListing(conn: any, externalId: string, payload: SyncPayload): Promise<void> {
    this.logger.warn(
      `Sync a Paris pendiente de implementar: externalId=${externalId} stock=${payload.stock} price=${payload.price ?? '-'}`,
    );
  }
}

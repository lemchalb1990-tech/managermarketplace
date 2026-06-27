import { Injectable, Logger } from '@nestjs/common';
import { PlatformAdapter, SyncPayload, PublishResult } from './platform.interface';

// Adapter base para plataformas sin API pública implementada.
// Las credenciales se almacenan; la sincronización se activará cuando esté disponible.
@Injectable()
export class StubAdapter implements PlatformAdapter {
  private readonly logger = new Logger(StubAdapter.name);

  async testConnection(conn: any): Promise<{ success: boolean; message?: string }> {
    return {
      success: true,
      message: 'Credenciales guardadas. La sincronización automática estará disponible próximamente.',
    };
  }

  async publishProduct(conn: any, product: any): Promise<PublishResult> {
    throw new Error(`Publicación directa no disponible para ${conn.marketplace}. Crea el producto en la plataforma e ingresa el ID externo manualmente.`);
  }

  async syncListing(conn: any, externalId: string, payload: SyncPayload): Promise<void> {
    this.logger.warn(`Sync pendiente para ${conn.marketplace}: externalId=${externalId} stock=${payload.stock}`);
  }
}

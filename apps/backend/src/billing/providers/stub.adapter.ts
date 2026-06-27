import { Injectable, Logger } from '@nestjs/common';
import { BillingAdapter, IssueDtePayload, DteResult } from './provider.interface';

@Injectable()
export class BillingStubAdapter implements BillingAdapter {
  private readonly logger = new Logger(BillingStubAdapter.name);

  async testConnection(creds: Record<string, string>): Promise<{ success: boolean; message?: string }> {
    if (!creds || Object.keys(creds).length === 0) {
      return { success: false, message: 'Se requieren credenciales' };
    }
    return { success: true, message: 'Credenciales almacenadas. La integración estará disponible próximamente.' };
  }

  async issueDte(_creds: Record<string, string>, payload: IssueDtePayload): Promise<DteResult> {
    this.logger.warn(`Stub DTE issued for ${payload.razonSocial} — provider not integrated yet`);
    const mockFolio = Math.floor(Math.random() * 9000) + 1000;
    return {
      externalId: `STUB-${mockFolio}`,
      folio: mockFolio,
      pdfUrl: undefined,
      xmlUrl: undefined,
    };
  }
}

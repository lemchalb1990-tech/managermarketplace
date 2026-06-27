import { Injectable, Logger } from '@nestjs/common';
import { BillingAdapter, IssueDtePayload, DteResult } from './provider.interface';

const DTE_TYPE_CODE: Record<string, number> = {
  FACTURA: 33,
  BOLETA: 39,
  NOTA_CREDITO: 61,
  NOTA_DEBITO: 56,
  FACTURA_EXENTA: 34,
};

const BASE_URL = 'https://api.bsale.cl/v1';

@Injectable()
export class BsaleAdapter implements BillingAdapter {
  private readonly logger = new Logger(BsaleAdapter.name);

  private headers(creds: Record<string, string>) {
    return { 'access_token': creds.accessToken, 'Content-Type': 'application/json' };
  }

  async testConnection(creds: Record<string, string>): Promise<{ success: boolean; message?: string }> {
    try {
      const res = await fetch(`${BASE_URL}/users.json`, { headers: this.headers(creds) });
      if (res.status === 401) return { success: false, message: 'Access Token inválido' };
      if (!res.ok) return { success: false, message: `Error ${res.status}` };
      return { success: true, message: 'Conexión exitosa con Bsale' };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  async issueDte(creds: Record<string, string>, payload: IssueDtePayload): Promise<DteResult> {
    const typeCode = DTE_TYPE_CODE[payload.dteType] ?? 39;

    const details = payload.items.map((i) => ({
      quantity: i.quantity,
      netUnitValue: i.unitPrice,
      discount: i.discount ?? 0,
      comment: i.name,
    }));

    const body = {
      documentTypeId: creds.documentTypeId || typeCode,
      officeId: Number(creds.officeId) || 1,
      emissionDate: Math.floor(Date.now() / 1000),
      expirationDate: Math.floor(Date.now() / 1000),
      declare: 1,
      references: [],
      client: {
        code: payload.rut,
        activity: payload.giro || '',
        company: payload.razonSocial,
        email: payload.email || '',
        address: payload.address || '',
        city: payload.commune || 'Santiago',
      },
      details,
    };

    const res = await fetch(`${BASE_URL}/documents.json`, {
      method: 'POST',
      headers: this.headers(creds),
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.description || data?.message || `Bsale error ${res.status}`;
      throw new Error(msg);
    }

    return {
      externalId: String(data.id || 'unknown'),
      folio: data.number,
      pdfUrl: data.urlPdf,
      xmlUrl: data.urlXml,
    };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { BillingAdapter, IssueDtePayload, DteResult } from './provider.interface';

const DTE_TYPE_CODE: Record<string, number> = {
  FACTURA: 33,
  BOLETA: 39,
  NOTA_CREDITO: 61,
  NOTA_DEBITO: 56,
  FACTURA_EXENTA: 34,
};

const BASE_URL = 'https://api.haulmer.com';

@Injectable()
export class OpenFacturaAdapter implements BillingAdapter {
  private readonly logger = new Logger(OpenFacturaAdapter.name);

  async testConnection(creds: Record<string, string>): Promise<{ success: boolean; message?: string }> {
    try {
      const res = await fetch(`${BASE_URL}/v2/company`, {
        headers: { apikey: creds.apiKey },
      });
      if (res.status === 401) return { success: false, message: 'API Key inválida' };
      if (!res.ok) return { success: false, message: `Error ${res.status}` };
      return { success: true, message: 'Conexión exitosa con OpenFactura' };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  async issueDte(creds: Record<string, string>, payload: IssueDtePayload): Promise<DteResult> {
    const typeCode = DTE_TYPE_CODE[payload.dteType] ?? 39;

    const body = {
      company: {
        rut: creds.companyRut || payload.companyRut,
        activity: creds.companyActivity || 'Venta de bienes y servicios',
      },
      customer: {
        rut: payload.rut,
        name: payload.razonSocial,
        activity: payload.giro || '',
        address: payload.address || '',
        commune: payload.commune || 'Santiago',
        region: 'Región Metropolitana',
        email: payload.email || '',
      },
      document: {
        type: typeCode,
        observations: payload.notes || '',
        items: payload.items.map((i) => ({
          name: i.name,
          qty: i.quantity,
          price: i.unitPrice,
          discount: i.discount ?? 0,
          total: Math.round(i.unitPrice * i.quantity * (1 - (i.discount ?? 0) / 100)),
        })),
      },
    };

    const res = await fetch(`${BASE_URL}/v2/dte`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: creds.apiKey },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.message || `OpenFactura error ${res.status}`);
    }

    return {
      externalId: String(data.folio || data.id || 'unknown'),
      folio: data.folio,
      pdfUrl: data.pdfUrl || data.links?.pdf,
      xmlUrl: data.xmlUrl || data.links?.xml,
    };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { BillingAdapter, IssueDtePayload, DteResult } from './provider.interface';
import { normalizeRut } from '../../common/rut.util';

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

  // Documentos emitidos en un rango de fechas, con tipo, cliente, referencias y detalle. Bsale
  // identifica la venta de un marketplace en `salesId` (PAR…, WAL…, FAL…) y en la referencia.
  async listDocuments(creds: Record<string, string>, from: Date, to: Date, documentTypeIds: number[]): Promise<any[]> {
    const out: any[] = [];
    const range = `[${Math.floor(from.getTime() / 1000)},${Math.floor(to.getTime() / 1000)}]`;
    for (const typeId of documentTypeIds) {
      for (let offset = 0; ; offset += 50) {
        const url = `${BASE_URL}/documents.json?limit=50&offset=${offset}&documenttypeid=${typeId}&emissiondaterange=${range}&expand=[document_type,client,references,details]`;
        const res = await fetch(url, { headers: this.headers(creds) });
        if (!res.ok) throw new Error(`Bsale documentos (HTTP ${res.status})`);
        const data: any = await res.json();
        const items: any[] = data.items || [];
        out.push(...items);
        if (items.length < 50) break;
      }
    }
    return out;
  }

  // Ids de los tipos de documento de la cuenta según su código SII (39 boleta, 33 factura…).
  async documentTypeIds(creds: Record<string, string>, codesSii: string[]): Promise<{ id: number; codeSii: string }[]> {
    const res = await fetch(`${BASE_URL}/document_types.json?limit=50&state=0`, { headers: this.headers(creds) });
    if (!res.ok) throw new Error(`Bsale tipos de documento (HTTP ${res.status})`);
    const data: any = await res.json();
    return (data.items || [])
      .filter((t: any) => codesSii.includes(String(t.codeSii)))
      .map((t: any) => ({ id: Number(t.id), codeSii: String(t.codeSii) }));
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
      expirationDate: payload.paymentCondition === 'CREDITO' && payload.dueDate
        ? Math.floor(new Date(payload.dueDate).getTime() / 1000)
        : Math.floor(Date.now() / 1000),
      declare: 1,
      references: [],
      client: {
        code: normalizeRut(payload.rut),
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

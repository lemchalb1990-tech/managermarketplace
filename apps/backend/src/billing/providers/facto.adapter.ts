import { Injectable, Logger } from '@nestjs/common';
import { BillingAdapter, IssueDtePayload, DteResult } from './provider.interface';

// IDs internos de Facto (Koywe) para Chile — ver /documentacion/api/es/ejemplos/chile/tabla-de-codigos/
const DOCUMENT_TYPE_ID: Record<string, number> = {
  FACTURA: 2,
  FACTURA_EXENTA: 32,
  BOLETA: 37,
  NOTA_CREDITO: 16,
  NOTA_DEBITO: 17,
};

// Tipos de documento exentos de IVA (boletas y facturas exentas)
const EXEMPT_TYPES = new Set(['BOLETA', 'FACTURA_EXENTA']);

const CHILE_COUNTRY_ID = 253;
const CLP_CURRENCY_ID = 39;
const IVA_TAX_TYPE_ID = '387';
const IVA_RATE = 0.19;

const BASE_URL = 'https://apifacto.com/v1';

interface FactoToken {
  access_token: string;
}

@Injectable()
export class FactoAdapter implements BillingAdapter {
  private readonly logger = new Logger(FactoAdapter.name);

  private async getToken(creds: Record<string, string>): Promise<FactoToken> {
    const res = await fetch(`${BASE_URL}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'password',
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        username: creds.username,
        password: creds.password,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error_description || data?.error || `Error de autenticación Facto (${res.status})`);
    }
    return data;
  }

  async testConnection(creds: Record<string, string>): Promise<{ success: boolean; message?: string }> {
    try {
      const token = await this.getToken(creds);
      const res = await fetch(`${BASE_URL}/accounts/${creds.accountId}`, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (!res.ok) return { success: false, message: `Cuenta o credenciales inválidas (${res.status})` };
      return { success: true, message: 'Conexión exitosa con Facto' };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  async issueDte(creds: Record<string, string>, payload: IssueDtePayload): Promise<DteResult> {
    const token = await this.getToken(creds);
    const documentTypeId = DOCUMENT_TYPE_ID[payload.dteType] ?? DOCUMENT_TYPE_ID.BOLETA;
    const exempt = EXEMPT_TYPES.has(payload.dteType);

    let netAmount = 0;
    let taxesAmount = 0;
    const details = payload.items.map((item) => {
      const lineNet = Math.round(item.unitPrice * item.quantity * (1 - (item.discount ?? 0) / 100));
      const lineTax = exempt ? 0 : Math.round(lineNet * IVA_RATE);
      netAmount += lineNet;
      taxesAmount += lineTax;
      return {
        quantity: item.quantity,
        line_description: item.name,
        unit_measure: 'UN',
        unit_price: item.unitPrice,
        modifier_percentage: item.discount ?? 0,
        modifier_amount: 0,
        total_taxes: lineTax,
        total_amount_line: lineNet + lineTax,
        ...(exempt ? {} : { taxes: [{ tax_type_id: IVA_TAX_TYPE_ID, tax_percentage: IVA_RATE * 100, tax_amount: lineTax }] }),
      };
    });

    const body = {
      header: {
        account_id: Number(creds.accountId),
        document_type_id: documentTypeId,
        issue_date: new Date().toISOString().slice(0, 10),
        issuer_tax_id_code: creds.companyRut || payload.companyRut,
        issuer_tax_id_type: 'CL-RUT',
        issuer_legal_name: creds.companyName || '',
        issuer_address: creds.companyAddress || '',
        issuer_district: creds.companyDistrict || 'Santiago',
        issuer_city: creds.companyCity || 'Santiago',
        issuer_country_id: CHILE_COUNTRY_ID,
        issuer_phone: creds.companyPhone || '',
        issuer_activity: creds.companyActivity || 'Venta de bienes y servicios',
        receiver_tax_id_code: payload.rut,
        receiver_tax_id_type: 'CL-RUT',
        receiver_legal_name: payload.razonSocial,
        receiver_address: payload.address || '',
        receiver_district: payload.commune || 'Santiago',
        receiver_city: payload.commune || 'Santiago',
        receiver_country_id: CHILE_COUNTRY_ID,
        receiver_phone: '',
        receiver_activity: payload.giro || '',
        receiver_email: payload.email || '',
        payment_conditions: '0',
        currency_id: CLP_CURRENCY_ID,
        observations: payload.notes || '',
      },
      details,
      totals: {
        net_amount: netAmount,
        taxes_amount: taxesAmount,
        total_amount: netAmount + taxesAmount,
      },
    };

    const res = await fetch(`${BASE_URL}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.access_token}` },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.result?.error_message || data?.error || `Error Facto (${res.status})`);
    }

    return {
      externalId: String(data.document_id ?? 'unknown'),
      folio: data.header?.document_number,
      pdfUrl: data.electronic_document?.document_pdf
        ? `data:application/pdf;base64,${data.electronic_document.document_pdf}`
        : undefined,
      xmlUrl: data.electronic_document?.document_xml
        ? `data:application/xml;base64,${data.electronic_document.document_xml}`
        : undefined,
    };
  }
}

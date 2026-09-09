export interface InvoiceItem {
  name: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
}

export interface IssueDtePayload {
  dteType: string;
  rut: string;
  razonSocial: string;
  giro?: string;
  address?: string;
  commune?: string;
  email?: string;
  items: InvoiceItem[];
  notes?: string;
  companyRut?: string;
  // Condición de pago para la forma de pago SII (1=contado, 2=crédito).
  paymentCondition?: 'CONTADO' | 'CREDITO';
  // Fecha de vencimiento (ISO yyyy-mm-dd) cuando la condición es crédito.
  dueDate?: string;
}

export interface DteResult {
  externalId: string;
  folio?: number;
  pdfUrl?: string;
  xmlUrl?: string;
}

export interface BillingAdapter {
  testConnection(credentials: Record<string, string>): Promise<{ success: boolean; message?: string }>;
  issueDte(credentials: Record<string, string>, payload: IssueDtePayload): Promise<DteResult>;
}

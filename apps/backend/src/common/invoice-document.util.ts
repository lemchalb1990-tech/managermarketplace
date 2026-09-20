export interface InvoiceDocument {
  bytes: Buffer;
  contentType: string;
  extension: 'xml' | 'pdf';
}

// El DTE emitido puede venir como URL real (OpenFactura/Bsale hospedan el documento) o como
// data URI en base64 (Facto lo devuelve embebido) — este helper normaliza ambos casos a los
// bytes crudos para poder reenviarlos a un marketplace (Ripley los sube directo; Falabella
// necesita un link público, ver BillingService.hostInvoiceDocumentPublicly).
export async function fetchInvoiceDocument(url: string): Promise<InvoiceDocument> {
  if (url.startsWith('data:')) {
    const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(url);
    if (!match) throw new Error('Formato de data URL del documento tributario no reconocido');
    const contentType = match[1];
    const bytes = Buffer.from(match[2], 'base64');
    return { bytes, contentType, extension: contentType.includes('xml') ? 'xml' : 'pdf' };
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar el documento tributario (HTTP ${res.status})`);
  const contentType = res.headers.get('content-type') || (url.toLowerCase().endsWith('.xml') ? 'application/xml' : 'application/pdf');
  const bytes = Buffer.from(await res.arrayBuffer());
  return { bytes, contentType, extension: contentType.includes('xml') ? 'xml' : 'pdf' };
}

import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BillingProvider, DteType, InvoiceStatus, Role, SaleChannel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BsaleAdapter } from './providers/bsale.adapter';
import { integrationsDisabled } from '../common/integrations.util';

// Bsale como facturador de las ventas de marketplaces (no Mercado Libre): lee las boletas y
// facturas que Bsale ya emitió, identifica de qué orden son (salesId "PAR…/WAL…/FAL…/RIP…/SHO…"
// o la referencia "número + marketplace") y las carga como documento de esa venta/orden.
// No emite nada ni modifica Bsale: solo lectura.

const PREFIX_CHANNEL: Record<string, SaleChannel> = {
  PAR: SaleChannel.PARIS, WAL: SaleChannel.WALMART, FAL: SaleChannel.FALABELLA,
  RIP: SaleChannel.RIPLEY, SHO: SaleChannel.SHOPIFY, JUM: SaleChannel.JUMPSELLER, HIT: SaleChannel.HITES,
};
const NAME_CHANNEL: Record<string, SaleChannel> = {
  paris: SaleChannel.PARIS, walmart: SaleChannel.WALMART, falabella: SaleChannel.FALABELLA,
  ripley: SaleChannel.RIPLEY, shopify: SaleChannel.SHOPIFY, jumpseller: SaleChannel.JUMPSELLER, hites: SaleChannel.HITES,
};
const DTE_BY_SII: Record<string, DteType> = { '39': DteType.BOLETA, '33': DteType.FACTURA, '34': DteType.FACTURA_EXENTA };

export interface BsaleImportResult {
  scanned: number;
  marketplace: number;
  linked: number;
  alreadyLoaded: number;
  withoutSale: number;
  byChannel: Record<string, number>;
}

@Injectable()
export class BsaleImportService {
  private readonly logger = new Logger(BsaleImportService.name);
  private running = false;

  constructor(private prisma: PrismaService, private bsale: BsaleAdapter) {}

  // Marketplace y número de orden de un documento de Bsale (null si no es de un marketplace).
  orderRef(doc: any): { channel: SaleChannel; orderId: string } | null {
    const salesId = String(doc.salesId || '');
    const pfx = salesId.slice(0, 3).toUpperCase();
    if (PREFIX_CHANNEL[pfx] && salesId.length > 3) return { channel: PREFIX_CHANNEL[pfx], orderId: salesId.slice(3) };
    for (const ref of doc.references?.items || []) {
      const reason = String(ref.reason || '').toLowerCase().trim();
      if (NAME_CHANNEL[reason] && ref.number) return { channel: NAME_CHANNEL[reason], orderId: String(ref.number).trim() };
      // Formato antiguo: "pedido ecl18174293 paris" o "pedido shopify #4989".
      const m = reason.match(/pedido\s+(?:([a-z]+)\s+)?(#?[\w-]+)(?:\s+([a-z]+))?/);
      if (m) {
        const name = m[3] && NAME_CHANNEL[m[3]] ? m[3] : m[1] || '';
        if (NAME_CHANNEL[name]) return { channel: NAME_CHANNEL[name], orderId: m[2] };
      }
    }
    return null;
  }

  // Índice en memoria de las ventas de marketplaces de la empresa (canal|n° de orden → id),
  // para no consultar la base por cada documento.
  private async saleIndex(companyId: string) {
    const sales = await this.prisma.sale.findMany({
      where: { companyId, channel: { in: Object.values(PREFIX_CHANNEL) } },
      select: { id: true, channel: true, externalId: true, externalAltId: true },
    });
    const idx = new Map<string, string>();
    for (const s of sales) {
      if (s.externalId) {
        idx.set(`${s.channel}|${s.externalId}`, s.id);
        // Paris: los documentos antiguos traen la orden sin el sufijo de la suborden ("ecl18174293").
        const base = s.channel === SaleChannel.PARIS ? s.externalId.replace(/-\d+$/, '') : null;
        if (base && !idx.has(`${s.channel}|${base}`)) idx.set(`${s.channel}|${base}`, s.id);
      }
      if (s.externalAltId) idx.set(`${s.channel}|${s.externalAltId}`, s.id);
    }
    return idx;
  }

  async importForConnection(connectionId: string, user: any, days = 120): Promise<BsaleImportResult> {
    const conn = await this.prisma.billingConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundException('Conexión de facturación no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) throw new ForbiddenException();
    if (conn.provider !== BillingProvider.BSALE) throw new BadRequestException('Solo disponible para Bsale');
    return this.importDocuments(conn, days);
  }

  private async importDocuments(conn: any, days: number): Promise<BsaleImportResult> {
    const creds = (conn.credentials as any) || {};
    const types = await this.bsale.documentTypeIds(creds, Object.keys(DTE_BY_SII));
    const typeSii = new Map(types.map((t) => [t.id, t.codeSii]));
    const to = new Date();
    const from = new Date(to.getTime() - days * 86400 * 1000);
    const docs = await this.bsale.listDocuments(creds, from, to, types.map((t) => t.id));

    const result: BsaleImportResult = { scanned: docs.length, marketplace: 0, linked: 0, alreadyLoaded: 0, withoutSale: 0, byChannel: {} };
    const sales = await this.saleIndex(conn.companyId);
    const loaded = new Set(
      (await this.prisma.invoice.findMany({ where: { connectionId: conn.id, externalId: { not: null } }, select: { externalId: true } }))
        .map((i) => i.externalId as string),
    );
    for (const doc of docs) {
      const ref = this.orderRef(doc);
      if (!ref) continue; // sin referencia de marketplace (venta directa, Mercado Libre, etc.)
      result.marketplace++;
      const externalId = String(doc.id);
      if (loaded.has(externalId)) { result.alreadyLoaded++; continue; }
      const saleId = sales.get(`${ref.channel}|${ref.orderId}`);
      if (!saleId) { result.withoutSale++; continue; }
      const sale = { id: saleId };

      const sii = typeSii.get(Number(doc.document_type?.id)) || String(doc.document_type?.codeSii || '');
      const client = doc.client || {};
      const person = [client.firstName, client.lastName].filter(Boolean).join(' ').trim();
      const items = (doc.details?.items || []).map((d: any) => ({
        name: d.variant?.description || d.note || d.variant?.code || 'Producto',
        sku: d.variant?.code || null,
        quantity: Number(d.quantity || 1),
        unitPrice: Number(d.netUnitValue || 0),
        total: Number(d.totalAmount || 0),
      }));
      await this.prisma.invoice.create({
        data: {
          folio: doc.number != null ? Number(doc.number) : null,
          dteType: DTE_BY_SII[sii] || DteType.BOLETA,
          rut: client.code || '66666666-6',
          razonSocial: client.company || person || 'Consumidor final',
          giro: client.activity || null,
          address: client.address || doc.address || null,
          commune: client.municipality || doc.municipality || null,
          email: client.email || null,
          netAmount: Number(doc.netAmount || 0),
          tax: Number(doc.taxAmount || 0),
          totalAmount: Number(doc.totalAmount || 0),
          items,
          notes: `Importado desde Bsale (${ref.channel} ${ref.orderId})`,
          status: InvoiceStatus.ISSUED,
          pdfUrl: doc.urlPdf || doc.urlPublicView || null,
          xmlUrl: doc.urlXml || null,
          externalId,
          issuedAt: doc.emissionDate ? new Date(Number(doc.emissionDate) * 1000) : new Date(),
          connectionId: conn.id,
          companyId: conn.companyId,
          saleId: sale.id,
        },
      });
      loaded.add(externalId);
      result.linked++;
      result.byChannel[ref.channel] = (result.byChannel[ref.channel] || 0) + 1;
    }
    return result;
  }

  // Cada 2 horas: documentos de los últimos 7 días de las conexiones Bsale activas.
  @Cron('15 */2 * * *')
  async scheduled() {
    if (integrationsDisabled() || this.running) return;
    this.running = true;
    try {
      const conns = await this.prisma.billingConnection.findMany({
        where: { provider: BillingProvider.BSALE, active: true, company: { active: true } },
      });
      for (const c of conns) {
        try {
          const r = await this.importDocuments(c, 7);
          if (r.linked) this.logger.log(`Bsale ${c.id}: ${r.linked} documento(s) de marketplaces cargados`);
        } catch (err: any) {
          this.logger.warn(`Bsale ${c.id}: ${err?.message || err}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}

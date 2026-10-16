import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { assertIntegrationsEnabled } from '../common/integrations.util';
import { EmailType, Prisma } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertEmailConfigDto, UpsertEmailTemplateDto } from './dto/email.dto';
import { primaryFrontendUrl } from '../common/frontend-url.util';
import { EmailLogService } from './email-log.service';
import { DEFAULT_BLOCKS, DEFAULT_BRAND_COLOR, EMAIL_VARIABLES, EmailBlock, EmailBrand, brandedShell, renderBlocks, sanitizeBlocks } from './email-blocks';

const TYPE_LABELS: Record<EmailType, string> = {
  ORDER_CONFIRMED:       'Orden confirmada',
  ORDER_PREPARING:       'Orden en preparación',
  ORDER_READY_PICKUP:    'Lista para retiro',
  ORDER_OUT_FOR_DELIVERY:'En camino',
  ORDER_DELIVERED:       'Orden entregada',
  SALE_RECEIPT:          'Recibo de venta (POS)',
};

// Outer shell shared by all templates
function shell(content: string, companyName: string, accentColor = '#1d4ed8') {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${companyName}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f3f4f6;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
  <tr><td style="background:${accentColor};padding:24px 32px;">
    <p style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${companyName}</p>
  </td></tr>
  <tr><td style="padding:32px 32px 24px;">
    ${content}
  </td></tr>
  <tr><td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;text-align:center;">
    <p style="margin:0;color:#9ca3af;font-size:12px;">© ${companyName} · Correo generado automáticamente · No responder</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}


function buildItemsTable(items: { name: string; qty: number; unitPrice: number }[]): string {
  if (!items.length) return '';
  // Las órdenes no traen precio por línea: sin precios se omite la columna de subtotal.
  const withPrice = items.some(i => Number(i.unitPrice) > 0);
  const esc = (v: string) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const th = 'padding:8px 0;font-size:12px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:.05em;';
  const rows = items.map(i => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#374151;">${esc(i.name)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#6b7280;text-align:center;">${i.qty}</td>
      ${withPrice ? `<td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#374151;text-align:right;">$${(i.qty * i.unitPrice).toLocaleString('es-CL')}</td>` : ''}
    </tr>`).join('');

  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
  <thead>
    <tr style="background:#f9fafb;">
      <th style="${th}text-align:left;">Producto</th>
      <th style="${th}text-align:center;">Cant.</th>
      ${withPrice ? `<th style="${th}text-align:right;">Subtotal</th>` : ''}
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`;
}

function buildDeliveryBlock(order: any): string {
  if (!order.address && !order.fulfillmentType) return '';
  if (order.fulfillmentType === 'PICKUP') {
    return `<div style="margin:16px 0;padding:14px 16px;background:#f9fafb;border-radius:8px;font-size:14px;color:#374151;">
      <strong>🏪 Retiro en tienda</strong>
    </div>`;
  }
  const parts = [order.address, order.commune, order.city].filter(Boolean).join(', ');
  if (!parts) return '';
  return `<div style="margin:16px 0;padding:14px 16px;background:#f9fafb;border-radius:8px;font-size:14px;color:#374151;">
    <strong>🏠 Dirección de entrega</strong><br>
    <span style="color:#6b7280;">${parts}</span>
  </div>`;
}

function renderTemplate(html: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replaceAll(`{{${k}}}`, v ?? ''),
    html,
  );
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private prisma: PrismaService, private emailLog: EmailLogService) {}

  // ─── Config CRUD ───────────────────────────────────────────────────────────

  async getConfig(companyId: string) {
    const cfg = await this.prisma.emailConfig.findUnique({ where: { companyId } });
    if (!cfg) return null;
    const { pass: _, ...safe } = cfg;
    return { ...safe, hasPass: true };
  }

  async upsertConfig(companyId: string, dto: UpsertEmailConfigDto) {
    const data: any = {
      host: dto.host, port: dto.port, secure: dto.secure,
      user: dto.user, fromName: dto.fromName, fromEmail: dto.fromEmail,
      active: dto.active ?? true,
    };
    if (dto.pass) data.pass = dto.pass;

    const existing = await this.prisma.emailConfig.findUnique({ where: { companyId } });
    if (existing) {
      return this.prisma.emailConfig.update({ where: { companyId }, data });
    }
    if (!dto.pass) throw new Error('La contraseña es requerida para la primera configuración');
    return this.prisma.emailConfig.create({ data: { ...data, companyId, pass: dto.pass } });
  }

  // ─── Templates CRUD ────────────────────────────────────────────────────────

  getAllTypes(): { type: EmailType; label: string }[] {
    return (Object.keys(DEFAULT_BLOCKS) as EmailType[]).map(type => ({
      type, label: TYPE_LABELS[type],
    }));
  }

  async getTemplates(companyId: string | null) {
    const dbTemplates = await this.prisma.emailTemplate.findMany({
      where: { companyId: companyId ?? null },
    });

    return (Object.keys(DEFAULT_BLOCKS) as EmailType[]).map(type => {
      const db = dbTemplates.find(t => t.type === type);
      const def = DEFAULT_BLOCKS[type];
      // Plantilla HTML personalizada antes del editor por bloques: se respeta tal cual.
      const legacyHtml = !!db && !db.blocks && !!db.bodyHtml?.trim();
      return {
        type,
        label: TYPE_LABELS[type],
        subject: db?.subject ?? def.subject,
        mode: legacyHtml ? 'html' as const : 'blocks' as const,
        blocks: legacyHtml ? null : (db?.blocks ? sanitizeBlocks(db.blocks) : def.blocks),
        bodyHtml: legacyHtml ? db!.bodyHtml : null,
        defaultSubject: def.subject,
        defaultBlocks: def.blocks,
        active: db?.active ?? true,
        isCustomized: !!db,
        id: db?.id,
      };
    });
  }

  async upsertTemplate(companyId: string | null, type: EmailType, dto: UpsertEmailTemplateDto) {
    const existing = await this.prisma.emailTemplate.findUnique({
      where: { companyId_type: { companyId: companyId as string, type } },
    });
    // Con bloques se guarda solo la lista (el HTML lo arma el sistema al enviar); sin bloques
    // se conserva el HTML que trae (plantillas antiguas que la empresa no quiso convertir).
    const blocks = dto.blocks !== undefined ? sanitizeBlocks(dto.blocks) : null;
    const data = {
      subject: String(dto.subject ?? '').slice(0, 300),
      bodyHtml: blocks ? '' : (dto.bodyHtml ?? existing?.bodyHtml ?? ''),
      blocks: blocks ? (blocks as any) : Prisma.DbNull,
      active: dto.active ?? true,
    };
    if (existing) {
      return this.prisma.emailTemplate.update({ where: { id: existing.id }, data });
    }
    return this.prisma.emailTemplate.create({
      data: { ...data, type, companyId: companyId ?? undefined },
    });
  }

  async resetTemplate(companyId: string | null, type: EmailType) {
    const existing = await this.prisma.emailTemplate.findUnique({
      where: { companyId_type: { companyId: companyId as string, type } },
    });
    if (existing) {
      await this.prisma.emailTemplate.delete({ where: { id: existing.id } });
    }
    return { reset: true };
  }

  // ─── Sending ────────────────────────────────────────────────────────────────

  private async resolveTemplate(companyId: string, type: EmailType) {
    // Company-specific first
    const specific = await this.prisma.emailTemplate.findFirst({
      where: { companyId, type, active: true },
    });
    if (specific) return specific;
    // Global default from DB
    const global = await this.prisma.emailTemplate.findFirst({
      where: { companyId: null, type, active: true },
    });
    if (global) return global;
    // Predeterminado del sistema
    const def = DEFAULT_BLOCKS[type];
    return def ? { subject: def.subject, bodyHtml: '', blocks: def.blocks as unknown } : null;
  }

  // ─── Identidad de la empresa en sus correos ─────────────────────────────────

  async getBrand(companyId: string | null): Promise<EmailBrand & { companyName: string; hasLogo: boolean }> {
    if (!companyId) return { color: DEFAULT_BRAND_COLOR, logoUrl: null, showLogo: false, footerText: null, contact: null, companyName: 'Mi Tienda', hasLogo: false };
    const [brand, company, billing] = await Promise.all([
      this.prisma.emailBrand.findUnique({ where: { companyId } }),
      this.prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }),
      this.prisma.billingProfile.findUnique({ where: { companyId }, select: { logoUrl: true } }),
    ]);
    const logoUrl = billing?.logoUrl && /^https?:\/\//i.test(billing.logoUrl) ? billing.logoUrl : null;
    return {
      color: brand?.color ?? DEFAULT_BRAND_COLOR,
      logoUrl,
      showLogo: brand?.showLogo ?? true,
      footerText: brand?.footerText ?? null,
      contact: brand?.contact ?? null,
      companyName: company?.name ?? 'Mi Tienda',
      hasLogo: !!logoUrl,
    };
  }

  async saveBrand(companyId: string | null, dto: { color?: string; showLogo?: boolean; footerText?: string | null; contact?: string | null }) {
    if (!companyId) throw new BadRequestException('Selecciona una empresa');
    const color = /^#[0-9a-f]{6}$/i.test(String(dto.color || '')) ? String(dto.color) : DEFAULT_BRAND_COLOR;
    const data = {
      color,
      showLogo: dto.showLogo ?? true,
      footerText: dto.footerText ? String(dto.footerText).slice(0, 500) : null,
      contact: dto.contact ? String(dto.contact).slice(0, 300) : null,
    };
    await this.prisma.emailBrand.upsert({ where: { companyId }, create: { companyId, ...data }, update: data });
    return this.getBrand(companyId);
  }

  /**
   * Arma asunto y HTML final: bloques (o el HTML antiguo) + identidad de la empresa.
   * `parts` son los bloques del sistema ya armados con los datos reales del pedido o venta.
   */
  private async compose(
    companyId: string | null,
    template: { subject: string; bodyHtml?: string | null; blocks?: unknown },
    vars: Record<string, string>,
    parts: { items: string; total: string; delivery: string },
    brandOverride?: EmailBrand,
  ) {
    const brand = brandOverride ?? (await this.getBrand(companyId));
    const subject = renderTemplate(template.subject, vars);
    const inner = template.blocks
      ? renderBlocks(sanitizeBlocks(template.blocks), vars, parts, brand)
      : renderTemplate(template.bodyHtml ?? '', { ...vars, itemsTable: parts.items, deliveryBlock: parts.delivery });
    return { subject, html: brandedShell(inner, vars.companyName, brand) };
  }

  /** Vista previa con datos de ejemplo (lo que ve la empresa mientras edita). */
  async previewTemplate(companyId: string | null, dto: { subject: string; blocks?: unknown; bodyHtml?: string | null; brand?: Partial<EmailBrand> }) {
    const saved = await this.getBrand(companyId);
    const brand: EmailBrand = { ...saved, ...(dto.brand ?? {}), logoUrl: saved.logoUrl };
    const vars: Record<string, string> = Object.fromEntries(Object.entries(EMAIL_VARIABLES).map(([k, v]) => [k, v.sample]));
    vars.companyName = saved.companyName;
    const parts = {
      items: buildItemsTable([
        { name: 'Silla de escritorio ergonómica', qty: 1, unitPrice: 49990 },
        { name: 'Cojín lumbar', qty: 2, unitPrice: 4995 },
      ]),
      total: vars.total,
      delivery: buildDeliveryBlock({ address: 'Av. Siempre Viva 742', commune: 'Providencia', city: 'Santiago' }),
    };
    return this.compose(companyId, { subject: dto.subject, blocks: dto.blocks ?? null, bodyHtml: dto.bodyHtml }, vars, parts, brand);
  }

  /** Envía la vista previa a un correo, con el SMTP de la empresa. */
  async sendTemplateTest(companyId: string | null, type: EmailType, to: string, dto: { subject: string; blocks?: unknown; bodyHtml?: string | null }) {
    if (!companyId) throw new BadRequestException('Selecciona una empresa');
    const transporter = await this.getTransporter(companyId);
    if (!transporter) throw new BadRequestException('Configura el servidor SMTP primero (pestaña Configuración SMTP)');
    const { subject, html } = await this.previewTemplate(companyId, dto);
    const from = await this.getFromAddress(companyId);
    await this.deliver(companyId, type, transporter, { from, to, subject: `[Prueba] ${subject}`, html });
    return { sent: true };
  }

  private async getTransporter(companyId: string): Promise<nodemailer.Transporter | null> {
    const cfg = await this.prisma.emailConfig.findUnique({ where: { companyId, active: true } });
    if (!cfg) return null;
    assertIntegrationsEnabled();
    return nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    });
  }

  private async getFromAddress(companyId: string): Promise<string> {
    const cfg = await this.prisma.emailConfig.findUnique({ where: { companyId } });
    return cfg ? `"${cfg.fromName}" <${cfg.fromEmail}>` : 'no-reply@example.com';
  }

  // Envía con el SMTP de la empresa y deja el correo en el registro (enviado o fallido con su error).
  private async deliver(companyId: string, type: string, transporter: nodemailer.Transporter, mail: { from: string; to: string; subject: string; html: string; attachments?: any[] }) {
    const entry = {
      channel: 'COMPANY' as const, type, companyId, to: mail.to, from: mail.from, subject: mail.subject, html: mail.html,
      attachments: (mail.attachments ?? []).map((a) => String(a.filename ?? 'adjunto')),
    };
    try {
      await transporter.sendMail(mail);
    } catch (err: any) {
      await this.emailLog.record({ ...entry, error: err?.message || String(err) });
      throw err;
    }
    await this.emailLog.record(entry);
  }

  async sendOrderEmail(order: any): Promise<void> {
    if (!order.customerEmail || !order.companyId) return;

    const typeMap: Partial<Record<string, EmailType>> = {
      PENDING:    EmailType.ORDER_CONFIRMED,
      PREPARING:  EmailType.ORDER_PREPARING,
      READY:      order.fulfillmentType === 'PICKUP' ? EmailType.ORDER_READY_PICKUP : EmailType.ORDER_OUT_FOR_DELIVERY,
      IN_TRANSIT: EmailType.ORDER_OUT_FOR_DELIVERY,
      DELIVERED:  EmailType.ORDER_DELIVERED,
    };

    const emailType = typeMap[order.status];
    if (!emailType) return;

    const template = await this.resolveTemplate(order.companyId, emailType);
    if (!template) return;

    const transporter = await this.getTransporter(order.companyId);
    if (!transporter) {
      this.logger.warn(`EmailConfig not found for company ${order.companyId}, skipping email`);
      return;
    }

    const company = await this.prisma.company.findUnique({ where: { id: order.companyId }, select: { name: true } });
    const companyName = company?.name ?? 'Tienda';

    const items = (order.itemChecks ?? []).map((ic: any) => ({
      name: ic.productName,
      qty: ic.expectedQty,
      unitPrice: 0,
    }));

    const itemsTable = items.length ? buildItemsTable(items) : '';
    const deliveryBlock = buildDeliveryBlock(order);
    const shortId = order.id.slice(-8).toUpperCase();
    const total = order.sale?.total
      ? `$${Number(order.sale.total).toLocaleString('es-CL')}`
      : '';

    const vars: Record<string, string> = {
      customerName: order.customerName ?? 'Cliente',
      orderId: shortId,
      companyName,
      total,
      address: [order.address, order.commune, order.city].filter(Boolean).join(', '),
      date: new Date().toLocaleDateString('es-CL'),
    };

    const { subject, html: bodyHtml } = await this.compose(order.companyId, template, vars, { items: itemsTable, total, delivery: deliveryBlock });

    const from = await this.getFromAddress(order.companyId);

    try {
      await this.deliver(order.companyId, emailType, transporter, { from, to: order.customerEmail, subject, html: bodyHtml });
      this.logger.log(`Email sent: ${emailType} → ${order.customerEmail}`);
    } catch (err: any) {
      this.logger.error(`Failed to send ${emailType} email: ${err.message}`);
    }
  }

  async sendSaleReceipt(sale: any, items: any[]): Promise<void> {
    if (!sale.customerEmail || !sale.companyId) return;

    const template = await this.resolveTemplate(sale.companyId, EmailType.SALE_RECEIPT);
    if (!template) return;

    const transporter = await this.getTransporter(sale.companyId);
    if (!transporter) {
      this.logger.warn(`EmailConfig not found for company ${sale.companyId}, skipping receipt`);
      return;
    }

    const company = await this.prisma.company.findUnique({ where: { id: sale.companyId }, select: { name: true } });
    const companyName = company?.name ?? 'Tienda';

    const mappedItems = items.map(i => ({ name: i.productName ?? i.name ?? '', qty: i.quantity, unitPrice: Number(i.unitPrice ?? 0) }));
    const itemsTable = buildItemsTable(mappedItems);
    const deliveryBlock = buildDeliveryBlock(sale);

    const vars: Record<string, string> = {
      customerName: sale.customerName ?? 'Cliente',
      orderId: sale.id.slice(-8).toUpperCase(),
      companyName,
      total: `$${Number(sale.total).toLocaleString('es-CL')}`,
      address: [sale.address, sale.commune, sale.city].filter(Boolean).join(', '),
      date: new Date().toLocaleDateString('es-CL'),
    };

    const { subject, html: bodyHtml } = await this.compose(sale.companyId, template, vars, { items: itemsTable, total: vars.total, delivery: deliveryBlock });

    const from = await this.getFromAddress(sale.companyId);

    try {
      await this.deliver(sale.companyId, EmailType.SALE_RECEIPT, transporter, { from, to: sale.customerEmail, subject, html: bodyHtml });
      this.logger.log(`Sale receipt sent → ${sale.customerEmail}`);
    } catch (err: any) {
      this.logger.error(`Failed to send sale receipt: ${err.message}`);
    }
  }

  async sendTestEmail(companyId: string, to: string): Promise<void> {
    const transporter = await this.getTransporter(companyId);
    if (!transporter) throw new Error('Configura el servidor SMTP primero');

    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
    const companyName = company?.name ?? 'Tienda';
    const from = await this.getFromAddress(companyId);

    const bodyHtml = shell(
      `<h2 style="margin:0 0 12px;font-size:20px;color:#1f2937;">Correo de prueba ✓</h2>
       <p style="color:#6b7280;font-size:15px;">Si recibes este mensaje, la configuración SMTP está funcionando correctamente.</p>
       <p style="color:#9ca3af;font-size:13px;margin-top:16px;">Enviado desde: ${companyName}</p>`,
      companyName,
    );

    await this.deliver(companyId, 'COMPANY_TEST', transporter, {
      from, to,
      subject: `Prueba de correo — ${companyName}`,
      html: bodyHtml,
    });
  }

  /** Envía un documento tributario (DTE) por correo, con el PDF adjunto si está disponible. */
  async sendInvoiceEmail(companyId: string, to: string, invoice: any): Promise<void> {
    const transporter = await this.getTransporter(companyId);
    if (!transporter) throw new Error('Configura el servidor SMTP primero');

    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
    const companyName = company?.name ?? 'Tienda';
    const from = await this.getFromAddress(companyId);

    const DOC: Record<string, string> = {
      BOLETA: 'Boleta electrónica', FACTURA: 'Factura electrónica', FACTURA_EXENTA: 'Factura exenta',
      NOTA_CREDITO: 'Nota de crédito', NOTA_DEBITO: 'Nota de débito',
    };
    const docLabel = DOC[invoice.dteType] ?? invoice.dteType;
    const title = `${docLabel}${invoice.folio ? ` N° ${invoice.folio}` : ''}`;
    const total = `$${Number(invoice.totalAmount).toLocaleString('es-CL')}`;

    const linkHtml = invoice.pdfUrl
      ? `<p style="margin-top:16px;"><a href="${invoice.pdfUrl}" style="color:#1d4ed8;">Ver / descargar ${docLabel} (PDF)</a></p>`
      : '';
    const bodyHtml = shell(
      `<h2 style="margin:0 0 12px;font-size:20px;color:#1f2937;">${title}</h2>
       <p style="color:#6b7280;font-size:15px;">${companyName} te envía tu documento tributario.</p>
       <p style="color:#374151;font-size:15px;">Total: <strong>${total}</strong></p>
       ${linkHtml}`,
      companyName,
    );

    const attachments: any[] = [];
    if (invoice.pdfUrl && /^https?:\/\//.test(invoice.pdfUrl)) {
      try {
        const res = await fetch(invoice.pdfUrl);
        if (res.ok) {
          attachments.push({
            filename: `${title.replace(/\s+/g, '_')}.pdf`,
            content: Buffer.from(await res.arrayBuffer()),
            contentType: 'application/pdf',
          });
        }
      } catch (err: any) {
        this.logger.warn(`No se pudo adjuntar el PDF del DTE: ${err.message}`);
      }
    }

    await this.deliver(companyId, 'INVOICE', transporter, { from, to, subject: `${title} — ${companyName}`, html: bodyHtml, attachments });
    this.logger.log(`DTE enviado → ${to}`);
  }

  /**
   * Envía una orden de trabajo (presupuesto POS) por correo — con un link a la página
   * imprimible en vez de un PDF adjunto, porque no generamos PDF server-side todavía (la
   * "impresión" es la misma página HTML vía window.print del navegador).
   */
  async sendWorkOrderEmail(companyId: string, to: string, workOrder: any): Promise<void> {
    const transporter = await this.getTransporter(companyId);
    if (!transporter) throw new Error('Configura el servidor SMTP primero');

    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
    const companyName = company?.name ?? 'Tienda';
    const from = await this.getFromAddress(companyId);

    const folio = `N° ${String(workOrder.folio).padStart(4, '0')}`;
    const total = workOrder.items.reduce((s: number, i: any) => s + i.quantity * Number(i.unitPrice), 0);
    const printUrl = `${primaryFrontendUrl()}/imprimir/orden-trabajo/${workOrder.id}`;

    const bodyHtml = shell(
      `<h2 style="margin:0 0 12px;font-size:20px;color:#1f2937;">Orden de trabajo ${folio}</h2>
       <p style="color:#6b7280;font-size:15px;">${companyName} te envía el presupuesto/orden de trabajo solicitado.</p>
       <p style="color:#374151;font-size:15px;">Total estimado: <strong>$${Math.round(total).toLocaleString('es-CL')}</strong></p>
       <p style="margin-top:16px;"><a href="${printUrl}" style="color:#1d4ed8;">Ver / imprimir la orden de trabajo</a></p>`,
      companyName,
    );

    await this.deliver(companyId, 'WORK_ORDER', transporter, { from, to, subject: `Orden de trabajo ${folio} — ${companyName}`, html: bodyHtml });
    this.logger.log(`Orden de trabajo enviada → ${to}`);
  }

  /** Aviso de cobro de una cuota de cobranza recurrente (por vencer o vencida), con link de pago opcional. */
  async sendRecurringChargeEmail(companyId: string, to: string, data: {
    clientName: string; serviceName: string; description?: string | null; number: number; amount: number;
    issueDate: Date; dueDate: Date; overdue: boolean; paymentUrl?: string | null;
  }): Promise<void> {
    const transporter = await this.getTransporter(companyId);
    if (!transporter) throw new Error('Configura el servidor SMTP primero');
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
    const companyName = company?.name ?? 'Tienda';
    const from = await this.getFromAddress(companyId);
    const amount = `$${Math.round(data.amount).toLocaleString('es-CL')}`;
    const fmt = (d: Date) => d.toLocaleDateString('es-CL', { timeZone: 'America/Santiago', day: 'numeric', month: 'long', year: 'numeric' });
    const bodyHtml = shell(
      `<h2 style="margin:0 0 12px;font-size:20px;color:#1f2937;">Hola ${data.clientName.split(' ')[0] || ''}, ${data.overdue ? 'tienes un pago vencido' : 'te recordamos tu próximo pago'}</h2>
       <p style="color:#374151;font-size:15px;"><strong>${data.serviceName}</strong> — cuota ${data.number}</p>
       ${data.description ? `<p style="color:#6b7280;font-size:14px;">${data.description}</p>` : ''}
       <p style="color:#374151;font-size:15px;">Monto: <strong>${amount}</strong><br/>Fecha de facturación: ${fmt(data.issueDate)}<br/>${data.overdue ? 'Venció' : 'Vence'} el <strong>${fmt(data.dueDate)}</strong></p>
       ${data.paymentUrl ? `<p style="margin:20px 0;"><a href="${data.paymentUrl}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">Pagar ${amount}</a></p>` : ''}
       <p style="color:#9ca3af;font-size:13px;">Si ya pagaste, puedes ignorar este mensaje.</p>`,
      companyName,
    );
    const subject = data.overdue ? `Pago vencido: ${data.serviceName} — ${companyName}` : `Recordatorio de pago: ${data.serviceName} — ${companyName}`;
    await this.deliver(companyId, 'RECURRING_CHARGE', transporter, { from, to, subject, html: bodyHtml });
  }

  /** Link de pago en línea (Flow / Mercado Pago) generado desde el punto de venta. */
  async sendPaymentLinkEmail(companyId: string, to: string, data: { amount: number; url: string; providerName: string; expiresAt: Date; customerName?: string | null }): Promise<void> {
    const transporter = await this.getTransporter(companyId);
    if (!transporter) throw new Error('Configura el servidor SMTP primero');

    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
    const companyName = company?.name ?? 'Tienda';
    const from = await this.getFromAddress(companyId);
    const amount = `$${Math.round(data.amount).toLocaleString('es-CL')}`;
    const expires = data.expiresAt.toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' });

    const bodyHtml = shell(
      `<h2 style="margin:0 0 12px;font-size:20px;color:#1f2937;">${data.customerName ? `Hola ${data.customerName}, ` : ''}tu link de pago</h2>
       <p style="color:#6b7280;font-size:15px;">${companyName} te envía el link para pagar tu compra con ${data.providerName}.</p>
       <p style="color:#374151;font-size:15px;">Total: <strong>${amount}</strong></p>
       <p style="margin:20px 0;"><a href="${data.url}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">Pagar ${amount}</a></p>
       <p style="color:#9ca3af;font-size:13px;">El link vence el ${expires}.</p>`,
      companyName,
    );

    await this.deliver(companyId, 'PAYMENT_LINK', transporter, { from, to, subject: `Link de pago ${amount} — ${companyName}`, html: bodyHtml });
    this.logger.log(`Link de pago enviado → ${to}`);
  }

  /**
   * Envía un pedido de dropshipping al proveedor para que despache al cliente final.
   * `to` es el correo del proveedor; el detalle incluye productos, cantidades y la
   * dirección de despacho del cliente.
   */
  async sendDropshipOrderEmail(companyId: string, to: string, order: any): Promise<void> {
    const transporter = await this.getTransporter(companyId);
    if (!transporter) throw new Error('Configura el servidor SMTP primero');

    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
    const companyName = company?.name ?? 'Tienda';
    const from = await this.getFromAddress(companyId);

    const shortId = order.id.slice(-8).toUpperCase();
    const sale = order.sale ?? {};
    const shipTo = [sale.address, sale.commune, sale.city].filter(Boolean).join(', ');

    const rows = (order.items ?? []).map((it: any) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#374151;">${it.productName} <span style="color:#9ca3af;">(${it.productSku})</span></td>
        <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#6b7280;text-align:center;">${it.quantity}</td>
      </tr>`).join('');

    const itemsTable = `<table width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0;">
      <thead><tr style="background:#f9fafb;">
        <th style="padding:8px 0;text-align:left;font-size:12px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Producto</th>
        <th style="padding:8px 0;text-align:center;font-size:12px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Cant.</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

    const shipBlock = shipTo
      ? `<div style="margin:16px 0;padding:14px 16px;background:#f9fafb;border-radius:8px;font-size:14px;color:#374151;">
          <strong>🏠 Despachar a</strong><br>
          <span style="color:#6b7280;">${sale.customerName ? sale.customerName + '<br>' : ''}${shipTo}</span>
        </div>`
      : '';

    const bodyHtml = shell(
      `<h2 style="margin:0 0 8px;font-size:20px;color:#1f2937;">Pedido de despacho #${shortId}</h2>
       <p style="margin:0 0 8px;color:#6b7280;font-size:15px;">${companyName} solicita el despacho directo de los siguientes productos al cliente final.</p>
       ${itemsTable}
       ${shipBlock}
       ${order.notes ? `<p style="margin:16px 0 0;color:#374151;font-size:14px;"><strong>Notas:</strong> ${order.notes}</p>` : ''}
       <p style="margin:20px 0 0;color:#9ca3af;font-size:13px;">Responde este correo con el número de seguimiento cuando lo despaches.</p>`,
      companyName,
      '#0f766e',
    );

    await this.deliver(companyId, 'DROPSHIP_ORDER', transporter, { from, to, subject: `Pedido de despacho #${shortId} — ${companyName}`, html: bodyHtml });
    this.logger.log(`Pedido dropship ${order.id} enviado → ${to}`);
  }
}

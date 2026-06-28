import { Injectable, Logger } from '@nestjs/common';
import { EmailType } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertEmailConfigDto, UpsertEmailTemplateDto } from './dto/email.dto';

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

const DEFAULT_TEMPLATES: Record<EmailType, { subject: string; body: string }> = {
  ORDER_CONFIRMED: {
    subject: 'Confirmación de pedido #{{orderId}} — {{companyName}}',
    body: `<h2 style="margin:0 0 8px;font-size:20px;color:#1f2937;">¡Tu pedido está confirmado! 🎉</h2>
<p style="margin:0 0 20px;color:#6b7280;font-size:15px;">Hola <strong>{{customerName}}</strong>, hemos recibido tu pedido correctamente.</p>
{{itemsTable}}
<table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border-top:2px solid #e5e7eb;padding-top:16px;">
  <tr>
    <td style="font-size:16px;font-weight:700;color:#1f2937;">Total</td>
    <td align="right" style="font-size:18px;font-weight:700;color:#1d4ed8;">{{total}}</td>
  </tr>
</table>
{{deliveryBlock}}
<p style="margin:24px 0 0;padding:16px;background:#eff6ff;border-radius:8px;color:#1e40af;font-size:14px;">
  Te avisaremos por correo en cada etapa de tu pedido.
</p>`,
  },
  ORDER_PREPARING: {
    subject: 'Estamos preparando tu pedido #{{orderId}} 📦',
    body: `<h2 style="margin:0 0 8px;font-size:20px;color:#1f2937;">Tu pedido está en preparación 📦</h2>
<p style="margin:0 0 20px;color:#6b7280;font-size:15px;">Hola <strong>{{customerName}}</strong>, nuestro equipo está preparando tu pedido con cuidado.</p>
{{itemsTable}}
{{deliveryBlock}}
<p style="margin:20px 0 0;color:#6b7280;font-size:14px;">Te notificaremos cuando esté listo.</p>`,
  },
  ORDER_READY_PICKUP: {
    subject: 'Tu pedido #{{orderId}} está listo para retiro 🏪',
    body: `<h2 style="margin:0 0 8px;font-size:20px;color:#1f2937;">¡Tu pedido está listo para retirar! 🏪</h2>
<p style="margin:0 0 20px;color:#6b7280;font-size:15px;">Hola <strong>{{customerName}}</strong>, tu pedido ya está empacado y esperándote.</p>
{{itemsTable}}
<div style="margin:20px 0;padding:20px;background:#f0fdf4;border-radius:8px;border-left:4px solid #22c55e;">
  <p style="margin:0 0 4px;font-weight:700;color:#166534;font-size:15px;">✅ Listo para retiro</p>
  <p style="margin:0;color:#15803d;font-size:14px;">Preséntate en nuestro local con tu número de pedido: <strong>#{{orderId}}</strong></p>
</div>
{{deliveryBlock}}`,
  },
  ORDER_OUT_FOR_DELIVERY: {
    subject: 'Tu pedido #{{orderId}} está en camino 🚚',
    body: `<h2 style="margin:0 0 8px;font-size:20px;color:#1f2937;">¡Tu pedido está en camino! 🚚</h2>
<p style="margin:0 0 20px;color:#6b7280;font-size:15px;">Hola <strong>{{customerName}}</strong>, tu pedido ha salido para entrega.</p>
<div style="margin:0 0 20px;padding:20px;background:#fffbeb;border-radius:8px;border-left:4px solid #f59e0b;">
  <p style="margin:0 0 4px;font-weight:700;color:#92400e;font-size:15px;">🚚 En camino</p>
  <p style="margin:0;color:#78350f;font-size:14px;">Nuestro despachador está en ruta hacia ti. Asegúrate de estar disponible en la dirección de entrega.</p>
</div>
{{itemsTable}}
{{deliveryBlock}}`,
  },
  ORDER_DELIVERED: {
    subject: 'Pedido #{{orderId}} entregado ✓',
    body: `<h2 style="margin:0 0 8px;font-size:20px;color:#1f2937;">¡Pedido entregado exitosamente! ✓</h2>
<p style="margin:0 0 20px;color:#6b7280;font-size:15px;">Hola <strong>{{customerName}}</strong>, tu pedido ha sido entregado correctamente.</p>
<div style="margin:0 0 20px;padding:20px;background:#f0fdf4;border-radius:8px;border-left:4px solid #22c55e;">
  <p style="margin:0;font-weight:700;color:#166534;font-size:15px;">✅ Entrega completada</p>
</div>
{{itemsTable}}
<p style="margin:20px 0 0;color:#6b7280;font-size:14px;">Gracias por tu compra. ¡Esperamos verte pronto!</p>`,
  },
  SALE_RECEIPT: {
    subject: 'Recibo de tu compra — {{companyName}}',
    body: `<h2 style="margin:0 0 8px;font-size:20px;color:#1f2937;">Recibo de compra 🧾</h2>
<p style="margin:0 0 4px;color:#6b7280;font-size:15px;">Hola <strong>{{customerName}}</strong>, gracias por tu compra.</p>
<p style="margin:0 0 20px;color:#9ca3af;font-size:13px;">Fecha: {{date}}</p>
{{itemsTable}}
<table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border-top:2px solid #e5e7eb;padding-top:16px;">
  <tr>
    <td style="font-size:16px;font-weight:700;color:#1f2937;">Total pagado</td>
    <td align="right" style="font-size:18px;font-weight:700;color:#1d4ed8;">{{total}}</td>
  </tr>
</table>
{{deliveryBlock}}
<p style="margin:20px 0 0;color:#6b7280;font-size:14px;">Guarda este correo como comprobante de tu compra. ¡Gracias por elegirnos!</p>`,
  },
};

function buildItemsTable(items: { name: string; qty: number; unitPrice: number }[]): string {
  const rows = items.map(i => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#374151;">${i.name}</td>
      <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#6b7280;text-align:center;">${i.qty}</td>
      <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#374151;text-align:right;">$${(i.qty * i.unitPrice).toLocaleString('es-CL')}</td>
    </tr>`).join('');

  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
  <thead>
    <tr style="background:#f9fafb;">
      <th style="padding:8px 0;text-align:left;font-size:12px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Producto</th>
      <th style="padding:8px 0;text-align:center;font-size:12px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Cant.</th>
      <th style="padding:8px 0;text-align:right;font-size:12px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Subtotal</th>
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

  constructor(private prisma: PrismaService) {}

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
    return (Object.keys(DEFAULT_TEMPLATES) as EmailType[]).map(type => ({
      type, label: TYPE_LABELS[type],
    }));
  }

  async getTemplates(companyId: string | null) {
    const dbTemplates = await this.prisma.emailTemplate.findMany({
      where: { companyId: companyId ?? null },
    });

    return (Object.keys(DEFAULT_TEMPLATES) as EmailType[]).map(type => {
      const db = dbTemplates.find(t => t.type === type);
      const def = DEFAULT_TEMPLATES[type];
      return {
        type,
        label: TYPE_LABELS[type],
        subject: db?.subject ?? def.subject,
        bodyHtml: db?.bodyHtml ?? def.body,
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
    const data = {
      subject: dto.subject,
      bodyHtml: dto.bodyHtml,
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
    // Hardcoded default
    const def = DEFAULT_TEMPLATES[type];
    return def ? { subject: def.subject, bodyHtml: def.body } : null;
  }

  private async getTransporter(companyId: string): Promise<nodemailer.Transporter | null> {
    const cfg = await this.prisma.emailConfig.findUnique({ where: { companyId, active: true } });
    if (!cfg) return null;
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
      itemsTable,
      deliveryBlock,
    };

    const subject = renderTemplate(template.subject, vars);
    const innerHtml = renderTemplate(template.bodyHtml, vars);
    const bodyHtml = shell(innerHtml, companyName);

    const from = await this.getFromAddress(order.companyId);

    try {
      await transporter.sendMail({ from, to: order.customerEmail, subject, html: bodyHtml });
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
      itemsTable,
      deliveryBlock,
    };

    const subject = renderTemplate(template.subject, vars);
    const innerHtml = renderTemplate(template.bodyHtml, vars);
    const bodyHtml = shell(innerHtml, companyName);

    const from = await this.getFromAddress(sale.companyId);

    try {
      await transporter.sendMail({ from, to: sale.customerEmail, subject, html: bodyHtml });
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

    await transporter.sendMail({
      from, to,
      subject: `Prueba de correo — ${companyName}`,
      html: bodyHtml,
    });
  }
}

import { EmailType } from '@prisma/client';

// Editor de correos por bloques (Ajustes → Correos). Cada correo de cliente se guarda como una
// lista de bloques y el sistema arma el HTML: el usuario nunca edita código y el correo no se
// rompe. Los textos aceptan variables {{nombre}} y **negrita**.

export type EmailBlock =
  | { type: 'title'; text: string }
  | { type: 'text'; text: string }
  | { type: 'note'; text: string; tone?: 'info' | 'success' | 'warning' }
  | { type: 'items' }
  | { type: 'total' }
  | { type: 'delivery' }
  | { type: 'button'; label: string; url: string }
  | { type: 'image'; url: string; alt?: string }
  | { type: 'divider' };

export const BLOCK_TYPES = ['title', 'text', 'note', 'items', 'total', 'delivery', 'button', 'image', 'divider'] as const;

// Identidad de la empresa en todos sus correos.
export interface EmailBrand {
  color: string;
  logoUrl: string | null;
  showLogo: boolean;
  footerText: string | null;
  contact: string | null;
}

export const DEFAULT_BRAND_COLOR = '#1d4ed8';

// Variables disponibles en los correos de clientes (clave → nombre legible y ejemplo).
export const EMAIL_VARIABLES: Record<string, { label: string; sample: string }> = {
  customerName: { label: 'Nombre del cliente', sample: 'Ana Pérez' },
  orderId: { label: 'N° de pedido', sample: 'A1B2C3D4' },
  companyName: { label: 'Nombre de la tienda', sample: 'Mi Tienda' },
  total: { label: 'Total', sample: '$59.980' },
  address: { label: 'Dirección de entrega', sample: 'Av. Siempre Viva 742, Providencia' },
  date: { label: 'Fecha', sample: new Date().toLocaleDateString('es-CL') },
};

export const DEFAULT_BLOCKS: Record<EmailType, { subject: string; blocks: EmailBlock[] }> = {
  ORDER_CONFIRMED: {
    subject: 'Confirmación de pedido #{{orderId}} — {{companyName}}',
    blocks: [
      { type: 'title', text: '¡Gracias por tu compra!' },
      { type: 'text', text: 'Hola **{{customerName}}**, hemos recibido tu pedido correctamente.' },
      { type: 'items' }, { type: 'total' }, { type: 'delivery' },
      { type: 'text', text: 'Te avisaremos cuando tu pedido avance.' },
    ],
  },
  ORDER_PREPARING: {
    subject: 'Estamos preparando tu pedido #{{orderId}} 📦',
    blocks: [
      { type: 'title', text: 'Estamos preparando tu pedido' },
      { type: 'text', text: 'Hola **{{customerName}}**, nuestro equipo está preparando tu pedido con cuidado.' },
      { type: 'items' }, { type: 'delivery' },
    ],
  },
  ORDER_READY_PICKUP: {
    subject: 'Tu pedido #{{orderId}} está listo para retiro 🏪',
    blocks: [
      { type: 'title', text: '¡Tu pedido está listo para retiro!' },
      { type: 'text', text: 'Hola **{{customerName}}**, tu pedido ya está empacado y esperándote.' },
      { type: 'items' },
      { type: 'note', tone: 'success', text: 'Preséntate en nuestro local con tu número de pedido: **#{{orderId}}**' },
    ],
  },
  ORDER_OUT_FOR_DELIVERY: {
    subject: 'Tu pedido #{{orderId}} está en camino 🚚',
    blocks: [
      { type: 'title', text: 'Tu pedido va en camino' },
      { type: 'text', text: 'Hola **{{customerName}}**, tu pedido ha salido para entrega.' },
      { type: 'note', tone: 'info', text: 'Pronto llegará a tu dirección. Mantente atento.' },
      { type: 'items' }, { type: 'delivery' },
    ],
  },
  ORDER_DELIVERED: {
    subject: 'Pedido #{{orderId}} entregado ✓',
    blocks: [
      { type: 'title', text: '¡Pedido entregado!' },
      { type: 'text', text: 'Hola **{{customerName}}**, tu pedido ha sido entregado correctamente.' },
      { type: 'note', tone: 'success', text: 'Esperamos que disfrutes tu compra. ¡Gracias por preferirnos!' },
      { type: 'items' },
    ],
  },
  SALE_RECEIPT: {
    subject: 'Recibo de tu compra — {{companyName}}',
    blocks: [
      { type: 'title', text: 'Recibo de compra' },
      { type: 'text', text: 'Hola **{{customerName}}**, gracias por tu compra.' },
      { type: 'items' }, { type: 'total' }, { type: 'delivery' },
    ],
  },
};

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Texto del usuario → HTML seguro: escapa, aplica **negrita**, saltos de línea y variables.
function richText(text: string, vars: Record<string, string>) {
  const withVars = String(text ?? '').replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? `\u0000${k}\u0001` : m));
  let html = esc(withVars)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
  html = html.replace(/\u0000(\w+)\u0001/g, (_m, k) => esc(vars[k] ?? ''));
  return html;
}

const safeUrl = (u: string) => (/^https?:\/\//i.test(String(u || '').trim()) ? esc(String(u).trim()) : '');
const safeColor = (c: string | null | undefined) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? String(c) : DEFAULT_BRAND_COLOR);

/** Limpia los bloques que llegan del editor (tipos conocidos, textos acotados, URLs http/https). */
export function sanitizeBlocks(raw: unknown): EmailBlock[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: EmailBlock[] = [];
  for (const b of list.slice(0, 40)) {
    const t = String((b as any)?.type || '');
    const text = String((b as any)?.text ?? '').slice(0, 3000);
    switch (t) {
      case 'title': out.push({ type: 'title', text: text.slice(0, 200) }); break;
      case 'text': out.push({ type: 'text', text }); break;
      case 'note': {
        const tone = ['info', 'success', 'warning'].includes((b as any)?.tone) ? (b as any).tone : 'info';
        out.push({ type: 'note', text, tone });
        break;
      }
      case 'items': case 'total': case 'delivery': case 'divider': out.push({ type: t } as EmailBlock); break;
      case 'button': out.push({ type: 'button', label: String((b as any)?.label || '').slice(0, 60), url: String((b as any)?.url || '').slice(0, 500) }); break;
      case 'image': out.push({ type: 'image', url: String((b as any)?.url || '').slice(0, 800), alt: String((b as any)?.alt || '').slice(0, 120) }); break;
    }
  }
  return out;
}

const NOTE_TONE: Record<string, { bg: string; border: string; color: string }> = {
  info: { bg: '#eff6ff', border: '#bfdbfe', color: '#1e40af' },
  success: { bg: '#f0fdf4', border: '#bbf7d0', color: '#15803d' },
  warning: { bg: '#fffbeb', border: '#fde68a', color: '#92400e' },
};

/**
 * Arma el contenido del correo. `parts` trae los bloques del sistema ya armados (tabla de
 * productos, total, entrega); si un correo no los tiene (p. ej. sin dirección), se omiten.
 */
export function renderBlocks(blocks: EmailBlock[], vars: Record<string, string>, parts: { items: string; total: string; delivery: string }, brand: EmailBrand) {
  const color = safeColor(brand.color);
  return blocks.map((b) => {
    switch (b.type) {
      case 'title':
        return `<h2 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#111827;">${richText(b.text, vars)}</h2>`;
      case 'text':
        return `<p style="margin:0 0 16px;color:#4b5563;font-size:15px;line-height:1.6;">${richText(b.text, vars)}</p>`;
      case 'note': {
        const t = NOTE_TONE[b.tone || 'info'];
        return `<div style="margin:16px 0;padding:14px 16px;background:${t.bg};border:1px solid ${t.border};border-radius:8px;color:${t.color};font-size:14px;line-height:1.5;">${richText(b.text, vars)}</div>`;
      }
      case 'items':
        return parts.items;
      case 'total':
        return parts.total
          ? `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:8px 0 16px;border-top:2px solid #e5e7eb;"><tr><td style="padding-top:10px;font-size:15px;font-weight:700;color:#111827;">Total</td><td align="right" style="padding-top:10px;font-size:18px;font-weight:700;color:${color};">${esc(parts.total)}</td></tr></table>`
          : '';
      case 'delivery':
        return parts.delivery;
      case 'button': {
        const url = safeUrl(b.url);
        if (!url || !b.label) return '';
        return `<p style="margin:20px 0;text-align:center;"><a href="${url}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:15px;">${esc(b.label)}</a></p>`;
      }
      case 'image': {
        const url = safeUrl(b.url);
        return url ? `<p style="margin:16px 0;text-align:center;"><img src="${url}" alt="${esc(b.alt || '')}" style="max-width:100%;height:auto;border-radius:8px;"></p>` : '';
      }
      case 'divider':
        return '<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">';
      default:
        return '';
    }
  }).join('\n');
}

/** Marco de todos los correos de la empresa, con su logo, color y pie. */
export function brandedShell(content: string, companyName: string, brand?: EmailBrand | null) {
  const color = safeColor(brand?.color);
  const logo = brand?.showLogo && brand.logoUrl && /^https?:\/\//i.test(brand.logoUrl) ? brand.logoUrl : null;
  const header = logo
    ? `<img src="${esc(logo)}" alt="${esc(companyName)}" style="max-height:56px;max-width:220px;display:block;">`
    : `<p style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${esc(companyName)}</p>`;
  const headerBg = logo ? '#ffffff' : color;
  const footer = [brand?.footerText ? esc(brand.footerText).replace(/\n/g, '<br>') : '', brand?.contact ? esc(brand.contact) : '']
    .filter(Boolean).join('<br>') || `© ${esc(companyName)} · Correo generado automáticamente`;
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(companyName)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f3f4f6;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
  <tr><td style="background:${headerBg};padding:24px 32px;${logo ? `border-bottom:4px solid ${color};` : ''}">${header}</td></tr>
  <tr><td style="padding:32px 32px 24px;">
    ${content}
  </td></tr>
  <tr><td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;text-align:center;">
    <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">${footer}</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

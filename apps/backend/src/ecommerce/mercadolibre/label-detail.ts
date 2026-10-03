import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { readFile } from 'fs/promises';
import { basename, join } from 'path';

// "Etiqueta con detalle": a continuación de la etiqueta de Mercado Envíos de cada orden se
// agrega una página del MISMO tamaño (sirve en impresoras térmicas 10x15) con lo que hay que
// meter en el paquete: número de orden, comprador, envío y cada producto con su foto, nombre,
// SKU y cantidad.

export interface LabelDetailItem {
  name: string;
  sku: string;
  quantity: number;
  imageUrl: string | null;
}

export interface LabelDetailOrder {
  orderNumber: string;
  packId?: string | null;
  storeName?: string | null;
  customerName?: string | null;
  commune?: string | null;
  courier?: string | null;
  trackingCode?: string | null;
  notes?: string | null;
  items: LabelDetailItem[];
}

const DEFAULT_SIZE: [number, number] = [283.46, 425.2]; // 10 x 15 cm

// Las fuentes estándar de PDF solo codifican Latin-1 (WinAnsi): se reemplaza lo demás
// (emojis, comillas tipográficas, "×"...) para que nunca falle el armado del PDF.
function safe(text: string | null | undefined): string {
  return String(text ?? '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
    .replace(/×/g, 'x').replace(/…/g, '...')
    .replace(/[^\x20-\x7E -ÿ]/g, '')
    .replace(/\s+/g, ' ').trim();
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number, maxLines: number): string[] {
  const words = safe(text).split(' ').filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) { line = next; continue; }
    if (line) lines.push(line);
    line = w;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    let last = lines[maxLines - 1];
    while (last.length > 1 && font.widthOfTextAtSize(`${last}...`, size) > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}...`;
  }
  return lines;
}

// Foto del producto: subida al panel (/api/uploads/archivo, se lee del disco) o URL externa
// (Mercado Libre, JumpSeller...). Solo JPG/PNG — otro formato o un error = sin foto.
async function loadImage(doc: PDFDocument, url: string | null, cache: Map<string, PDFImage | null>): Promise<PDFImage | null> {
  if (!url) return null;
  if (cache.has(url)) return cache.get(url)!;
  let image: PDFImage | null = null;
  try {
    let bytes: Uint8Array;
    if (/^https?:\/\//i.test(url)) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bytes = new Uint8Array(await res.arrayBuffer());
    } else {
      const dir = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
      bytes = new Uint8Array(await readFile(join(dir, basename(url.split('?')[0]))));
    }
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    image = isPng ? await doc.embedPng(bytes) : isJpg ? await doc.embedJpg(bytes) : null;
  } catch {
    image = null;
  }
  cache.set(url, image);
  return image;
}

async function drawDetailPages(
  doc: PDFDocument, size: [number, number], order: LabelDetailOrder,
  fonts: { regular: PDFFont; bold: PDFFont }, cache: Map<string, PDFImage | null>,
) {
  const [width, height] = size;
  const margin = Math.max(10, width * 0.04);
  const scale = width / DEFAULT_SIZE[0]; // textos proporcionales al tamaño de la etiqueta
  const fs = (n: number) => n * Math.min(1.6, Math.max(0.8, scale));
  const inner = width - margin * 2;
  const thumb = fs(38);
  const rowGap = fs(6);
  const totalUnits = order.items.reduce((s, i) => s + i.quantity, 0);

  let page: PDFPage = doc.addPage(size);
  let y = height - margin;
  let pageNo = 1;

  const header = (continued: boolean) => {
    page.drawText(safe(continued ? 'DETALLE DEL PEDIDO (cont.)' : 'DETALLE DEL PEDIDO'), { x: margin, y: y - fs(11), size: fs(11), font: fonts.bold });
    y -= fs(16);
    page.drawText(safe(`Orden #${order.orderNumber}`), { x: margin, y: y - fs(9), size: fs(9), font: fonts.bold });
    y -= fs(12);
    if (continued) return;
    const lines = [
      order.packId ? `Pack ${order.packId}` : null,
      order.storeName ? `Tienda: ${order.storeName}` : null,
      [order.customerName, order.commune].filter(Boolean).join(' - ') || null,
      [order.courier, order.trackingCode && `Seguimiento ${order.trackingCode}`].filter(Boolean).join(' - ') || null,
    ].filter(Boolean) as string[];
    for (const l of lines) {
      for (const w of wrap(l, fonts.regular, fs(7.5), inner, 2)) {
        page.drawText(w, { x: margin, y: y - fs(7.5), size: fs(7.5), font: fonts.regular, color: rgb(0.2, 0.2, 0.2) });
        y -= fs(10);
      }
    }
    y -= fs(3);
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: rgb(0, 0, 0) });
    y -= fs(6);
  };
  header(false);

  for (const item of order.items) {
    const nameLines = wrap(item.name, fonts.regular, fs(8), inner - thumb - fs(44), 3);
    const rowHeight = Math.max(thumb, nameLines.length * fs(10) + fs(11));
    if (y - rowHeight < margin + fs(28)) {
      page.drawText(safe('Continúa en la página siguiente'), { x: margin, y: margin, size: fs(7), font: fonts.regular, color: rgb(0.4, 0.4, 0.4) });
      page = doc.addPage(size);
      y = height - margin;
      pageNo++;
      header(true);
    }
    const top = y;
    const image = await loadImage(doc, item.imageUrl, cache);
    if (image) {
      const s = Math.min(thumb / image.width, thumb / image.height);
      const w = image.width * s, h = image.height * s;
      page.drawImage(image, { x: margin + (thumb - w) / 2, y: top - thumb + (thumb - h) / 2, width: w, height: h });
    }
    page.drawRectangle({ x: margin, y: top - thumb, width: thumb, height: thumb, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.5 });

    const textX = margin + thumb + fs(6);
    let ty = top;
    for (const l of nameLines) {
      page.drawText(l, { x: textX, y: ty - fs(8), size: fs(8), font: fonts.regular });
      ty -= fs(10);
    }
    page.drawText(safe(/^sku/i.test(item.sku) ? item.sku : `SKU ${item.sku}`), { x: textX, y: ty - fs(7), size: fs(7), font: fonts.regular, color: rgb(0.35, 0.35, 0.35) });

    const qty = `x${item.quantity}`;
    const qSize = fs(item.quantity > 1 ? 16 : 13);
    const qWidth = fonts.bold.widthOfTextAtSize(qty, qSize);
    if (item.quantity > 1) {
      page.drawRectangle({ x: width - margin - qWidth - fs(6), y: top - qSize - fs(5), width: qWidth + fs(6), height: qSize + fs(5), color: rgb(0, 0, 0) });
      page.drawText(qty, { x: width - margin - qWidth - fs(3), y: top - qSize - fs(1), size: qSize, font: fonts.bold, color: rgb(1, 1, 1) });
    } else {
      page.drawText(qty, { x: width - margin - qWidth, y: top - qSize, size: qSize, font: fonts.bold });
    }

    y = top - rowHeight - rowGap;
    page.drawLine({ start: { x: margin, y: y + rowGap / 2 }, end: { x: width - margin, y: y + rowGap / 2 }, thickness: 0.3, color: rgb(0.75, 0.75, 0.75) });
  }

  const footer = `${order.items.length} producto(s) - ${totalUnits} unidad(es)`;
  page.drawText(safe(footer), { x: margin, y: Math.max(margin, y - fs(12)), size: fs(9), font: fonts.bold });
  if (order.notes) {
    const noteLines = wrap(`Nota: ${order.notes}`, fonts.regular, fs(7), inner, 3);
    let ny = Math.max(margin, y - fs(24));
    for (const l of noteLines) {
      if (ny < margin) break;
      page.drawText(l, { x: margin, y: ny, size: fs(7), font: fonts.regular, color: rgb(0.3, 0.3, 0.3) });
      ny -= fs(9);
    }
  }
  void pageNo;
}

// Une, en orden, la etiqueta de cada orden seguida (si se pide) de su página de detalle.
export async function buildLabelsPdf(entries: { label: Buffer; detail?: LabelDetailOrder | null }[]): Promise<Buffer> {
  const out = await PDFDocument.create();
  const fonts = {
    regular: await out.embedFont(StandardFonts.Helvetica),
    bold: await out.embedFont(StandardFonts.HelveticaBold),
  };
  const cache = new Map<string, PDFImage | null>();

  for (const entry of entries) {
    const src = await PDFDocument.load(entry.label, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
    if (entry.detail) {
      const first = pages[0];
      const size: [number, number] = first ? [first.getWidth(), first.getHeight()] : DEFAULT_SIZE;
      await drawDetailPages(out, size, entry.detail, fonts, cache);
    }
  }
  return Buffer.from(await out.save());
}

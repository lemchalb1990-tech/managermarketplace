import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SaleChannel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { PlatformAdapter, SyncPayload, PublishResult } from './platform.interface';
import { getEffectivePrice } from '../../common/effective-price.util';
import { toAbsoluteUrl } from '../../common/absolute-url.util';

// Ripley Marketplace corre sobre la plataforma Mirakl (mismo motor que usan varios
// retailers). Doc: https://documenter.getpostman.com/view/206599/api-mercado-ripley/6n4UtAt
// Probado en vivo contra la cuenta real del seller "Habita2 Chile" (misma cuenta de prueba
// que Paris). La API Key NO es la contraseña del Seller Center — se obtiene ya logueado en
// http://ripley-prod.mirakl.net, arriba a la derecha en el email > "Mis ajustes de usuario"
// > "API key". El header de autenticación es el API key crudo, sin "Bearer".
const BASE = 'https://ripley-prod.mirakl.net';
const OFFERS_PAGE_SIZE = 25;
// Código de estado del producto que ya se ve en las ofertas reales de esta cuenta y en el
// ejemplo de la doc para OF24 — Mirakl no documentó qué otros valores existen.
const DEFAULT_STATE_CODE = '11';

export interface RipleyCategory { code: string; label: string; parentCode: string; level: number }

// Lo que guardamos en Listing.channelAttributes para un producto publicado/en borrador en
// Ripley — mucho más simple que Paris porque Mirakl no expone (via esta API) un esquema de
// atributos obligatorios por categoría, solo el árbol de categorías (H11).
export interface RipleyChannelAttributes {
  categoryCode: string;
  categoryLabel?: string;
  brand?: string;
}

export interface RipleyImportItem {
  externalId: string; // = shop_sku
  title: string;
  sku: string | null; // = shop_sku también, Ripley no separa un "sellerSku" del shop_sku
  skuSuspicious: boolean;
  matchedProductId: string | null;
  matchedProductName: string | null;
}

export interface RipleyImportPreview {
  connectionName: string;
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
  alreadyImportedCount: number;
  items: RipleyImportItem[];
}

function csvEscape(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

@Injectable()
export class RipleyAdapter implements PlatformAdapter {
  private readonly logger = new Logger(RipleyAdapter.name);

  constructor(private prisma: PrismaService, private settings: SettingsService) {}

  private creds(conn: any): any {
    return (conn.credentials as any) || {};
  }

  private async request(conn: any, path: string, init: RequestInit = {}): Promise<any> {
    const apiKey = this.creds(conn).apiKey;
    if (!apiKey) throw new Error('Falta la API Key de Ripley');
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...(init.headers || {}), Authorization: apiKey },
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      throw new Error(data?.message || `Ripley respondió HTTP ${res.status} en ${path}`);
    }
    return data;
  }

  async testConnection(conn: any): Promise<{ success: boolean; message?: string }> {
    try {
      const data = await this.request(conn, '/api/account');
      const name = data.pro_details?.corporate_name || data.contact_informations?.email || 'seller';
      return { success: true, message: `Conectado como ${name}` };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  async getHierarchies(conn: any): Promise<RipleyCategory[]> {
    const data = await this.request(conn, '/api/hierarchies');
    return (data.hierarchies || []).map((h: any) => ({
      code: h.code, label: h.label, parentCode: h.parent_code || '', level: h.level,
    }));
  }

  private async getListingWithImages(productId: string, connectionId: string) {
    return this.prisma.listing.findUnique({
      where: { productId_connectionId: { productId, connectionId } },
      include: { images: { orderBy: { order: 'asc' } } },
    });
  }

  // ─── Publicación ───────────────────────────────────────────────────────────
  // Ripley/Mirakl no tiene un endpoint de creación de producto en JSON como Paris — se hace
  // por un archivo CSV (';' como separador) subido a OF01, que es asíncrono (devuelve un
  // import_id, hay que consultar OF02 para saber si terminó bien). Cada categoría puede
  // exigir columnas propias además de las base (ej. "talla_zapatos" para zapatos) que esta
  // API no expone en ningún endpoint de solo lectura — si la categoría elegida las exige y
  // no se mandan, Ripley va a rechazar la fila; el detalle del error queda en OF03.
  async publishProduct(conn: any, product: any): Promise<PublishResult> {
    const listing = await this.getListingWithImages(product.id, conn.id);
    if (!listing?.title?.trim()) {
      throw new BadRequestException('Falta el título de la publicación de Ripley (pestaña "Ripley" del producto)');
    }
    const attrs = (listing.channelAttributes as unknown as RipleyChannelAttributes) || null;
    if (!attrs?.categoryCode) {
      throw new BadRequestException('Falta elegir la categoría de Ripley (pestaña "Ripley" del producto)');
    }

    const listingImages = listing.images.length
      ? listing.images
      : await this.prisma.productImage.findMany({ where: { productId: product.id }, orderBy: { order: 'asc' } });
    if (!listingImages.length) {
      throw new BadRequestException('Ripley exige al menos una foto (pestaña "Fotos Ripley" o "Imágenes" del producto)');
    }
    const imageUrls = await Promise.all(listingImages.slice(0, 3).map((img: any) => toAbsoluteUrl(this.settings, img.url)));

    const price = await getEffectivePrice(this.prisma, product.id, conn.id, Number(product.price));
    const shopSku = product.sku;

    const header = [
      'categorias', 'sku', 'Titulo', 'Descripcion', 'Marca',
      'imagen1', 'thumbnail', 'imagen2', 'imagen3',
      'variant_id', 'price', 'quantity',
      'discount-price', 'discount-start-date', 'discount-end-date', 'leadtime-to-ship',
      'product-id', 'product-id-type', 'state', 'update-delete',
    ];
    const row = [
      attrs.categoryCode, shopSku, listing.title, listing.description || product.description || listing.title,
      attrs.brand || '', imageUrls[0] || '', imageUrls[0] || '', imageUrls[1] || '', imageUrls[2] || '',
      '', Math.round(price), Math.max(0, Math.round(Number(product.stock ?? 0))),
      '', '', '', 1,
      shopSku, 'SHOP_SKU', DEFAULT_STATE_CODE, 'update',
    ];
    const csv = `${header.map(csvEscape).join(';')}\n${row.map(csvEscape).join(';')}\n`;

    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'producto.csv');
    form.append('import_mode', 'NORMAL');
    form.append('with_products', 'true');

    const apiKey = this.creds(conn).apiKey;
    const res = await fetch(`${BASE}/api/offers/imports`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: apiKey },
      body: form,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message || `Ripley respondió HTTP ${res.status} al importar`);

    // OF01 es async — se espera un poco y se revisa OF02 para dar feedback inmediato si se
    // puede, pero no se bloquea la respuesta si Ripley todavía no terminó de procesar.
    if (data.import_id) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const status = await this.request(conn, `/api/offers/imports/${data.import_id}`);
        if (status.lines_in_error > 0) {
          throw new BadRequestException(
            `Ripley rechazó la publicación (revisa que la categoría no exija atributos adicionales no soportados aún): import_id=${data.import_id}`,
          );
        }
      } catch (err: any) {
        if (err instanceof BadRequestException) throw err;
        this.logger.warn(`Ripley publish: no se pudo confirmar el status de import_id=${data.import_id} — ${err.message}`);
      }
    }

    return { externalId: shopSku };
  }

  async syncListing(conn: any, externalId: string, payload: SyncPayload): Promise<void> {
    const body = {
      offers: [{
        product_id: externalId,
        product_id_type: 'SHOP_SKU',
        shop_sku: externalId,
        price: Math.round(payload.price ?? 0) || undefined,
        quantity: Math.max(0, Math.round(payload.stock)),
        state_code: DEFAULT_STATE_CODE,
        update_delete: 'update',
      }],
    };
    await this.request(conn, '/api/offers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    this.logger.log(`Ripley sync: shop_sku=${externalId} stock=${payload.stock}${payload.price != null ? ` price=${Math.round(payload.price)}` : ''}`);
  }

  // ─── Guardar campos/fotos de la publicación antes de publicar (borrador) ─────

  async upsertListingFields(
    productId: string,
    connectionId: string,
    dto: { title?: string; description?: string; channelAttributes?: RipleyChannelAttributes },
  ) {
    return this.prisma.listing.upsert({
      where: { productId_connectionId: { productId, connectionId } },
      update: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.channelAttributes !== undefined ? { channelAttributes: dto.channelAttributes as any } : {}),
      },
      create: {
        productId, connectionId,
        title: dto.title, description: dto.description, channelAttributes: dto.channelAttributes as any,
      },
      include: { images: { orderBy: { order: 'asc' } } },
    });
  }

  async addListingImage(productId: string, connectionId: string, filename: string, url: string) {
    const listing = await this.prisma.listing.upsert({
      where: { productId_connectionId: { productId, connectionId } },
      update: {},
      create: { productId, connectionId },
    });
    const count = await this.prisma.listingImage.count({ where: { listingId: listing.id } });
    return this.prisma.listingImage.create({ data: { listingId: listing.id, filename, url, order: count } });
  }

  async removeListingImage(listingId: string, imageId: string) {
    return this.prisma.listingImage.deleteMany({ where: { id: imageId, listingId } });
  }

  // ─── Importar catálogo existente desde Ripley ────────────────────────────────
  // Mucho más simple que Paris: GET /api/offers ya trae título/descripción/marca/precio/
  // stock/categoría en un solo llamado, sin fetch de detalle por ítem. OJO: esta API no
  // expone fotos del producto en ningún endpoint de lectura probado — los productos
  // importados quedan sin fotos, hay que subirlas a mano después.

  async previewImport(conn: any, companyId: string, offset = 0): Promise<RipleyImportPreview> {
    const data = await this.request(conn, `/api/offers?max=${OFFERS_PAGE_SIZE}&offset=${offset}`);
    const results: any[] = data.offers || [];
    const total: number = data.total_count ?? 0;
    const hasMore = offset + results.length < total;

    const skus = results.map((r) => r.shop_sku).filter(Boolean);
    const skuCounts = new Map<string, number>();
    for (const sku of skus) skuCounts.set(sku, (skuCounts.get(sku) || 0) + 1);

    const [existingProducts, existingListings] = await Promise.all([
      this.prisma.product.findMany({ where: { companyId, sku: { in: skus } }, select: { id: true, sku: true, name: true } }),
      this.prisma.listing.findMany({ where: { connectionId: conn.id }, select: { externalId: true } }),
    ]);
    const productBySku = new Map(existingProducts.map((p) => [p.sku, p]));
    const linkedIds = new Set(existingListings.map((l) => l.externalId).filter(Boolean));

    const items: RipleyImportItem[] = results
      .filter((r) => !linkedIds.has(r.shop_sku))
      .map((r) => {
        const sku: string | null = r.shop_sku || null;
        const skuSuspicious = !!sku && (skuCounts.get(sku) || 0) > 1;
        const matched = sku ? productBySku.get(sku) : undefined;
        return {
          externalId: r.shop_sku, title: r.product_title, sku, skuSuspicious,
          matchedProductId: matched?.id || null, matchedProductName: matched?.name || null,
        };
      });

    return {
      connectionName: conn.name, total, hasMore,
      nextOffset: hasMore ? offset + OFFERS_PAGE_SIZE : null,
      alreadyImportedCount: results.length - items.length,
      items,
    };
  }

  private async nextSku(companyId: string): Promise<string> {
    let n = (await this.prisma.product.count({ where: { companyId } })) + 1;
    let sku = `SKU-${String(n).padStart(6, '0')}`;
    while (await this.prisma.product.findUnique({ where: { sku_companyId: { sku, companyId } } })) {
      n++;
      sku = `SKU-${String(n).padStart(6, '0')}`;
    }
    return sku;
  }

  async confirmImport(conn: any, companyId: string, externalIds: string[], unlinkIds: string[] = []) {
    const unlinkSet = new Set(unlinkIds);
    let imported = 0, linked = 0, skipped = 0;
    const errors: string[] = [];

    const data = await this.request(conn, `/api/offers?max=${externalIds.length}&shop_sku=${externalIds.join(',')}`)
      .catch(async () => {
        // Si el filtro por lista de shop_sku no es soportado, se trae una por una.
        const all = await Promise.all(externalIds.map((id) =>
          this.request(conn, `/api/offers?shop_sku=${encodeURIComponent(id)}`).catch(() => null),
        ));
        return { offers: all.flatMap((d: any) => d?.offers || []) };
      });
    const offers: any[] = data.offers || [];

    const skuCountsInBatch = new Map<string, number>();
    for (const o of offers) if (o.shop_sku) skuCountsInBatch.set(o.shop_sku, (skuCountsInBatch.get(o.shop_sku) || 0) + 1);

    const preexistingListings = await this.prisma.listing.findMany({
      where: { connectionId: conn.id }, select: { productId: true, externalId: true },
    });
    const linkedProductIds = new Set(preexistingListings.map((l) => l.productId));
    const linkedIds = new Set(preexistingListings.map((l) => l.externalId).filter(Boolean));

    for (const offer of offers) {
      try {
        if (linkedIds.has(offer.shop_sku)) { skipped++; continue; }
        const matchedSku = offer.shop_sku as string | undefined;
        const skuSuspicious = !!matchedSku && (skuCountsInBatch.get(matchedSku) || 0) > 1;
        const forceNew = unlinkSet.has(offer.shop_sku) || skuSuspicious;
        const sku = (!forceNew && matchedSku) || (await this.nextSku(companyId));

        let product = forceNew ? null : await this.prisma.product.findUnique({ where: { sku_companyId: { sku, companyId } } });
        if (product && linkedProductIds.has(product.id)) { skipped++; continue; }

        if (!product) {
          product = await this.prisma.product.create({
            data: {
              sku, name: offer.product_title || sku, description: offer.product_description || undefined,
              price: Number(offer.price) || 0, stock: Math.max(0, Math.round(Number(offer.quantity) || 0)),
              category: offer.category_label, companyId,
            },
          });
          imported++;
        } else {
          linked++;
        }
        linkedProductIds.add(product.id);
        linkedIds.add(offer.shop_sku);

        await this.prisma.listing.upsert({
          where: { productId_connectionId: { productId: product.id, connectionId: conn.id } },
          update: {
            externalId: offer.shop_sku, status: 'ACTIVE' as any, syncedAt: new Date(),
            title: offer.product_title, description: offer.product_description || undefined,
            channelAttributes: { categoryCode: offer.category_code, categoryLabel: offer.category_label, brand: offer.product_brand } as any,
          },
          create: {
            productId: product.id, connectionId: conn.id,
            externalId: offer.shop_sku, status: 'ACTIVE' as any, syncedAt: new Date(),
            title: offer.product_title, description: offer.product_description || undefined,
            channelAttributes: { categoryCode: offer.category_code, categoryLabel: offer.category_label, brand: offer.product_brand } as any,
          },
        });
      } catch (err: any) {
        errors.push(`${offer.shop_sku}: ${err.message}`);
      }
    }

    return { imported, linked, skipped, errors };
  }

  // ─── Importar ventas (órdenes Mirakl) ────────────────────────────────────────
  // Mismo alcance que Paris: crea Sale/SaleItem para historial/reportes, no descuenta
  // stock. Mirakl SÍ trae "quantity" por línea (a diferencia de Paris) y offer_sku ES
  // directamente nuestro Listing.externalId (sin prefijo compuesto), así que el match es
  // más simple: comparación exacta, no "termina en".

  private async resolveOrderLines(connectionId: string, orderLines: any[]) {
    let resolved = true;
    const out: Array<{ productId: string | null; quantity: number; unitPrice: number; title: string; productName: string | null }> = [];
    for (const line of orderLines || []) {
      const sku = line.offer_sku;
      const listing = sku ? await this.prisma.listing.findFirst({
        where: { connectionId, externalId: sku },
        select: { productId: true, product: { select: { name: true } } },
      }) : null;
      if (!listing) { resolved = false; out.push({ productId: null, quantity: line.quantity || 1, unitPrice: Number(line.price_unit || 0), title: line.product_title, productName: null }); continue; }
      out.push({ productId: listing.productId, quantity: line.quantity || 1, unitPrice: Number(line.price_unit || 0), title: line.product_title, productName: listing.product.name });
    }
    return { resolved, items: out };
  }

  async previewSalesImport(conn: any, companyId: string, from?: string, to?: string) {
    const PAGE = 50;
    const MAX = 300;
    const params = new URLSearchParams({ max: String(PAGE), offset: '0' });
    if (from) params.set('start_date', new Date(from).toISOString());
    if (to) params.set('end_date', new Date(`${to}T23:59:59`).toISOString());

    let offset = 0;
    let totalCount = 0;
    const rawOrders: any[] = [];
    do {
      params.set('offset', String(offset));
      const data = await this.request(conn, `/api/orders?${params}`);
      totalCount = data.total_count || 0;
      rawOrders.push(...(data.orders || []));
      offset += PAGE;
    } while (offset < totalCount && rawOrders.length < MAX);
    const truncated = totalCount > rawOrders.length;

    const externalIds = rawOrders.map((o) => o.order_id);
    const existing = await this.prisma.sale.findMany({
      where: { channel: SaleChannel.RIPLEY, externalId: { in: externalIds } },
      select: { externalId: true },
    });
    const existingSet = new Set(existing.map((s) => s.externalId));

    const orders = [];
    for (const o of rawOrders) {
      const alreadyRegistered = existingSet.has(o.order_id);
      const { resolved, items } = await this.resolveOrderLines(conn.id, o.order_lines || []);
      orders.push({
        externalId: o.order_id,
        date: o.created_date,
        total: Number(o.total_price || 0),
        buyerName: [o.customer?.firstname, o.customer?.lastname].filter(Boolean).join(' ') || null,
        items: items.map((i) => ({ title: i.title, quantity: i.quantity, unitPrice: i.unitPrice, resolved: !!i.productId, productName: i.productName })),
        importable: !alreadyRegistered && resolved && items.length > 0,
        alreadyRegistered,
      });
    }
    const alreadyImportedCount = orders.filter((o) => o.alreadyRegistered).length;

    return { connectionName: conn.name, total: totalCount, truncated, alreadyImportedCount, orders };
  }

  async confirmSalesImport(conn: any, companyId: string, externalOrderIds: string[]) {
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const id of externalOrderIds) {
      try {
        const existing = await this.prisma.sale.findFirst({ where: { channel: SaleChannel.RIPLEY, externalId: id } });
        if (existing) { skipped++; continue; }

        const data = await this.request(conn, `/api/orders?order_id=${encodeURIComponent(id)}`);
        const o = (data.orders || [])[0];
        if (!o) { errors.push(`${id}: no se encontró en Ripley`); continue; }

        const { resolved, items } = await this.resolveOrderLines(conn.id, o.order_lines || []);
        if (!resolved || !items.length) { errors.push(`${id}: uno o más productos no están vinculados en el catálogo`); continue; }

        await this.prisma.sale.create({
          data: {
            channel: SaleChannel.RIPLEY,
            externalId: id,
            total: Number(o.total_price || 0),
            shippingCost: Number(o.shipping_price || 0),
            marketplaceFee: Number(o.total_commission || 0),
            companyId,
            connectionId: conn.id,
            customerName: [o.customer?.firstname, o.customer?.lastname].filter(Boolean).join(' ') || null,
            address: o.customer?.shipping_address?.street_1 || null,
            commune: o.customer?.shipping_address?.city || null,
            createdAt: new Date(o.created_date),
            items: { create: items.map((i) => ({ productId: i.productId!, quantity: i.quantity, unitPrice: i.unitPrice })) },
          },
        });
        imported++;
      } catch (err: any) {
        errors.push(`${id}: ${err.message}`);
      }
    }

    return { imported, skipped, errors };
  }

  async importRecentSales(conn: any, companyId: string): Promise<{ imported: number; skipped: number; errors: number }> {
    const from = conn.lastSalesImportAt
      ? new Date(new Date(conn.lastSalesImportAt).getTime() - 2 * 60 * 1000).toISOString()
      : new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const to = new Date();

    const preview = await this.previewSalesImport(conn, companyId, from);
    const ids = preview.orders.filter((o) => o.importable).map((o) => o.externalId);
    const res = ids.length
      ? await this.confirmSalesImport(conn, companyId, ids)
      : { imported: 0, skipped: 0, errors: [] as string[] };

    await this.prisma.marketplaceConnection.update({ where: { id: conn.id }, data: { lastSalesImportAt: to } });
    return { imported: res.imported, skipped: res.skipped, errors: res.errors.length };
  }

  // ─── Envío de boleta/factura a la orden (opcional, por conexión) ─────────────────
  // Ripley (Mirakl) exige adjuntar el documento tributario a la orden real — confirmado en
  // vivo (POST /api/orders/{order_id}/documents contra una orden inexistente para no tocar
  // datos reales): multipart con dos partes, "files" (el archivo) y "order_documents" (JSON
  // *envuelto* en un objeto, no un array suelto: `{"order_documents":[{"file_name":"...",
  // "type_code":"INVOICE"}]}`). "file_name" debe ser idéntico al nombre del archivo en la
  // parte "files"; "type_code" no se pudo confirmar contra una orden real (nunca se probó
  // una escritura real) — "INVOICE" es la mejor estimación a partir de la doc estándar de
  // Mirakl (OR74), pero si Ripley la rechaza, revisar primero ese valor.
  async sendInvoiceDocument(conn: any, sale: { externalId: string | null }, doc: { bytes: Buffer; contentType: string; extension: string }): Promise<void> {
    if (!sale.externalId) throw new Error('La venta no tiene una orden Ripley asociada');
    const filename = `factura-${sale.externalId}.${doc.extension}`;
    const form = new FormData();
    form.append('files', new Blob([new Uint8Array(doc.bytes)], { type: doc.contentType }), filename);
    form.append('order_documents', new Blob(
      [JSON.stringify({ order_documents: [{ file_name: filename, type_code: 'INVOICE' }] })],
      { type: 'application/json' },
    ));
    await this.request(conn, `/api/orders/${sale.externalId}/documents`, { method: 'POST', body: form as any });
  }
}

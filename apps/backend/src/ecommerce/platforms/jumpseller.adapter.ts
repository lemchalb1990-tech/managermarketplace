import { Injectable, Logger } from '@nestjs/common';
import { SaleChannel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAdapter, SyncPayload, PublishResult } from './platform.interface';
import { SaleBreakdown, ChargeDetailRow, LineCalc, IVA_RATE, round2, sinIva, buildBreakdown, backfillSale, previewItems } from './sale-breakdown';
import { ChannelOrderState, ChannelOrderStatus, OnSaleCreated } from './channel-order';

// Doc oficial: https://github.com/jumpseller/api-docs (spec OpenAPI en
// https://api.jumpseller.com/swagger.json). Confirmado en vivo (tienda "Altiroshopping"):
// Basic Auth con "login:authtoken" (Login Key + Auth Token de Editar cuenta → API) y
// respuestas envueltas — GET /store/info.json → {"store": {...}}, GET /products.json →
// [{"product": {...}}, ...]. Paginación por `page` (desde 1) y `limit` (máx. 100).
const BASE = 'https://api.jumpseller.com/v1';
const IMPORT_PAGE_SIZE = 50;
const ORDERS_PAGE_SIZE = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

const storeUrlCache = new Map<string, string | null>();

// Un producto de Jumpseller puede tener variantes (talla/color...), cada una con su propio
// SKU, stock y precio. En el catálogo interno cada variante es un producto aparte, así que
// el externalId del Listing es "productId" para un producto simple y "productId:variantId"
// para una variante — así syncListing sabe a qué recurso escribir.
function variantKey(productId: string | number, variantId?: string | number | null): string {
  return variantId ? `${productId}:${variantId}` : String(productId);
}

function parseKey(externalId: string): { productId: string; variantId: string | null } {
  const [productId, variantId] = String(externalId).split(':');
  return { productId, variantId: variantId || null };
}

function stripHtml(html?: string | null): string | undefined {
  if (!html) return undefined;
  const text = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n').trim();
  return text || undefined;
}

export interface JumpSellerImportItem {
  externalId: string;
  title: string;
  thumbnail: string | null;
  sku: string | null;
  skuSuspicious: boolean;
  matchedProductId: string | null;
  matchedProductName: string | null;
  price: number;
  stock: number;
  permalink: string | null;
  status: string;
}

@Injectable()
export class JumpSellerAdapter implements PlatformAdapter {
  private readonly logger = new Logger(JumpSellerAdapter.name);

  constructor(private prisma: PrismaService) {}

  private creds(conn: any): any {
    return (conn.credentials as any) || {};
  }

  private authHeader(conn: any): Record<string, string> {
    const { login, authtoken } = this.creds(conn);
    const basic = Buffer.from(`${login}:${authtoken}`).toString('base64');
    return { Authorization: `Basic ${basic}` };
  }

  private async request(conn: any, path: string, init: RequestInit = {}): Promise<any> {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...this.authHeader(conn), ...(init.headers || {}) },
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = data?.message || data?.error || data?.errors?.[0] || `HTTP ${res.status} en ${path}`;
      throw new Error(`JumpSeller: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    }
    return data;
  }

  async testConnection(conn: any): Promise<{ success: boolean; message?: string }> {
    try {
      const data = await this.request(conn, '/store/info.json');
      const store = data?.store || data;
      return { success: true, message: `Tienda: ${store?.name || store?.url || 'conectada'}` };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  async publishProduct(conn: any, product: any): Promise<PublishResult> {
    const data = await this.request(conn, '/products.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: {
          name: product.name,
          description: product.description || '',
          price: Number(product.price),
          stock: product.stock,
          sku: product.sku,
          status: 'available',
        },
      }),
    });
    return {
      externalId: String(data.product?.id || data.id),
      externalUrl: data.product?.permalink,
    };
  }

  // Producto simple → PUT /products/{id}.json; variante → PUT /products/{id}/variants/{vid}.json
  // (el stock/precio de un producto con variantes vive en cada variante, no en el producto).
  async syncListing(conn: any, externalId: string, payload: SyncPayload): Promise<void> {
    const { productId, variantId } = parseKey(externalId);
    const fields: any = { stock: Math.max(0, Math.round(payload.stock)) };
    if (payload.price !== undefined) fields.price = payload.price;

    if (variantId) {
      await this.request(conn, `/products/${productId}/variants/${variantId}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variant: fields }),
      });
    } else {
      await this.request(conn, `/products/${productId}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: fields }),
      });
    }
    this.logger.log(`JumpSeller sync: product=${externalId} stock=${fields.stock}${fields.price != null ? ` price=${fields.price}` : ''}`);
  }

  // ─── Importar catálogo existente desde Jumpseller ─────────────────────────────

  // Un producto de la API → una fila por variante (o una sola si no tiene variantes).
  private expandProduct(p: any) {
    const images: string[] = (p.images || []).slice().sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)).map((i: any) => i.url).filter(Boolean);
    const category = Array.isArray(p.categories) && p.categories.length ? p.categories[p.categories.length - 1]?.name : null;
    const base = {
      name: p.name as string,
      description: stripHtml(p.description),
      category: category || null,
      permalink: p.permalink ? String(p.permalink) : null,
      status: String(p.status || 'available'),
    };
    const variants: any[] = Array.isArray(p.variants) ? p.variants : [];
    if (!variants.length) {
      return [{
        ...base, externalId: variantKey(p.id), sku: p.sku || null, price: Number(p.price ?? 0),
        stock: p.stock_unlimited ? 0 : Number(p.stock ?? 0), cost: p.cost_per_item != null ? Number(p.cost_per_item) : null,
        images,
      }];
    }
    return variants.map((v) => {
      const opts = (v.options || []).map((o: any) => o.value).filter(Boolean).join(' / ');
      return {
        ...base, name: opts ? `${p.name} - ${opts}` : p.name, externalId: variantKey(p.id, v.id),
        sku: v.sku || null, price: Number(v.price ?? p.price ?? 0),
        stock: v.stock_unlimited ? 0 : Number(v.stock ?? 0),
        cost: v.cost_per_item != null ? Number(v.cost_per_item) : (p.cost_per_item != null ? Number(p.cost_per_item) : null),
        images: v.image?.url ? [v.image.url, ...images.filter((u) => u !== v.image.url)] : images,
      };
    });
  }

  // URL pública de la tienda (de /store/info.json), para armar el link de cada producto.
  private async storeUrl(conn: any): Promise<string | null> {
    const cached = storeUrlCache.get(conn.id);
    if (cached !== undefined) return cached;
    const data = await this.request(conn, '/store/info.json').catch(() => null);
    const url = (data?.store || data)?.url ? String((data?.store || data).url).replace(/\/$/, '') : null;
    storeUrlCache.set(conn.id, url);
    return url;
  }

  private productUrl(storeUrl: string | null, permalink: string | null): string | null {
    if (!permalink) return null;
    if (/^https?:\/\//.test(permalink)) return permalink;
    return storeUrl ? `${/^https?:\/\//.test(storeUrl) ? storeUrl : `https://${storeUrl}`}/${permalink}` : null;
  }

  async previewImport(conn: any, companyId: string, offset = 0) {
    const page = Math.floor(offset / IMPORT_PAGE_SIZE) + 1;
    const [list, count, storeUrl] = await Promise.all([
      this.request(conn, `/products.json?limit=${IMPORT_PAGE_SIZE}&page=${page}`),
      this.request(conn, '/products/count.json').catch(() => null),
      this.storeUrl(conn),
    ]);
    const products: any[] = (Array.isArray(list) ? list : []).map((r: any) => r?.product || r);
    const rows = products.flatMap((p) => this.expandProduct(p));
    const totalProducts = Number(count?.count ?? 0) || offset + products.length;
    const hasMore = products.length === IMPORT_PAGE_SIZE && offset + products.length < totalProducts;

    const skus = rows.map((r) => r.sku).filter(Boolean) as string[];
    const skuCounts = new Map<string, number>();
    for (const sku of skus) skuCounts.set(sku, (skuCounts.get(sku) || 0) + 1);

    const [existingProducts, existingListings] = await Promise.all([
      this.prisma.product.findMany({ where: { companyId, sku: { in: skus } }, select: { id: true, sku: true, name: true } }),
      this.prisma.listing.findMany({ where: { connectionId: conn.id }, select: { externalId: true } }),
    ]);
    const productBySku = new Map(existingProducts.map((p) => [p.sku, p]));
    const linkedIds = new Set(existingListings.map((l) => l.externalId).filter(Boolean));

    const items: JumpSellerImportItem[] = rows
      .filter((r) => !linkedIds.has(r.externalId))
      .map((r) => {
        const skuSuspicious = !!r.sku && (skuCounts.get(r.sku) || 0) > 1;
        const matched = r.sku ? productBySku.get(r.sku) : undefined;
        return {
          externalId: r.externalId, title: r.name, thumbnail: r.images[0] || null, sku: r.sku, skuSuspicious,
          matchedProductId: matched?.id || null, matchedProductName: matched?.name || null,
          price: r.price, stock: r.stock, permalink: this.productUrl(storeUrl, r.permalink), status: r.status,
        };
      });

    return {
      connectionName: conn.name, total: totalProducts, hasMore,
      nextOffset: hasMore ? offset + IMPORT_PAGE_SIZE : null,
      alreadyImportedCount: rows.length - items.length,
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

    const preexistingListings = await this.prisma.listing.findMany({ where: { connectionId: conn.id }, select: { productId: true, externalId: true } });
    const linkedProductIds = new Set(preexistingListings.map((l) => l.productId));
    const linkedIds = new Set(preexistingListings.map((l) => l.externalId).filter(Boolean));
    // Varias variantes del mismo producto vienen en una sola respuesta: se pide una vez.
    const productCache = new Map<string, any>();

    for (const externalId of externalIds) {
      try {
        if (linkedIds.has(externalId)) { skipped++; continue; }

        const { productId } = parseKey(externalId);
        if (!productCache.has(productId)) {
          const data = await this.request(conn, `/products/${productId}.json`).catch(() => null);
          productCache.set(productId, data?.product || null);
        }
        const raw = productCache.get(productId);
        const r = raw ? this.expandProduct(raw).find((x) => x.externalId === externalId) : null;
        if (!r) { errors.push(`${externalId}: no se encontró en JumpSeller`); continue; }

        const forceNew = unlinkSet.has(externalId);
        const sku = (!forceNew && r.sku) || (await this.nextSku(companyId));

        let product = forceNew ? null : await this.prisma.product.findUnique({ where: { sku_companyId: { sku, companyId } } });
        if (product && linkedProductIds.has(product.id)) { skipped++; continue; }

        if (!product) {
          product = await this.prisma.product.create({
            data: {
              sku, name: r.name, price: r.price || 0, stock: Math.max(0, Math.round(r.stock)),
              description: r.description, category: r.category || undefined,
              ...(r.cost != null && r.cost > 0 ? { cost: r.cost } : {}),
              companyId,
            },
          });
          if (r.images.length) {
            await this.prisma.productImage.createMany({
              data: r.images.map((url, i) => ({
                productId: product!.id, url, filename: url.split('/').pop()?.split('?')[0] || `jumpseller-${i}.jpg`,
                isPrimary: i === 0, order: i,
              })),
            });
          }
          imported++;
        } else {
          linked++;
        }
        linkedProductIds.add(product.id);
        linkedIds.add(externalId);

        const externalUrl = this.productUrl(await this.storeUrl(conn), r.permalink) || undefined;
        await this.prisma.listing.upsert({
          where: { productId_connectionId: { productId: product.id, connectionId: conn.id } },
          update: { externalId, externalUrl, status: 'ACTIVE' as any, syncedAt: new Date(), title: r.name },
          create: { productId: product.id, connectionId: conn.id, externalId, externalUrl, status: 'ACTIVE' as any, syncedAt: new Date(), title: r.name },
        });
      } catch (err: any) {
        errors.push(`${externalId}: ${err.message}`);
      }
    }

    return { imported, linked, skipped, errors };
  }

  // ─── Importar ventas ──────────────────────────────────────────────────────────
  // Mismo alcance que Walmart/Paris/Ripley/Falabella: la importación manual crea Sale/SaleItem
  // para historial/reportes; la automática (cron) además pasa `onCreated`, con el que
  // ChannelOrdersService crea la Orden de despacho y descuenta stock.
  // Solo se traen órdenes pagadas ("paid"): "pending_payment" y "abandoned" no son ventas.
  // Cada línea (`products[]`) trae `id` (producto) y `variant_id`, que arman el mismo
  // externalId con que se vinculó el Listing (ver variantKey).

  private async resolveOrderLines(connectionId: string, lines: any[]) {
    let resolved = true;
    const out: Array<{ productId: string | null; quantity: number; unitPrice: number; title: string; productName: string | null; unitCost: number | null }> = [];
    for (const line of lines || []) {
      const quantity = Math.max(1, Number(line.qty ?? 1) || 1);
      const unitPrice = Number(line.price ?? 0);
      const keys = [variantKey(line.id, line.variant_id), String(line.id)];
      const listing = await this.prisma.listing.findFirst({
        where: { connectionId, externalId: { in: keys } },
        select: { productId: true, product: { select: { name: true, cost: true } } },
      });
      if (!listing) { resolved = false; out.push({ productId: null, quantity, unitPrice, title: line.name, productName: null, unitCost: null }); continue; }
      out.push({ productId: listing.productId, quantity, unitPrice, title: line.name, productName: listing.product.name, unitCost: listing.product.cost != null ? Number(listing.product.cost) : null });
    }
    return { resolved, items: out };
  }

  // Verificado contra órdenes reales (tienda Altiroshopping, oct-2026):
  // - `price` de cada línea viene CON IVA incluido (`taxes[].tax_on_product_price: true`), y
  //   aun así `tax` informa ese IVA — no se suma aparte: total = subtotal + shipping − descuentos.
  //   Si una tienda tuviera precios sin IVA (`tax_on_product_price: false`), el IVA sí se suma.
  // - `shipping` lo paga el comprador y la tienda se lo traspasa al courier (Blue Express,
  //   Starken...): no es ingreso ni costo del vendedor, así que no suma al neto (queda en el detalle).
  // - Jumpseller no cobra comisión por venta (plan mensual) ni informa la de la pasarela de pago.
  // - Las gift cards son medio de pago, no descuento: lo pagado por productos las incluye.
  private orderBreakdown(order: any, unitCosts: (number | null)[]): SaleBreakdown & { total: number } {
    const total = Number(order.total ?? 0);
    const lines: any[] = order.products || [];
    const shippingPaid = Math.max(0, Number(order.shipping ?? 0) + Number(order.shipping_tax ?? 0) - Number(order.shipping_discount ?? 0));
    const productsPaid = Math.max(0, total + Number(order.gift_cards_discount ?? 0) - shippingPaid);
    const cancelled = order.status_enum === 'canceled';

    const listGross = lines.map((l) => {
      const list = Number(l.price ?? 0) * Math.max(1, Number(l.qty ?? 1) || 1);
      const taxes: any[] = Array.isArray(l.taxes) ? l.taxes : [];
      const taxAdded = taxes.length > 0 && taxes.every((t) => t.tax_on_product_price === false);
      return taxAdded ? list * (1 + IVA_RATE) : list;
    });
    const listTotal = listGross.reduce((s, v) => s + v, 0);
    const share = (i: number) => (listTotal > 0 ? listGross[i] / listTotal : 1 / Math.max(1, lines.length));

    const calc: LineCalc[] = lines.map((l, i) => {
      const gross = round2(productsPaid * share(i));
      const revenue = sinIva(gross);
      return {
        title: l.name,
        quantity: Math.max(1, Number(l.qty ?? 1) || 1),
        revenue,
        discount: sinIva(Math.max(0, listGross[i] - gross)),
        gross,
        commission: null,
        shipping: 0,
        tax: round2(gross - revenue),
        cancelled,
      };
    });

    const rows: ChargeDetailRow[] = [
      { type: 'PRODUCTOS', name: 'Subtotal', amount: Number(order.subtotal ?? 0), tax: Number(order.tax ?? 0) - Number(order.shipping_tax ?? 0) },
      { type: 'DESCUENTO', name: order.coupons ? `Cupón ${order.coupons}` : 'Descuento', amount: -Number(order.discount ?? 0), tax: 0 },
      { type: 'ENVIO', name: order.shipping_method_name || 'Envío', amount: Number(order.shipping ?? 0), tax: Number(order.shipping_tax ?? 0) },
      { type: 'ENVIO', name: 'Descuento de envío', amount: -Number(order.shipping_discount ?? 0), tax: 0 },
      { type: 'GIFT_CARD', name: 'Gift cards', amount: -Number(order.gift_cards_discount ?? 0), tax: 0 },
    ].filter((r) => r.amount !== 0 || r.tax !== 0);

    return {
      total,
      ...buildBreakdown({
        lines: calc, unitCosts, chargeDetail: rows,
        platform: 'JumpSeller', shippingLabel: 'Envío (lo paga el comprador al courier)',
      }),
    };
  }

  private customerOf(o: any) {
    const a = o.shipping_address || {};
    const name = [a.name, a.surname].filter(Boolean).join(' ') || o.customer?.fullname || null;
    const address = [a.address, a.street_number, a.complement].filter((v) => v != null && v !== '').join(' ') || null;
    const phone = o.customer?.phone ? `${o.customer.phone_prefix || ''}${o.customer.phone}` : null;
    return { name, email: o.customer?.email || null, phone, address, commune: a.municipality || a.city || null, region: a.region || null };
  }

  private toDay(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  // Jumpseller filtra por día en la zona horaria de la tienda: se pide un día de más a cada
  // lado y el rango exacto se aplica después con `created_at`.
  private async listPaidOrders(conn: any, from: Date, to: Date | null, max: number) {
    const params = new URLSearchParams({
      'status_filters[]': 'paid', dateFilter: 'customDate',
      initialDate: this.toDay(new Date(from.getTime() - DAY_MS)), finalDate: this.toDay(new Date((to || new Date()).getTime() + DAY_MS)),
      limit: String(ORDERS_PAGE_SIZE),
    });
    const out: any[] = [];
    let truncated = false;
    for (let page = 1; ; page++) {
      params.set('page', String(page));
      const data = await this.request(conn, `/orders.json?${params}`);
      const batch: any[] = (Array.isArray(data) ? data : []).map((r: any) => r?.order || r);
      // Por si la API ignora algún filtro: solo pagadas y del rango exacto.
      out.push(...batch.filter((o) => {
        const created = new Date(o.created_at);
        return o.status_enum === 'paid' && created >= from && (!to || created <= to);
      }));
      if (batch.length < ORDERS_PAGE_SIZE) break;
      if (out.length >= max) { truncated = true; break; }
    }
    return { orders: out, truncated };
  }

  async previewSalesImport(conn: any, companyId: string, from?: string, to?: string, opts: { backfill?: boolean } = {}) {
    const MAX = 300;
    const fromDate = from ? new Date(from) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(`${to}T23:59:59`) : null;
    const { orders: rawOrders, truncated } = await this.listPaidOrders(conn, fromDate, toDate, MAX);

    const externalIds = rawOrders.map((o) => String(o.id));
    const existing = await this.prisma.sale.findMany({
      where: { channel: SaleChannel.JUMPSELLER, externalId: { in: externalIds } },
      select: { id: true, externalId: true },
    });
    const existingById = new Map(existing.map((s) => [s.externalId, s.id]));

    const orders = [];
    for (const o of rawOrders) {
      const externalId = String(o.id);
      const saleId = existingById.get(externalId);
      const { resolved, items } = await this.resolveOrderLines(conn.id, o.products || []);
      const { total, ...b } = this.orderBreakdown(o, items.map((i) => i.unitCost));
      // Recalcula cargos/neto (sin IVA) de ventas ya importadas con los datos de este mismo listado.
      if (saleId && opts.backfill !== false) await backfillSale(this.prisma, saleId, b, items.map((i) => i.productId));
      orders.push({
        externalId,
        date: new Date(o.created_at).toISOString(),
        total,
        ...b,
        buyerName: this.customerOf(o).name,
        items: previewItems(items, b),
        importable: !saleId && resolved && items.length > 0 && o.status_enum === 'paid',
        alreadyRegistered: !!saleId,
      });
    }
    const alreadyImportedCount = orders.filter((o) => o.alreadyRegistered).length;

    return { connectionName: conn.name, total: rawOrders.length, truncated, alreadyImportedCount, orders };
  }

  // Estado de pago (`status_enum`) + estado del despacho (`shipment_status_enum`).
  private orderState(o: any): ChannelOrderState {
    if (o.status_enum === 'canceled') return { status: 'CANCELLED', label: 'Cancelada' };
    const SHIPMENT: Record<string, [ChannelOrderStatus, string]> = {
      unfulfilled: ['PENDING', 'Pagada, sin despachar'], requested: ['PENDING', 'Despacho solicitado'],
      failed: ['PENDING', 'Despacho fallido'], in_transit: ['SHIPPED', 'En tránsito'],
      pickup_available: ['SHIPPED', 'Disponible para retiro'], delivered: ['DELIVERED', 'Entregada'],
    };
    const known = SHIPMENT[String(o.shipment_status_enum || '').toLowerCase()];
    const status: ChannelOrderStatus | null = known ? known[0] : (o.status_enum === 'paid' ? 'PENDING' : null);
    return {
      status,
      label: known ? known[1] : (o.shipment_status || o.status || 'Sin estado'),
      courier: o.tracking_company || null,
      trackingCode: o.tracking_number ? String(o.tracking_number) : null,
    };
  }

  async getOrderStates(conn: any, externalIds: string[]): Promise<Map<string, ChannelOrderState>> {
    const out = new Map<string, ChannelOrderState>();
    for (const id of externalIds) {
      try {
        const data = await this.request(conn, `/orders/${encodeURIComponent(id)}.json`);
        const o = data?.order || data;
        if (o?.id) out.set(id, this.orderState(o));
      } catch (err: any) {
        this.logger.warn(`JumpSeller estado orden ${id}: ${err.message}`);
      }
    }
    return out;
  }

  async confirmSalesImport(conn: any, companyId: string, externalOrderIds: string[], onCreated?: OnSaleCreated) {
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const id of externalOrderIds) {
      try {
        const existing = await this.prisma.sale.findFirst({ where: { channel: SaleChannel.JUMPSELLER, externalId: id } });
        if (existing) { skipped++; continue; }

        const data = await this.request(conn, `/orders/${encodeURIComponent(id)}.json`);
        const o = data?.order || data;
        if (!o?.id) { errors.push(`${id}: no se encontró en JumpSeller`); continue; }
        if (o.status_enum !== 'paid') { errors.push(`${id}: la orden no está pagada (${o.status || o.status_enum})`); continue; }

        const { resolved, items } = await this.resolveOrderLines(conn.id, o.products || []);
        if (!resolved || !items.length) { errors.push(`${id}: uno o más productos no están vinculados en el catálogo`); continue; }
        const b = this.orderBreakdown(o, items.map((i) => i.unitCost));
        const customer = this.customerOf(o);

        await this.prisma.$transaction(async (tx) => {
          const sale = await tx.sale.create({
            data: {
              channel: SaleChannel.JUMPSELLER,
              externalId: id,
              total: b.total,
              ...b.charges,
              companyId,
              connectionId: conn.id,
              customerName: customer.name,
              customerEmail: customer.email,
              customerPhone: customer.phone,
              address: customer.address,
              commune: customer.commune,
              city: customer.region,
              createdAt: new Date(o.created_at),
              items: { create: items.map((i, idx) => ({ productId: i.productId!, quantity: i.quantity, unitPrice: i.unitPrice, netAmount: b.lines[idx]?.net })) },
            },
            include: { items: true },
          });
          if (onCreated) {
            await onCreated(tx, { sale, externalId: id, state: this.orderState(o), cancelledProductIds: [], customer });
          }
        });
        imported++;
      } catch (err: any) {
        errors.push(`${id}: ${err.message}`);
      }
    }

    return { imported, skipped, errors };
  }

  async importRecentSales(conn: any, companyId: string, onCreated?: OnSaleCreated): Promise<{ imported: number; skipped: number; errors: number }> {
    const from = conn.lastSalesImportAt
      ? new Date(new Date(conn.lastSalesImportAt).getTime() - 2 * 60 * 1000).toISOString()
      : new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const to = new Date();

    // Sin backfill: el cron corre cada pocos minutos y no necesita reescribir ventas ya importadas.
    const preview = await this.previewSalesImport(conn, companyId, from, undefined, { backfill: false });
    const ids = preview.orders.filter((o) => o.importable).map((o) => o.externalId);
    const res = ids.length
      ? await this.confirmSalesImport(conn, companyId, ids, onCreated)
      : { imported: 0, skipped: 0, errors: [] as string[] };

    await this.prisma.marketplaceConnection.update({ where: { id: conn.id }, data: { lastSalesImportAt: to } });
    return { imported: res.imported, skipped: res.skipped, errors: res.errors.length };
  }
}

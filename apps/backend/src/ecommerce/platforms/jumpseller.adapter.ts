import { Injectable, Logger } from '@nestjs/common';
import { SaleChannel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAdapter, SyncPayload, PublishResult } from './platform.interface';
import { SaleBreakdown, ChargeDetailRow, LineCalc, IVA_RATE, round2, sinIva, buildBreakdown, backfillSale, previewItems } from './sale-breakdown';
import { ChannelOrderState, ChannelOrderStatus, OnSaleCreated } from './channel-order';
import { getEffectivePrice } from '../../common/effective-price.util';

// Doc oficial: https://github.com/jumpseller/api-docs (spec OpenAPI en
// https://api.jumpseller.com/swagger.json). Confirmado en vivo (tienda "Altiroshopping"):
// Basic Auth con "login:authtoken" (Login Key + Auth Token de Editar cuenta → API) y
// respuestas envueltas — GET /store/info.json → {"store": {...}}, GET /products.json →
// [{"product": {...}}, ...]. Paginación por `page` (desde 1) y `limit` (máx. 100).
const BASE = 'https://api.jumpseller.com/v1';
const IMPORT_PAGE_SIZE = 50;
const ORDERS_PAGE_SIZE = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

const storeInfoCache = new Map<string, { url: string | null; weightUnit: string }>();
const NAME_MATCH_THRESHOLD = 0.9;

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

// Nombre comparable: minúsculas, sin tildes ni signos, espacios simples.
function normalizeName(name?: string | null): string {
  return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

// Coeficiente de Dice entre dos conjuntos de palabras (1 = mismas palabras).
function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const t of a) if (b.has(t)) common++;
  return (2 * common) / (a.size + b.size);
}

export interface JumpSellerImportItem {
  externalId: string;
  title: string;
  thumbnail: string | null;
  sku: string | null;
  skuSuspicious: boolean;
  matchedProductId: string | null;
  matchedProductName: string | null;
  matchType: 'sku' | 'name' | null;
  price: number;
  stock: number;
  permalink: string | null;
  status: string;
  group: string | null; // nombre del producto padre si es una variante
  attributes: { name: string; value: string }[];
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
    const price = await getEffectivePrice(this.prisma, product.id, conn.id, Number(product.price));
    const data = await this.request(conn, '/products.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: {
          name: product.name,
          description: product.description || '',
          price,
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
  // Se importan productos disponibles y desactivados por igual (el modal permite filtrar por
  // estado); el estado de Jumpseller queda en channelAttributes.status y el sync de stock/precio
  // no lo toca, así que un producto desactivado sigue desactivado en la tienda.
  //
  // Variantes: cada variante es un Product propio (su stock/SKU/precio) y todas quedan
  // agrupadas bajo un ProductMaster (masterSku "JS-{id}") con sus VariantAttribute
  // (Talla, Color...). Listing.variationId guarda el id de la variante, igual que ML.
  //
  // Emparejamiento con el catálogo: por SKU y, como la tienda real no usa SKU, por nombre
  // normalizado (sin tildes, mayúsculas ni signos). Solo se sugiere si hay UN candidato claro.

  // Un producto de la API → una fila por variante (o una sola si no tiene variantes).
  private expandProduct(p: any) {
    const images: string[] = (p.images || []).slice().sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)).map((i: any) => i.url).filter(Boolean);
    const categories: { id: number; name: string }[] = (p.categories || []).map((c: any) => ({ id: c.id, name: c.name }));
    const variants: any[] = Array.isArray(p.variants) ? p.variants : [];
    const channel = {
      jumpsellerProductId: p.id,
      status: String(p.status || 'available'),
      pageTitle: (p.page_title as string) || null,
      metaDescription: (p.meta_description as string) || null,
      categories,
      brand: (p.brand as string) || null,
      featured: !!p.featured,
      weight: p.weight != null ? Number(p.weight) : null,
      length: p.length != null ? Number(p.length) : null,
      width: p.width != null ? Number(p.width) : null,
      height: p.height != null ? Number(p.height) : null,
    };
    const base = {
      jsProductId: String(p.id),
      baseName: p.name as string,
      descriptionHtml: (p.description as string) || null,
      description: stripHtml(p.description),
      category: categories.length ? categories[categories.length - 1].name : null,
      permalink: p.permalink ? String(p.permalink) : null,
      status: channel.status,
      hasVariants: variants.length > 0,
      productImages: images,
      channel,
    };
    if (!variants.length) {
      return [{
        ...base, name: p.name as string, externalId: variantKey(p.id), variantId: null as string | null,
        attributes: [] as { name: string; value: string }[], sku: (p.sku as string) || null, price: Number(p.price ?? 0),
        stock: p.stock_unlimited ? 0 : Number(p.stock ?? 0), cost: p.cost_per_item != null ? Number(p.cost_per_item) : null,
        images,
      }];
    }
    return variants.map((v) => {
      const attributes: { name: string; value: string }[] = (v.options || [])
        .filter((o: any) => o.name && o.value).map((o: any) => ({ name: String(o.name), value: String(o.value) }));
      const opts = attributes.map((a) => a.value).join(' / ');
      return {
        ...base, name: opts ? `${p.name} - ${opts}` : (p.name as string), externalId: variantKey(p.id, v.id), variantId: String(v.id) as string | null,
        attributes, sku: (v.sku as string) || null, price: Number(v.price ?? p.price ?? 0),
        stock: v.stock_unlimited ? 0 : Number(v.stock ?? 0),
        cost: v.cost_per_item != null ? Number(v.cost_per_item) : (p.cost_per_item != null ? Number(p.cost_per_item) : null),
        images: v.image?.url ? [v.image.url as string, ...images.filter((u) => u !== v.image.url)] : images,
      };
    });
  }

  // URL pública y unidad de peso de la tienda (de /store/info.json).
  private async storeInfo(conn: any): Promise<{ url: string | null; weightUnit: string }> {
    const cached = storeInfoCache.get(conn.id);
    if (cached) return cached;
    const data = await this.request(conn, '/store/info.json').catch(() => null);
    const store = data?.store || data || {};
    const info = {
      url: store.url ? String(store.url).replace(/\/$/, '') : null,
      weightUnit: String(store.weight_unit || 'kg').toLowerCase(),
    };
    storeInfoCache.set(conn.id, info);
    return info;
  }

  private productUrl(storeUrl: string | null, permalink: string | null): string | null {
    if (!permalink) return null;
    if (/^https?:\/\//.test(permalink)) return permalink;
    return storeUrl ? `${/^https?:\/\//.test(storeUrl) ? storeUrl : `https://${storeUrl}`}/${permalink}` : null;
  }

  // Productos del catálogo que todavía no tienen publicación en esta conexión, indexados por
  // SKU y por nombre normalizado. Un nombre repetido en el catálogo no sirve para emparejar.
  private async buildMatcher(conn: any, companyId: string) {
    const products = await this.prisma.product.findMany({
      where: { companyId, listings: { none: { connectionId: conn.id } } },
      select: { id: true, name: true, sku: true },
    });
    const bySku = new Map(products.map((p) => [p.sku.trim().toLowerCase(), p]));
    const tokenized = products.map((p) => {
      const key = normalizeName(p.name);
      return { p, key, tokens: new Set(key.split(' ')) };
    });
    const byName = new Map<string, typeof products>();
    for (const t of tokenized) {
      if (!t.key) continue;
      byName.set(t.key, [...(byName.get(t.key) || []), t.p]);
    }
    return (row: { sku: string | null; name: string }): { product: { id: string; name: string }; type: 'sku' | 'name' } | null => {
      if (row.sku) {
        const p = bySku.get(row.sku.trim().toLowerCase());
        if (p) return { product: p, type: 'sku' };
      }
      const key = normalizeName(row.name);
      if (!key) return null;
      const exact = byName.get(key);
      if (exact?.length === 1) return { product: exact[0], type: 'name' };
      if (exact && exact.length > 1) return null;
      // Mismas palabras en otro orden o con alguna de diferencia (ej. "Talla M Negro" vs "M / Negro").
      const tokens = new Set(key.split(' '));
      if (tokens.size < 3) return null;
      const close = tokenized.filter((t) => dice(tokens, t.tokens) >= NAME_MATCH_THRESHOLD);
      return close.length === 1 ? { product: close[0].p, type: 'name' } : null;
    };
  }

  async previewImport(conn: any, companyId: string, offset = 0) {
    const page = Math.floor(offset / IMPORT_PAGE_SIZE) + 1;
    const [list, count, store, match] = await Promise.all([
      this.request(conn, `/products.json?limit=${IMPORT_PAGE_SIZE}&page=${page}`),
      this.request(conn, '/products/count.json').catch(() => null),
      this.storeInfo(conn),
      this.buildMatcher(conn, companyId),
    ]);
    const products: any[] = (Array.isArray(list) ? list : []).map((r: any) => r?.product || r);
    const rows = products.flatMap((p) => this.expandProduct(p));
    const totalProducts = Number(count?.count ?? 0) || offset + products.length;
    const hasMore = products.length === IMPORT_PAGE_SIZE && offset + products.length < totalProducts;

    const skuCounts = new Map<string, number>();
    for (const r of rows) if (r.sku) skuCounts.set(r.sku, (skuCounts.get(r.sku) || 0) + 1);

    const existingListings = await this.prisma.listing.findMany({ where: { connectionId: conn.id }, select: { externalId: true } });
    const linkedIds = new Set(existingListings.map((l) => l.externalId).filter(Boolean));

    // Dos filas de este lote no pueden vincularse al mismo producto del catálogo.
    const claimed = new Map<string, number>();
    const pending = rows.filter((r) => !linkedIds.has(r.externalId)).map((r) => {
      const m = match(r);
      if (m) claimed.set(m.product.id, (claimed.get(m.product.id) || 0) + 1);
      return { r, m };
    });

    const items: JumpSellerImportItem[] = pending.map(({ r, m }) => {
      const usable = m && claimed.get(m.product.id) === 1 ? m : null;
      return {
        externalId: r.externalId, title: r.name, thumbnail: r.images[0] || null, sku: r.sku,
        skuSuspicious: !!r.sku && (skuCounts.get(r.sku) || 0) > 1,
        matchedProductId: usable?.product.id || null, matchedProductName: usable?.product.name || null,
        matchType: usable?.type || null,
        price: r.price, stock: r.stock, permalink: this.productUrl(store.url, r.permalink), status: r.status,
        group: r.hasVariants ? r.baseName : null,
        attributes: r.attributes,
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

  // Producto Maestro que agrupa las variantes de un producto de Jumpseller (uno por producto,
  // reutilizado si sus variantes se importan en lotes distintos).
  private async ensureMaster(companyId: string, r: ReturnType<JumpSellerAdapter['expandProduct']>[number]) {
    const masterSku = `JS-${r.jsProductId}`;
    const existing = await this.prisma.productMaster.findUnique({ where: { masterSku_companyId: { masterSku, companyId } } });
    if (existing) return existing.id;
    const master = await this.prisma.productMaster.create({
      data: {
        masterSku, name: r.baseName, brand: r.channel.brand || undefined, status: 'ACTIVE', companyId,
        content: {
          create: {
            seoTitle: r.channel.pageTitle || undefined,
            metaDescription: r.channel.metaDescription || undefined,
            description: r.description,
          },
        },
        channelContent: { create: { platform: 'jumpseller', title: r.baseName, description: r.descriptionHtml || undefined } },
        images: {
          create: r.productImages.map((url, i) => ({
            url, filename: url.split('/').pop()?.split('?')[0] || `jumpseller-${i}.jpg`, isPrimary: i === 0, order: i,
          })),
        },
      },
    });
    return master.id;
  }

  async confirmImport(conn: any, companyId: string, externalIds: string[], unlinkIds: string[] = []) {
    const unlinkSet = new Set(unlinkIds);
    let imported = 0, linked = 0, skipped = 0;
    const errors: string[] = [];

    const preexistingListings = await this.prisma.listing.findMany({ where: { connectionId: conn.id }, select: { productId: true, externalId: true } });
    const linkedProductIds = new Set(preexistingListings.map((l) => l.productId));
    const linkedIds = new Set(preexistingListings.map((l) => l.externalId).filter(Boolean));
    const [store, match] = await Promise.all([this.storeInfo(conn), this.buildMatcher(conn, companyId)]);
    const toGrams = (w: number | null) => (w && w > 0
      ? round2(store.weightUnit === 'lb' ? w * 453.592 : store.weightUnit === 'g' ? w : w * 1000)
      : null);
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
        const m = forceNew ? null : match(r);
        let product = m && !linkedProductIds.has(m.product.id)
          ? await this.prisma.product.findUnique({ where: { id: m.product.id } })
          : null;

        const masterId = r.hasVariants ? await this.ensureMaster(companyId, r) : null;

        if (!product) {
          const skuTaken = r.sku ? await this.prisma.product.findUnique({ where: { sku_companyId: { sku: r.sku, companyId } } }) : null;
          const sku = r.sku && !skuTaken ? r.sku : await this.nextSku(companyId);
          product = await this.prisma.product.create({
            data: {
              sku, name: r.name, price: r.price || 0, stock: Math.max(0, Math.round(r.stock)),
              description: r.description, category: r.category || undefined,
              ...(r.cost != null && r.cost > 0 ? { cost: r.cost } : {}),
              packageWeight: toGrams(r.channel.weight) ?? undefined,
              packageLength: r.channel.length || undefined,
              packageWidth: r.channel.width || undefined,
              packageHeight: r.channel.height || undefined,
              productMasterId: masterId || undefined,
              companyId,
              ...(r.attributes.length ? { variantAttributes: { create: r.attributes } } : {}),
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
          // Vinculado a uno existente: se suma al grupo solo si no pertenece ya a otro maestro.
          if (masterId && !product.productMasterId) {
            await this.prisma.product.update({ where: { id: product.id }, data: { productMasterId: masterId } });
            const hasAttrs = await this.prisma.variantAttribute.count({ where: { productId: product.id } });
            if (!hasAttrs && r.attributes.length) {
              await this.prisma.variantAttribute.createMany({ data: r.attributes.map((a) => ({ ...a, productId: product!.id })) });
            }
          }
          linked++;
        }
        linkedProductIds.add(product.id);
        linkedIds.add(externalId);

        const listingData = {
          externalId,
          variationId: r.variantId,
          externalUrl: this.productUrl(store.url, r.permalink) || undefined,
          status: 'ACTIVE' as any,
          syncedAt: new Date(),
          title: r.name,
          description: r.descriptionHtml,
          channelAttributes: { ...r.channel, variantId: r.variantId, attributes: r.attributes } as any,
        };
        await this.prisma.listing.upsert({
          where: { productId_connectionId: { productId: product.id, connectionId: conn.id } },
          update: listingData,
          create: { productId: product.id, connectionId: conn.id, ...listingData },
        });
        // "Precio venta JumpSeller": el precio de la tienda queda como precio propio de esta
        // conexión, sin tocar el precio de venta general de un producto que ya existía.
        if (r.price > 0) {
          await this.prisma.channelPrice.upsert({
            where: { productId_connectionId: { productId: product.id, connectionId: conn.id } },
            update: { price: r.price },
            create: { productId: product.id, connectionId: conn.id, price: r.price },
          });
        }
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

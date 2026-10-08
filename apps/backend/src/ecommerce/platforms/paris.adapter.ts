import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { FulfillmentType, SaleChannel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { PlatformAdapter, SyncPayload, PublishResult } from './platform.interface';
import { SaleBreakdown, ChargeDetailRow, LineCalc, groupChargeRows, round2, sinIva, buildBreakdown, backfillSale, previewItems } from './sale-breakdown';
import { ChannelOrderState, ChannelOrderStatus, OnSaleCreated } from './channel-order';
import { getEffectivePrice } from '../../common/effective-price.util';
import { toAbsoluteUrl } from '../../common/absolute-url.util';
import { normalizeRut } from '../../common/rut.util';

// Paris / Cencosud Marketplace. Doc: https://developers.ecomm.cencosud.com/docs
// La API de producción es la misma URL sin el "-stg". OJO: probado en vivo, la API Key
// que entregan por defecto autentica contra PROD, no contra "-stg" (staging da 401).
const PROD_BASE = 'https://api-developers.ecomm.cencosud.com';
const STG_BASE = 'https://api-developers.ecomm-stg.cencosud.com';

// Refresca el token un poco antes de que venza (dura ~4h) en vez de esperar el 401.
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

function stripHtml(html: string, maxLen: number): string {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}

// Contraparte de buildAttributesPayload: al importar desde Paris, la descripción vive
// como un atributo más ("Descripción Larga/Emocional" con HTML, o "Descripción corta"
// como respaldo) — se rescata de ahí para precargar Listing.description.
function extractDescription(attributes: any[]): string {
  const isDescription = (name: string) => name.toLowerCase().includes('descripci');
  const long = attributes.find((a) => {
    const n = (a.name || '').toLowerCase();
    return isDescription(n) && (n.includes('larga') || n.includes('emocional'));
  });
  if (long?.value) return long.value;
  const short = attributes.find((a) => isDescription(a.name || ''));
  return short?.value || '';
}

// Para Product.description (campo plano de la pestaña "Información" del catálogo, a
// diferencia de Listing.description que es HTML) — prioriza "Descripción corta" y si no
// existe, recorta la larga sacándole las etiquetas HTML.
function extractShortDescription(attributes: any[]): string {
  const short = attributes.find((a) => {
    const n = (a.name || '').toLowerCase();
    return n.includes('descripci') && n.includes('corta');
  });
  if (short?.value) return short.value;
  const long = extractDescription(attributes);
  return long ? stripHtml(long, 500) : '';
}

interface ParisAuth {
  accessToken: string;
  expiresAt: Date;
  seller: { id?: string; name?: string; email?: string; status?: string };
}

// Guarda el token en memoria por conexión — no persiste en DB porque dura solo 4h y no
// vale la pena una migración para esto (a diferencia de Noriega en dropshipping, que sí
// lo cachea en DB porque compite con un rate limit ajustado).
const tokenCache = new Map<string, ParisAuth>();

export interface ParisFamily { id: string; name: string; allowVariant: boolean }
export interface ParisCategory { id: string; name: string; path: string }
export interface ParisAttributeOption { id: string; name: string }
export interface ParisAttribute {
  id: string;
  name: string;
  scope: 'PRODUCT' | 'VARIANT';
  dataType: string; // string | number | list, etc (attributeType.code)
  required: boolean;
  options: ParisAttributeOption[];
}
export interface ParisStorePrice { id: string; name: string; channelName: string }

// Lo que guardamos en Listing.channelAttributes para un producto publicado/en borrador en Paris.
export interface ParisChannelAttributes {
  familyId: string;
  familyName?: string;
  categoryId: string;
  categoryPath?: string;
  attributes: Array<{ attributeId: string; name: string; value: string; optionId?: string; optionName?: string }>;
}

export interface ParisImportItem {
  externalId: string; // id raíz del producto en Paris (ej. "MKRABN0U8V")
  title: string;
  thumbnail: string | null;
  sku: string | null;
  skuSuspicious: boolean;
  matchedProductId: string | null;
  matchedProductName: string | null;
}

export interface ParisImportPreview {
  connectionName: string;
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
  alreadyImportedCount: number;
  items: ParisImportItem[];
}

const IMPORT_PAGE_SIZE = 25;

@Injectable()
export class ParisAdapter implements PlatformAdapter {
  private readonly logger = new Logger(ParisAdapter.name);

  constructor(private prisma: PrismaService, private settings: SettingsService) {}

  private creds(conn: any): any {
    return (conn.credentials as any) || {};
  }

  private baseUrl(conn: any): string {
    return this.creds(conn).env === 'staging' ? STG_BASE : PROD_BASE;
  }

  private async authenticate(conn: any): Promise<ParisAuth> {
    const apiKey = this.creds(conn).apiKey;
    if (!apiKey) throw new Error('Falta la API Key de Paris');

    const res = await fetch(`${this.baseUrl(conn)}/v1/auth/apiKey`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(
        `Paris rechazó la autenticación (HTTP ${res.status})${txt ? `: ${txt.slice(0, 200)}` : ''}`,
      );
    }

    const data = (await res.json()) as any;
    const p = data.jwtPayload || {};
    const seconds = Number(data.expiresIn);
    const ttlSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 4 * 60 * 60;
    return {
      accessToken: data.accessToken,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      seller: {
        id: p.seller_id,
        name: p.seller_name,
        email: p.email,
        status: p.seller_status,
      },
    };
  }

  private async token(conn: any): Promise<string> {
    const cached = tokenCache.get(conn.id);
    if (cached && cached.expiresAt.getTime() - Date.now() > TOKEN_REFRESH_MARGIN_MS) {
      return cached.accessToken;
    }
    const auth = await this.authenticate(conn);
    tokenCache.set(conn.id, auth);
    return auth.accessToken;
  }

  // Helper de bajo nivel: agrega el Bearer, reintenta una vez si el token quedó viejo, y
  // lanza un Error legible en vez de dejar pasar un JSON de error crudo.
  private async request(conn: any, path: string, init: RequestInit = {}): Promise<any> {
    const doFetch = async (token: string) => fetch(`${this.baseUrl(conn)}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}), Authorization: `Bearer ${token}` },
    });

    let token = await this.token(conn);
    let res = await doFetch(token);
    if (res.status === 401) {
      tokenCache.delete(conn.id);
      token = await this.token(conn);
      res = await doFetch(token);
    }
    // Paris corta de vez en cuando con muchas llamadas seguidas (p. ej. "Cargar todos" del
    // catálogo, que además pide el detalle de cada producto): se reintenta con espera creciente.
    for (let attempt = 1; attempt < 4 && (res.status === 429 || res.status >= 500); attempt++) {
      const retryAfter = Number(res.headers.get('retry-after'));
      await new Promise((r) => setTimeout(r, retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** (attempt - 1)));
      res = await doFetch(token);
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const message = data?.message || `Paris respondió HTTP ${res.status} en ${path}`;
      throw new Error(Array.isArray(message) ? message.join(', ') : message);
    }
    return data;
  }

  // Etiqueta de despacho de la suborden: Paris la genera (Bluexpress, etc.) y la deja en
  // shipments[].label con una URL pública al PDF (y otra al ZPL).
  async getShippingLabelPdf(conn: any, subOrderNumber: string): Promise<Buffer> {
    const r = await this.request(conn, `/v2/sub-orders?limit=1&offset=0&subOrderNumber=${encodeURIComponent(subOrderNumber)}`);
    const sub = (r?.data || [])[0];
    if (!sub) throw new Error(`Paris no encontró la suborden ${subOrderNumber}.`);
    const shipments: any[] = Array.isArray(sub.shipments) ? sub.shipments : [];
    const url = shipments.map((s) => (s.label || []).find((l: any) => String(l.format).toLowerCase() === 'pdf')?.url).find(Boolean);
    if (!url) throw new Error(`Paris todavía no generó la etiqueta de la orden ${subOrderNumber}: vuelve a intentar en unos minutos.`);
    const pdf = await fetch(url);
    if (!pdf.ok) throw new Error(`No se pudo descargar la etiqueta de la orden ${subOrderNumber} (HTTP ${pdf.status}).`);
    return Buffer.from(await pdf.arrayBuffer());
  }

  async testConnection(conn: any): Promise<{ success: boolean; message?: string }> {
    try {
      tokenCache.delete(conn.id);
      const { seller } = await this.authenticate(conn);
      const who = seller.name || seller.email || seller.id || 'seller';
      const env = this.creds(conn).env === 'staging' ? ' [ambiente de pruebas]' : '';
      const inactive = seller.status && seller.status !== 'active' ? ` (estado: ${seller.status})` : '';
      return { success: true, message: `Conectado como ${who}${inactive}${env}` };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  // ─── Lecturas para armar los selects/combobox de homologación ────────────────

  async getFamilies(conn: any, q?: string): Promise<ParisFamily[]> {
    // La cuenta probada tiene 245 familias — se trae todo de una vez y se filtra en el
    // frontend; no hay parámetro de búsqueda documentado para este endpoint.
    const data = await this.request(conn, '/v2/families?limit=500&offset=0');
    const results: ParisFamily[] = (data.results || []).map((f: any) => ({
      id: f.id, name: f.name, allowVariant: !!f.allowVariant,
    }));
    if (!q?.trim()) return results;
    const needle = q.trim().toLowerCase();
    return results.filter((f) => f.name.toLowerCase().includes(needle));
  }

  async getCategories(conn: any, familyId: string): Promise<ParisCategory[]> {
    const data = await this.request(conn, `/v2/categories/family/${familyId}?limit=500&offset=0`);
    return (data.results || []).map((c: any) => ({ id: c.id, name: c.name, path: c.path }));
  }

  async getAttributes(conn: any, familyId: string): Promise<ParisAttribute[]> {
    const [productRes, variantRes] = await Promise.all([
      this.request(conn, `/v2/attributes/product/family/${familyId}?limit=100&offset=0`),
      this.request(conn, `/v2/attributes/variant/family/${familyId}?limit=100&offset=0`),
    ]);
    const map = (scope: 'PRODUCT' | 'VARIANT') => (a: any): ParisAttribute => {
      const validation = a.familyAttributes?.[0]?.attributeValidation;
      return {
        id: a.id,
        name: a.name,
        scope,
        dataType: validation?.attributeType?.code || 'string',
        required: !!validation?.isRequired,
        options: (a.attributeOptions || []).map((o: any) => ({ id: o.id, name: o.name })),
      };
    };
    return [
      ...(productRes.results || []).map(map('PRODUCT')),
      ...(variantRes.results || []).map(map('VARIANT')),
    ];
  }

  async getAttributeOptions(conn: any, attributeId: string, q?: string): Promise<ParisAttributeOption[]> {
    const params = new URLSearchParams({ limit: '25', offset: '0' });
    if (q?.trim()) params.set('q', q.trim());
    const data = await this.request(conn, `/v2/attributes-options/attribute/${attributeId}?${params}`);
    return (data.results || []).map((o: any) => ({ id: o.id, name: o.name }));
  }

  async getStorePrices(conn: any): Promise<ParisStorePrice[]> {
    const data = await this.request(conn, '/v2/store-prices');
    return (Array.isArray(data) ? data : []).map((s: any) => ({
      id: s.id, name: s.name, channelName: s.channel?.name,
    }));
  }

  // Stock es una API separada de la de productos — GET /v2/stock?sku= devuelve el stock
  // real de UNA variante puntual (availableStock ya descuenta el securityStock reservado).
  async getStock(conn: any, sku: string): Promise<number | null> {
    try {
      const data = await this.request(conn, `/v2/stock?sku=${encodeURIComponent(sku)}`);
      const row = data.skus?.[0];
      return row ? Math.max(0, Math.round(Number(row.availableStock))) : null;
    } catch (err: any) {
      this.logger.warn(`Paris getStock(${sku}) falló: ${err.message}`);
      return null;
    }
  }

  private async getPriceTypeId(conn: any, name: string): Promise<string | null> {
    const data = await this.request(conn, '/v2/price-types');
    const match = (data.results || []).find((t: any) => t.name?.toLowerCase() === name.toLowerCase());
    return match?.id || null;
  }

  // ─── Publicación ───────────────────────────────────────────────────────────

  private async getListingWithImages(productId: string, connectionId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { productId_connectionId_slot: { productId, connectionId, slot: 0 } },
      include: { images: { orderBy: { order: 'asc' } } },
    });
    return listing;
  }

  // Paris exige el conjunto COMPLETO de atributos de la familia al crear/actualizar un
  // producto, no solo los que el usuario llenó (mismo criterio que la doc pide para el
  // PATCH: "debes enviar toda la información relativa al producto"). Además, la
  // descripción de la pestaña Paris no es un campo aparte del producto — Paris la maneja
  // como un atributo más de la familia ("Descripción Larga/Emocional" admite HTML,
  // "Descripción corta" es texto plano), así que se inyecta ahí en vez de perderse.
  private async buildAttributesPayload(
    conn: any,
    attrs: ParisChannelAttributes,
    description: string,
  ): Promise<Array<{ id: string; value: string }>> {
    const familyAttributes = await this.getAttributes(conn, attrs.familyId);
    const savedByAttrId = new Map((attrs.attributes || []).map((a) => [a.attributeId, a]));

    return familyAttributes.map((fa) => {
      const saved = savedByAttrId.get(fa.id);
      if (saved) return { id: fa.id, value: (saved.optionId || saved.value || '').toString() };

      const nameLower = fa.name.toLowerCase();
      if (description && nameLower.includes('descripci')) {
        const isLong = nameLower.includes('larga') || nameLower.includes('emocional');
        return { id: fa.id, value: isLong ? description : stripHtml(description, 250) };
      }
      return { id: fa.id, value: '' };
    });
  }

  async publishProduct(conn: any, product: any): Promise<PublishResult> {
    const listing = await this.getListingWithImages(product.id, conn.id);
    if (!listing?.title?.trim()) {
      throw new BadRequestException('Falta el título de la publicación de Paris (pestaña "Paris" del producto)');
    }
    const attrs = (listing.channelAttributes as unknown as ParisChannelAttributes) || null;
    if (!attrs?.familyId || !attrs?.categoryId) {
      throw new BadRequestException('Falta elegir familia y categoría de Paris (pestaña "Paris" del producto)');
    }

    const listingImages = listing.images.length
      ? listing.images
      : await this.prisma.productImage.findMany({ where: { productId: product.id }, orderBy: { order: 'asc' } });
    if (!listingImages.length) {
      throw new BadRequestException('Paris exige al menos una foto (pestaña "Fotos Paris" o "Imágenes" del producto)');
    }
    const medias = await Promise.all(listingImages.map(async (img: any, i: number) => ({
      src: await toAbsoluteUrl(this.settings, img.url), position: i + 1,
    })));

    const attributesPayload = await this.buildAttributesPayload(conn, attrs, listing.description || '');

    const body = {
      product: {
        name: listing.title,
        sellerSku: product.sku,
        familyId: attrs.familyId,
        category: attrs.categoryId,
        attributes: attributesPayload,
      },
      variants: [{ medias }],
    };

    const created = await this.request(conn, '/v2/products', { method: 'POST', body: JSON.stringify(body) });
    const rootId: string = created.id;
    const variantSku: string | undefined = created.variants?.[0]?.sku;
    if (!rootId || !variantSku) {
      throw new Error('Paris no devolvió el id del producto o el SKU de la variante creada');
    }

    // Precio y stock son APIs separadas de la de creación de producto — si fallan, el
    // producto ya quedó creado en Paris (pendiente de aprobación); se loguea el error en
    // vez de hacer fallar publishProduct completo, para no confundir "no se creó" con
    // "se creó pero sin precio/stock".
    try {
      const priceTypeId = await this.getPriceTypeId(conn, 'Precio');
      const storePriceId = this.creds(conn).storePriceId;
      if (priceTypeId && storePriceId) {
        const price = await getEffectivePrice(this.prisma, product.id, conn.id, Number(product.price));
        await this.request(conn, `/v2/prices/product/${variantSku}`, {
          method: 'POST',
          body: JSON.stringify({ prices: [{ value: Math.round(price), store: storePriceId, price: priceTypeId }] }),
        });
      } else {
        this.logger.warn(`Paris publish ${rootId}: falta storePriceId en la conexión, no se envió precio`);
      }
    } catch (err: any) {
      this.logger.error(`Paris publish ${rootId}: error al enviar precio — ${err.message}`);
    }

    try {
      await this.request(conn, '/v2/stock', {
        method: 'POST',
        body: JSON.stringify({ skus: [{ sku: variantSku, quantity: Math.max(0, Math.round(Number(product.stock ?? 0))) }] }),
      });
    } catch (err: any) {
      this.logger.error(`Paris publish ${rootId}: error al enviar stock — ${err.message}`);
    }

    return { externalId: `${rootId}:${variantSku}` };
  }

  async syncListing(conn: any, externalId: string, payload: SyncPayload): Promise<void> {
    const [, variantSku] = externalId.split(':');
    if (!variantSku) {
      this.logger.warn(`Paris syncListing: externalId con formato inesperado "${externalId}"`);
      return;
    }

    await this.request(conn, '/v2/stock', {
      method: 'POST',
      body: JSON.stringify({ skus: [{ sku: variantSku, quantity: Math.max(0, Math.round(payload.stock)) }] }),
    });

    if (payload.price !== undefined) {
      const priceTypeId = await this.getPriceTypeId(conn, 'Precio');
      const storePriceId = this.creds(conn).storePriceId;
      if (priceTypeId && storePriceId) {
        await this.request(conn, `/v2/prices/product/${variantSku}`, {
          method: 'PATCH',
          body: JSON.stringify({ prices: [{ value: Math.round(payload.price), store: storePriceId, price: priceTypeId }] }),
        });
      }
    }
    this.logger.log(`Paris sync: variant=${variantSku} stock=${payload.stock}${payload.price != null ? ` price=${Math.round(payload.price)}` : ''}`);
  }

  // ─── Guardar campos/fotos de la publicación antes de publicar (borrador) ─────

  async upsertListingFields(
    productId: string,
    connectionId: string,
    dto: { title?: string; description?: string; channelAttributes?: ParisChannelAttributes },
  ) {
    return this.prisma.listing.upsert({
      where: { productId_connectionId_slot: { productId, connectionId, slot: 0 } },
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
      where: { productId_connectionId_slot: { productId, connectionId, slot: 0 } },
      update: {},
      create: { productId, connectionId },
    });
    const count = await this.prisma.listingImage.count({ where: { listingId: listing.id } });
    return this.prisma.listingImage.create({
      data: { listingId: listing.id, filename, url, order: count },
    });
  }

  async removeListingImage(listingId: string, imageId: string) {
    return this.prisma.listingImage.deleteMany({ where: { id: imageId, listingId } });
  }

  // ─── Importar catálogo existente desde Paris ─────────────────────────────────

  // OJO (verificado en vivo 2026-09-27): en /v2/products/search `offset` es el NÚMERO DE PÁGINA,
  // no la posición (offset=1 con limit=25 = productos 25-49; offset=50 ya viene vacío con 874 en
  // total). Hacia afuera `offset` sigue siendo la posición, como en el resto de los adaptadores.
  // Todo el catálogo con sus fotos (para el índice de fotos de otros canales). El SKU del
  // vendedor solo viene en el detalle, que se pide de a 5 productos.
  async listProductsWithImages(conn: any): Promise<{ sku: string | null; title: string; images: string[] }[]> {
    const found: any[] = [];
    for (let page = 0; page < 400; page++) {
      const data = await this.request(conn, `/v2/products/search?limit=50&offset=${page}`);
      const results: any[] = data?.results || [];
      found.push(...results);
      if (results.length < 50) break;
    }
    const medias = (p: any) => ((p?.variants?.[0]?.medias || []) as any[]).map((m) => m.src).filter(Boolean);
    const out: { sku: string | null; title: string; images: string[] }[] = [];
    for (let i = 0; i < found.length; i += 5) {
      const details = await Promise.all(found.slice(i, i + 5).map((r) => this.request(conn, `/v2/products/${r.id}`).catch(() => null)));
      found.slice(i, i + 5).forEach((r, j) => {
        const d = details[j];
        out.push({ sku: d?.sellerSku || null, title: d?.name || r.name, images: medias(d).length ? medias(d) : medias(r) });
      });
    }
    return out;
  }

  async previewImport(conn: any, companyId: string, offset = 0): Promise<ParisImportPreview> {
    const pageIndex = Math.floor(offset / IMPORT_PAGE_SIZE);
    const data = await this.request(conn, `/v2/products/search?limit=${IMPORT_PAGE_SIZE}&offset=${pageIndex}`);
    const results: any[] = data.results || [];
    const total: number = data.total ?? 0;
    const hasMore = results.length > 0 && (pageIndex + 1) * IMPORT_PAGE_SIZE < total;

    // sellerSku no viene en /v2/products/search (solo name/family/category/channels/
    // variants) — se completa con el detalle de cada producto del lote.
    const details = await Promise.all(
      results.map((r) => this.request(conn, `/v2/products/${r.id}`).catch(() => null)),
    );

    const skus = details.map((d) => d?.sellerSku).filter((s): s is string => !!s);
    const skuCounts = new Map<string, number>();
    for (const sku of skus) skuCounts.set(sku, (skuCounts.get(sku) || 0) + 1);

    const [existingProducts, existingListings] = await Promise.all([
      this.prisma.product.findMany({
        where: { companyId, sku: { in: skus } },
        select: { id: true, sku: true, name: true },
      }),
      this.prisma.listing.findMany({
        where: { connectionId: conn.id },
        select: { externalId: true },
      }),
    ]);
    const productBySku = new Map(existingProducts.map((p) => [p.sku, p]));
    const linkedRootIds = new Set(existingListings.map((l) => (l.externalId || '').split(':')[0]).filter(Boolean));

    const items: ParisImportItem[] = details
      .map((d, i) => ({ d, r: results[i] }))
      .filter(({ r }) => !linkedRootIds.has(r.id))
      .map(({ d, r }) => {
        const sku: string | null = d?.sellerSku || null;
        const skuSuspicious = !!sku && (skuCounts.get(sku) || 0) > 1;
        const matched = sku ? productBySku.get(sku) : undefined;
        const thumbnail = r.variants?.[0]?.medias?.[0]?.src || null;
        return {
          externalId: r.id,
          title: r.name,
          thumbnail,
          sku,
          skuSuspicious,
          matchedProductId: matched?.id || null,
          matchedProductName: matched?.name || null,
        };
      });

    const alreadyImportedCount = results.length - items.length;

    return {
      connectionName: conn.name,
      total,
      hasMore,
      nextOffset: hasMore ? (pageIndex + 1) * IMPORT_PAGE_SIZE : null,
      alreadyImportedCount,
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
    let imported = 0;
    let linked = 0;
    let skipped = 0;
    const errors: string[] = [];

    const details = await Promise.all(externalIds.map(async (id) => {
      try { return await this.request(conn, `/v2/products/${id}`); }
      catch (err: any) { errors.push(`${id}: ${err.message}`); return null; }
    }));

    const skuCountsInBatch = new Map<string, number>();
    for (const d of details) {
      if (d?.sellerSku) skuCountsInBatch.set(d.sellerSku, (skuCountsInBatch.get(d.sellerSku) || 0) + 1);
    }

    const preexistingListings = await this.prisma.listing.findMany({
      where: { connectionId: conn.id },
      select: { productId: true, externalId: true },
    });
    const linkedProductIds = new Set(preexistingListings.map((l) => l.productId));
    const linkedRootIds = new Set(preexistingListings.map((l) => (l.externalId || '').split(':')[0]).filter(Boolean));

    for (const item of details) {
      if (!item) continue;
      try {
        if (linkedRootIds.has(item.id)) { skipped++; continue; }

        const variant = item.variants?.[0];
        const variantSku: string | undefined = variant?.sku;
        if (!variantSku) { errors.push(`${item.id}: sin variante/SKU, se omite`); continue; }

        const matchedSku = item.sellerSku as string | undefined;
        const skuSuspicious = !!matchedSku && (skuCountsInBatch.get(matchedSku) || 0) > 1;
        const forceNew = unlinkSet.has(item.id) || skuSuspicious;
        const sku = (!forceNew && matchedSku) || (await this.nextSku(companyId));

        let product = forceNew ? null : await this.prisma.product.findUnique({
          where: { sku_companyId: { sku, companyId } },
        });

        if (product && linkedProductIds.has(product.id)) { skipped++; continue; }

        const priceValue = variant.prices?.find((p: any) => p.type?.name === 'Precio')?.value
          ?? variant.prices?.[0]?.value ?? 0;
        const stockValue = await this.getStock(conn, variantSku);

        if (!product) {
          product = await this.prisma.product.create({
            data: {
              sku, name: item.name, price: Number(priceValue) || 0, stock: stockValue ?? 0,
              description: extractShortDescription(item.attributes || []),
              category: item.category?.name, companyId,
            },
          });
          const medias: any[] = variant.medias || [];
          if (medias.length) {
            await this.prisma.productImage.createMany({
              data: medias.map((m: any, i: number) => ({
                productId: product!.id, url: m.src, filename: m.src.split('/').pop() || `paris-${i}.jpg`,
                isPrimary: i === 0, order: i,
              })),
            });
          }
          imported++;
        } else {
          linked++;
        }
        linkedProductIds.add(product.id);
        linkedRootIds.add(item.id);

        const attributes = (item.attributes || []).map((a: any) => ({
          attributeId: a.id, name: a.name, value: a.value, optionId: a.optionId, optionName: a.optionName,
        }));
        const description = extractDescription(item.attributes || []);
        const channelAttributes = {
          familyId: item.family?.id, familyName: item.family?.name,
          categoryId: item.category?.id, categoryPath: item.category?.src,
          attributes,
        };
        const listing = await this.prisma.listing.upsert({
          where: { productId_connectionId_slot: { productId: product.id, connectionId: conn.id, slot: 0 } },
          update: {
            externalId: `${item.id}:${variantSku}`, status: 'ACTIVE' as any, syncedAt: new Date(),
            title: item.name, description, channelAttributes: channelAttributes as any,
          },
          create: {
            productId: product.id, connectionId: conn.id,
            externalId: `${item.id}:${variantSku}`, status: 'ACTIVE' as any, syncedAt: new Date(),
            title: item.name, description, channelAttributes: channelAttributes as any,
          },
        });
        const medias: any[] = variant.medias || [];
        if (medias.length) {
          await this.prisma.listingImage.createMany({
            data: medias.map((m: any, i: number) => ({
              listingId: listing.id, url: m.src, filename: m.src.split('/').pop() || `paris-${i}.jpg`, order: i,
            })),
          });
        }
      } catch (err: any) {
        errors.push(`${item.id}: ${err.message}`);
      }
    }

    return { imported, linked, skipped, errors };
  }

  // ─── Importar ventas (sub-órdenes) ───────────────────────────────────────────
  // La importación manual crea Sale/SaleItem para historial y reportes, IGUAL que el modo
  // "recuperación histórica" de Mercado Libre (sin stock ni Orden), salvo que se pida la Orden.
  // La automática (cron) además crea la Orden y descuenta stock vía `onCreated`
  // (ChannelOrdersService). Cada fila de "items" en Paris es UNA unidad (no trae "quantity";
  // si compraron 2, aparece 2 veces) — se agrupan por sku de variante antes de armar el
  // SaleItem. El match contra el catálogo es por Listing (externalId termina en ":<sku de
  // variante>"); si no hay Listing, por sellerSku = Product.sku de la empresa.
  //
  // Verificado en vivo (2026-09-27, 600 sub-órdenes reales de "Habita2 Chile"):
  // - /v3/sub-orders trae items, statusId, dispatchCost, carrier y `origin` (paris.cl, easy.cl,
  //   kiosco: Cencosud vende por varios sitios), pero NO el seguimiento.
  // - /v2/sub-orders trae shipments[] con statusId, courier, trackingNumber, fechas comprometidas
  //   y efectivas, y el historial del courier (tracking[]), pero no `origin`. Acepta varias
  //   sub-órdenes en `subOrderNumber` separadas por coma (repitiendo el parámetro da 500).
  // - businessInvoice trae los datos de factura (razón social, RUT, giro, dirección, correo)
  //   cuando originInvoiceType = "factura".

  private async resolveOrderItems(connectionId: string, companyId: string, items: any[]) {
    const bySku = new Map<string, { count: number; unitPrice: number; title: string; sellerSku: string | null }>();
    for (const it of items || []) {
      const sku = it.sku;
      if (!sku) continue;
      const price = Number(it.priceAfterDiscounts ?? it.basePrice ?? 0);
      const cur = bySku.get(sku) || { count: 0, unitPrice: price, title: it.name, sellerSku: it.sellerSku || null };
      cur.count++;
      bySku.set(sku, cur);
    }
    let resolved = true;
    const out: Array<{ productId: string | null; quantity: number; unitPrice: number; title: string; productName: string | null; unitCost: number | null }> = [];
    for (const [sku, info] of bySku) {
      const listing = await this.prisma.listing.findFirst({
        where: { connectionId, externalId: { endsWith: `:${sku}` } },
        select: { product: { select: { id: true, name: true, cost: true } } },
      });
      const product = listing?.product ?? (info.sellerSku ? await this.prisma.product.findFirst({
        where: { companyId, sku: info.sellerSku },
        select: { id: true, name: true, cost: true },
      }) : null);
      if (!product) { resolved = false; out.push({ productId: null, quantity: info.count, unitPrice: info.unitPrice, title: info.title, productName: null, unitCost: null }); continue; }
      out.push({
        productId: product.id, quantity: info.count, unitPrice: info.unitPrice, title: info.title,
        productName: product.name, unitCost: product.cost != null ? Number(product.cost) : null,
      });
    }
    return { resolved, items: out };
  }

  // Desglose por sub-orden (GET /v3/sub-orders). Cada item es UNA unidad, agrupadas por sku igual
  // que resolveOrderItems (mismo orden):
  // - basePrice = precio de lista, priceAfterDiscounts = cobrado; ambos CON IVA. El campo `tax` NO
  //   es confiable: en datos reales a veces es el IVA incluido (× 0,19 / 1,19) y otras el 19 %
  //   calculado encima del precio de lista — el IVA se calcula siempre desde lo cobrado.
  // - commission = comisión aplicada (llega siempre en 0). Se toma como monto sin IVA.
  // - dispatchCost (sub-orden) y shippingCost (item) = despacho que PAGA EL COMPRADOR (confirmado
  //   por el usuario 2026-09-27): no es costo ni ingreso del vendedor, así que no toca el neto.
  //   Queda en el detalle de cargos solo como referencia.
  // - Unidades con cancellationReasonId o returnId (cancelada/devuelta) no suman al neto.
  private orderBreakdown(conn: any, so: any, unitCosts: (number | null)[]): SaleBreakdown & { total: number } {
    const num = (v: any) => Number(v ?? 0);
    const units: any[] = (so.items || []).filter((i: any) => i.sku);
    const isOut = (i: any) => i.cancellationReasonId != null || i.returnId != null;
    const bySku = new Map<string, any[]>();
    for (const u of units) bySku.set(u.sku, [...(bySku.get(u.sku) || []), u]);

    const activeGross = units.filter((u) => !isOut(u)).reduce((s, u) => s + num(u.priceAfterDiscounts ?? u.basePrice), 0);
    const rows: ChargeDetailRow[] = [];

    const lines: LineCalc[] = Array.from(bySku.values()).map((group) => {
      const act = group.filter((u) => !isOut(u));
      const gross = act.reduce((s, u) => s + num(u.priceAfterDiscounts ?? u.basePrice), 0);
      const revenue = sinIva(gross);
      const listGross = act.reduce((s, u) => s + num(u.basePrice ?? u.priceAfterDiscounts), 0);
      const hasCommission = act.some((u) => u.commission != null);

      for (const u of group) {
        const out = isOut(u) ? ' (cancelado/devuelto)' : '';
        const paid = num(u.priceAfterDiscounts ?? u.basePrice);
        rows.push({ type: 'PRODUCT', name: `priceAfterDiscounts${out}`, amount: paid, tax: round2(paid - sinIva(paid)) });
        const d = num(u.basePrice) - paid;
        if (d > 0) rows.push({ type: 'DISCOUNT', name: `basePrice − priceAfterDiscounts${out}`, amount: d, tax: 0 });
        if (u.commission != null) rows.push({ type: 'COMMISSION', name: `commission${out}`, amount: num(u.commission), tax: 0 });
        if (u.shippingCost != null) rows.push({ type: 'SHIPPING', name: `shippingCost (pagado por el comprador)${out}`, amount: num(u.shippingCost), tax: 0 });
      }
      return {
        title: group[0].name,
        quantity: act.length || group.length,
        revenue,
        discount: sinIva(Math.max(0, listGross - gross)),
        gross,
        commission: hasCommission ? round2(act.reduce((s, u) => s + num(u.commission), 0)) : null,
        shipping: 0,
        tax: round2(gross - revenue),
        cancelled: act.length === 0,
      };
    });
    if (so.dispatchCost != null) rows.push({ type: 'SHIPPING', name: 'dispatchCost (pagado por el comprador)', amount: num(so.dispatchCost), tax: 0 });

    return {
      total: activeGross,
      ...buildBreakdown({
        lines, unitCosts, chargeDetail: groupChargeRows(rows),
        platform: 'Paris', shippingLabel: 'Despacho (lo paga el comprador)',
      }),
    };
  }

  // Sitio de Cencosud donde se hizo la compra (Paris vende también por Easy y kioscos).
  private originLabel(origin?: string | null): string | null {
    if (!origin) return null;
    const o = origin.toLowerCase();
    return o.includes('easy') ? 'Easy' : o.includes('paris') ? 'Paris.cl' : o === 'kiosco' ? 'Kiosco Paris' : origin;
  }

  async previewSalesImport(conn: any, companyId: string, from?: string, to?: string) {
    const PAGE = 50;
    const MAX = 300;
    const params = new URLSearchParams({ limit: String(PAGE), offset: '0' });
    if (from) params.set('gteCreatedAtInOrigin', new Date(from).toISOString());
    if (to) params.set('lteCreatedAtInOrigin', new Date(`${to}T23:59:59`).toISOString());

    let offset = 0;
    let totalCount = 0;
    const subOrders: any[] = [];
    do {
      params.set('offset', String(offset));
      const data = await this.request(conn, `/v3/sub-orders?${params}`);
      totalCount = data.count || 0;
      subOrders.push(...(data.data || []));
      offset += PAGE;
    } while (offset < totalCount && subOrders.length < MAX);
    const truncated = totalCount > subOrders.length;

    const externalIds = subOrders.map((o) => o.subOrderNumber);
    const existing = await this.prisma.sale.findMany({
      where: { channel: SaleChannel.PARIS, externalId: { in: externalIds } },
      select: { id: true, externalId: true },
    });
    const existingById = new Map(existing.map((s) => [s.externalId, s.id]));

    const orders = [];
    for (const so of subOrders) {
      const saleId = existingById.get(so.subOrderNumber);
      const { resolved, items } = await this.resolveOrderItems(conn.id, companyId, so.items || []);
      const { total, ...b } = this.orderBreakdown(conn, so, items.map((i) => i.unitCost));
      // Recalcula cargos/neto (sin IVA) de ventas ya importadas con los datos de este mismo listado.
      if (saleId) await backfillSale(this.prisma, saleId, b, items.map((i) => i.productId));
      const origin = this.originLabel(so.origin);
      orders.push({
        externalId: so.subOrderNumber,
        date: so.originOrderDate,
        total,
        ...b,
        buyerName: [so.customer?.name, origin && `vía ${origin}`].filter(Boolean).join(' · ') || null,
        marketplaceStatus: this.statusOf(so.statusId)[1],
        items: previewItems(items, b),
        importable: !saleId && resolved && items.length > 0,
        alreadyRegistered: !!saleId,
      });
    }
    const alreadyImportedCount = orders.filter((o) => o.alreadyRegistered).length;

    return { connectionName: conn.name, total: totalCount, truncated, alreadyImportedCount, orders };
  }

  // statusId de la sub-orden / despacho. Paris no publica el catálogo ni tiene endpoint para
  // consultarlo: deducido en vivo cruzando cada statusId con el último evento del courier.
  private static readonly STATUS: Record<number, [ChannelOrderStatus | null, string]> = {
    8: ['PENDING', 'Listo para despacho'],
    14: ['SHIPPED', 'En tránsito'],
    24: ['SHIPPED', 'Entrega parcial'],
    4: ['DELIVERED', 'Entregado'],
    21: ['DELIVERED', 'Entregado'],
    18: ['CANCELLED', 'Cancelado'],
    22: ['CANCELLED', 'Devuelto al vendedor'],
    72: ['CANCELLED', 'Devuelto al vendedor'],
  };

  private statusOf(statusId: any): [ChannelOrderStatus | null, string] {
    return ParisAdapter.STATUS[Number(statusId)] ?? [null, `Estado ${statusId ?? 'desconocido'}`];
  }

  private shipmentsOf(soV2: any): any[] {
    return ([] as any[]).concat(soV2?.shipments || []).filter(Boolean);
  }

  // Estado de la sub-orden. `so` puede ser de /v3 (statusId en la raíz, sin seguimiento) o de
  // /v2 (statusId, courier y seguimiento por despacho); `soV2` agrega el seguimiento a una de /v3.
  private orderState(so: any, soV2?: any): ChannelOrderState {
    const shipments = this.shipmentsOf(soV2 ?? so);
    const shipment = shipments.find((sh) => sh.trackingNumber || sh.carrier) || shipments[0] || {};
    const statusId = so.statusId ?? shipment.statusId;
    let [status, label] = this.statusOf(statusId);
    // Estado no reconocido: se muestra el último evento del courier, que viene en español.
    const events = ([] as any[]).concat(shipment.tracking || [])
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    if (status == null && events.length) label = events[events.length - 1].name || label;
    const units: any[] = (so.items || shipments.flatMap((sh) => sh.items || [])).filter((i: any) => i.sku);
    if (units.length && units.every((i) => i.cancellationReasonId != null)) status = 'CANCELLED';
    const date = (v: any) => { const d = v ? new Date(v) : null; return d && !isNaN(d.getTime()) ? d : null; };
    return {
      status,
      label,
      courier: shipment.carrier || so.carrier || null,
      trackingCode: shipment.trackingNumber ? String(shipment.trackingNumber) : null,
      shippedAt: date(shipment.effectiveDispatchDate),
      deliveredAt: date(shipment.effectiveArrivalDate),
    };
  }

  private async fetchV2(conn: any, ids: string[]): Promise<Map<string, any>> {
    const out = new Map<string, any>();
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const data = await this.request(conn, `/v2/sub-orders?limit=100&offset=0&subOrderNumber=${chunk.map(encodeURIComponent).join(',')}`);
      for (const so of data?.data || []) out.set(String(so.subOrderNumber), so);
    }
    return out;
  }

  async getOrderStates(conn: any, externalIds: string[]): Promise<Map<string, ChannelOrderState>> {
    const out = new Map<string, ChannelOrderState>();
    for (const [id, so] of await this.fetchV2(conn, externalIds)) out.set(id, this.orderState(so));
    return out;
  }

  // Regiones que Paris informa como "regionN"; otras veces llegan como texto ("REGION BIO BIO").
  private static readonly REGIONS: Record<string, string> = {
    region1: 'Tarapacá', region2: 'Antofagasta', region3: 'Atacama', region4: 'Coquimbo', region5: 'Valparaíso',
    region6: 'O’Higgins', region7: 'Maule', region8: 'Biobío', region9: 'La Araucanía', region10: 'Los Lagos',
    region11: 'Aysén', region12: 'Magallanes', region13: 'Metropolitana', region14: 'Los Ríos',
    region15: 'Arica y Parinacota', region16: 'Ñuble',
  };

  private regionName(code?: string | null): string | null {
    if (!code) return null;
    const known = ParisAdapter.REGIONS[code.toLowerCase()];
    if (known) return known;
    const text = code.replace(/^regi[oó]n\s+/i, '').toLowerCase();
    return text.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  }

  // Factura: el comprador queda como Cliente (por RUT) para emitirle el documento con sus datos.
  private async upsertBusinessClient(tx: any, companyId: string, bi: any): Promise<string | null> {
    const rut = normalizeRut(bi?.companyRut);
    if (!rut || !bi?.businessName) return null;
    const existing = await tx.client.findFirst({ where: { companyId, rut }, select: { id: true } });
    if (existing) return existing.id;
    const created = await tx.client.create({
      data: {
        companyId, rut, name: bi.businessName, giro: bi.businessArea || null, email: bi.email || null,
        address: bi.address || null, commune: bi.comuna || null, city: this.regionName(bi.region) || null,
      },
    });
    return created.id;
  }

  async confirmSalesImport(conn: any, companyId: string, externalOrderIds: string[], onCreated?: OnSaleCreated) {
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Seguimiento de todas las sub-órdenes en una sola pasada (/v2 acepta varias por llamada).
    let v2 = new Map<string, any>();
    try {
      v2 = await this.fetchV2(conn, externalOrderIds);
    } catch (err: any) {
      this.logger.warn(`Paris: no se pudo traer el seguimiento de las sub-órdenes: ${err.message}`);
    }

    for (const id of externalOrderIds) {
      try {
        const existing = await this.prisma.sale.findFirst({ where: { channel: SaleChannel.PARIS, externalId: id } });
        if (existing) { skipped++; continue; }

        const data = await this.request(conn, `/v3/sub-orders?subOrderNumber=${encodeURIComponent(id)}`);
        const so = (data.data || []).find((x: any) => String(x.subOrderNumber) === id);
        if (!so) { errors.push(`${id}: no se encontró en Paris`); continue; }

        const { resolved, items } = await this.resolveOrderItems(conn.id, companyId, so.items || []);
        if (!resolved || !items.length) { errors.push(`${id}: uno o más productos no están vinculados en el catálogo`); continue; }

        const { total, ...b } = this.orderBreakdown(conn, so, items.map((i) => i.unitCost));
        const soV2 = v2.get(id);
        const state = this.orderState(so, soV2);
        const shipment = this.shipmentsOf(soV2)[0] || {};
        const addr = so.shippingAddress || shipment.shippingAddress || {};
        const address = [addr.address1, addr.address2, addr.address3].filter(Boolean).join(', ') || null;
        const region = this.regionName(addr.stateCode);
        const phone = addr.phone || so.customer?.phone || null;
        const isFactura = String(so.originInvoiceType || '').toLowerCase() === 'factura';
        const origin = this.originLabel(so.origin);
        const fmtDay = (v: any) => (v ? new Date(`${String(v).slice(0, 10)}T12:00:00`).toLocaleDateString('es-CL') : null);
        const notes = [
          origin && `Compra en ${origin}`,
          `Documento solicitado: ${isFactura ? 'factura' : 'boleta'}`,
          !isFactura && so.customer?.documentNumber && `RUT comprador: ${normalizeRut(so.customer.documentNumber)}`,
          addr.pickUpStoreId && `Retiro en tienda/punto${addr.pickUpStore?.name ? `: ${addr.pickUpStore.name}` : ''}`,
          so.deliveryOption?.translate && `Entrega: ${so.deliveryOption.translate}`,
          shipment.dispatchDate && `Despachar el ${fmtDay(shipment.dispatchDate)}`,
          shipment.arrivalDate && `Llegada comprometida ${fmtDay(shipment.arrivalDate)}`,
          state.trackingCode && `Seguimiento ${state.courier || ''} ${state.trackingCode}`.replace(/\s+/g, ' '),
        ].filter(Boolean).join(' · ');

        await this.prisma.$transaction(async (tx) => {
          const clientId = isFactura ? await this.upsertBusinessClient(tx, companyId, so.businessInvoice) : null;
          const sale = await tx.sale.create({
            data: {
              channel: SaleChannel.PARIS,
              externalId: id,
              total,
              ...b.charges,
              companyId,
              connectionId: conn.id,
              clientId,
              customerName: so.customer?.name || null,
              customerEmail: so.customer?.email || null,
              customerPhone: phone,
              fulfillmentType: FulfillmentType.DELIVERY,
              shippingMethod: state.courier,
              address,
              commune: addr.city || null,
              city: region,
              notes: notes || null,
              createdAt: new Date(so.originOrderDate),
              items: { create: items.map((i, idx) => ({ productId: i.productId!, quantity: i.quantity, unitPrice: i.unitPrice, netAmount: b.lines[idx]?.net })) },
            },
            include: { items: true },
          });
          if (onCreated) {
            await onCreated(tx, {
              sale, externalId: id, state,
              cancelledProductIds: items.filter((_, idx) => b.lines[idx]?.cancelled).map((i) => i.productId!),
              customer: { name: so.customer?.name, email: so.customer?.email, phone, address, commune: addr.city, region },
            });
          }
        });
        imported++;
      } catch (err: any) {
        errors.push(`${id}: ${err.message}`);
      }
    }

    return { imported, skipped, errors };
  }

  // Usado por el cron de auto-sync: trae solo lo reciente (desde la última corrida, con 2
  // min de solapamiento por si algo quedó justo en el borde) y confirma directo lo que se
  // pueda resolver — sin preview, porque no hay usuario mirando la pantalla. Actualiza
  // lastSalesImportAt al final, igual que el auto-sync de Mercado Libre, para que el cron
  // sepa desde cuándo seguir la próxima vez.
  async importRecentSales(conn: any, companyId: string, onCreated?: OnSaleCreated): Promise<{ imported: number; skipped: number; errors: number }> {
    const from = conn.lastSalesImportAt
      ? new Date(new Date(conn.lastSalesImportAt).getTime() - 2 * 60 * 1000).toISOString()
      : new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const to = new Date();

    const preview = await this.previewSalesImport(conn, companyId, from);
    const ids = preview.orders.filter((o) => o.importable).map((o) => o.externalId);
    const res = ids.length
      ? await this.confirmSalesImport(conn, companyId, ids, onCreated)
      : { imported: 0, skipped: 0, errors: [] as string[] };

    await this.prisma.marketplaceConnection.update({ where: { id: conn.id }, data: { lastSalesImportAt: to } });
    return { imported: res.imported, skipped: res.skipped, errors: res.errors.length };
  }
}

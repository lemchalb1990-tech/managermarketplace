import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAdapter, SyncPayload, PublishResult } from './platform.interface';
import { getEffectivePrice } from '../../common/effective-price.util';

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

  constructor(private prisma: PrismaService) {}

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
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const message = data?.message || `Paris respondió HTTP ${res.status} en ${path}`;
      throw new Error(Array.isArray(message) ? message.join(', ') : message);
    }
    return data;
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
      where: { productId_connectionId: { productId, connectionId } },
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
    const medias = listingImages.map((img: any, i: number) => ({ src: img.url, position: i + 1 }));

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
    return this.prisma.listingImage.create({
      data: { listingId: listing.id, filename, url, order: count },
    });
  }

  async removeListingImage(listingId: string, imageId: string) {
    return this.prisma.listingImage.deleteMany({ where: { id: imageId, listingId } });
  }

  // ─── Importar catálogo existente desde Paris ─────────────────────────────────

  async previewImport(conn: any, companyId: string, offset = 0): Promise<ParisImportPreview> {
    const data = await this.request(conn, `/v2/products/search?limit=${IMPORT_PAGE_SIZE}&offset=${offset}`);
    const results: any[] = data.results || [];
    const total: number = data.total ?? 0;
    const hasMore = offset + results.length < total;

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
      nextOffset: hasMore ? offset + IMPORT_PAGE_SIZE : null,
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
        const listing = await this.prisma.listing.upsert({
          where: { productId_connectionId: { productId: product.id, connectionId: conn.id } },
          update: {
            externalId: `${item.id}:${variantSku}`, status: 'ACTIVE' as any, syncedAt: new Date(),
            title: item.name, channelAttributes: {
              familyId: item.family?.id, familyName: item.family?.name,
              categoryId: item.category?.id, categoryPath: item.category?.src,
              attributes,
            } as any,
          },
          create: {
            productId: product.id, connectionId: conn.id,
            externalId: `${item.id}:${variantSku}`, status: 'ACTIVE' as any, syncedAt: new Date(),
            title: item.name, channelAttributes: {
              familyId: item.family?.id, familyName: item.family?.name,
              categoryId: item.category?.id, categoryPath: item.category?.src,
              attributes,
            } as any,
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
}

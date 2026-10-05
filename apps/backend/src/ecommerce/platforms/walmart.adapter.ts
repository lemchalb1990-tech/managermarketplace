import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SaleChannel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { toAbsoluteUrl } from '../../common/absolute-url.util';
import { getEffectivePrice } from '../../common/effective-price.util';
import { PlatformAdapter, SyncPayload, PublishResult } from './platform.interface';
import { SaleBreakdown, ChargeDetailRow, LineCalc, groupChargeRows, round2, buildBreakdown, backfillSale, previewItems } from './sale-breakdown';
import { ChannelOrderState, ChannelOrderStatus, OnSaleCreated, combineLineStatuses, joinLabels } from './channel-order';

// Walmart Chile (Líder) corre sobre la misma "Global Marketplace API" que Walmart US/CA/MX
// (`https://marketplace.walmartapis.com`) — NO existe una API propia de Líder aparte.
// Confirmado en vivo contra la cuenta real (seller "Habita2 Chile" en WALMART_CL).
//
// El bloqueo histórico ("INVALID_REQUEST_HEADER.GMP_GATEWAY_API" / "Incorrect Authorization
// header", que se veía SIEMPRE sin importar cuántas veces se regeneraran las credenciales)
// NO era un problema del Client ID/Secret: faltaba el header `WM_MARKET: cl` en la petición
// de token. Sin ese header, el gateway valida las credenciales contra el mercado "us" por
// defecto y las rechaza porque este Client ID/Secret están registrados para "cl". Con el
// header agregado, la autenticación funciona de inmediato. Este mismo header (`WM_MARKET`)
// hay que mandarlo también en cada llamada posterior (no solo en el token).
const BASE = 'https://marketplace.walmartapis.com';
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const DEFAULT_TOKEN_TTL_SECONDS = 900; // Walmart documenta 15 minutos de vida del token.
const IMPORT_PAGE_SIZE = 50;

interface WalmartAuth {
  accessToken: string;
  expiresAt: Date;
}

// Cache en memoria del proceso, igual patrón que ParisAdapter — el token dura 15 minutos,
// no vale la pena persistirlo en DB.
const tokenCache = new Map<string, WalmartAuth>();

export interface WalmartImportItem {
  externalId: string; // = sku (Walmart lo usa igual que nuestro Product.sku)
  title: string;
  thumbnail: string | null; // GET /v3/items no devuelve imagen — queda siempre null.
  sku: string | null;
  skuSuspicious: boolean;
  matchedProductId: string | null;
  matchedProductName: string | null;
}

@Injectable()
export class WalmartAdapter implements PlatformAdapter {
  private readonly logger = new Logger(WalmartAdapter.name);

  constructor(private prisma: PrismaService, private settings: SettingsService) {}

  private creds(conn: any): any {
    return (conn.credentials as any) || {};
  }

  private async authenticate(conn: any): Promise<WalmartAuth> {
    const { clientId, clientSecret } = this.creds(conn);
    if (!clientId || !clientSecret) throw new Error('Faltan Client ID/Client Secret de Walmart');
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const res = await fetch(`${BASE}/v3/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'WM_MARKET': 'cl',
        'WM_SVC.NAME': 'Walmart Marketplace',
        'WM_QOS.CORRELATION_ID': crypto.randomUUID(),
      },
      body: 'grant_type=client_credentials',
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.[0]?.description || data?.error_description || `HTTP ${res.status}`;
      throw new Error(`Walmart rechazó la autenticación: ${msg}`);
    }
    const ttlSeconds = Number(data.expires_in) > 0 ? Number(data.expires_in) : DEFAULT_TOKEN_TTL_SECONDS;
    return { accessToken: data.access_token, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
  }

  private async token(conn: any): Promise<string> {
    const cached = tokenCache.get(conn.id);
    if (cached && cached.expiresAt.getTime() - Date.now() > TOKEN_REFRESH_MARGIN_MS) return cached.accessToken;
    const auth = await this.authenticate(conn);
    tokenCache.set(conn.id, auth);
    return auth.accessToken;
  }

  private async request(conn: any, path: string, init: RequestInit = {}): Promise<any> {
    const doFetch = async (accessToken: string) => fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'WM_MARKET': 'cl',
        'WM_SVC.NAME': 'Walmart Marketplace',
        'WM_QOS.CORRELATION_ID': crypto.randomUUID(),
        ...(init.headers || {}),
        'WM_SEC.ACCESS_TOKEN': accessToken,
      },
    });

    let accessToken = await this.token(conn);
    let res = await doFetch(accessToken);
    if (res.status === 401) {
      tokenCache.delete(conn.id);
      accessToken = await this.token(conn);
      res = await doFetch(accessToken);
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const msg = data?.error?.[0]?.description || data?.errors?.error?.[0]?.description || `HTTP ${res.status} en ${path}`;
      throw new Error(`Walmart: ${msg}`);
    }
    return data;
  }

  async testConnection(conn: any): Promise<{ success: boolean; message?: string }> {
    try {
      const data = await this.request(conn, '/v3/items?limit=1');
      return { success: true, message: `Conectado (${data?.totalItems ?? 0} publicaciones en Walmart)` };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  async getStock(conn: any, sku: string): Promise<number> {
    const data = await this.request(conn, `/v3/inventory?sku=${encodeURIComponent(sku)}`);
    return Number(data?.quantity?.amount ?? 0);
  }

  // ─── Sync (stock/precio) para listings ya vinculados ─────────────────────────
  // Confirmado en vivo SOLO la lectura (GET /v3/inventory, GET /v3/items). La escritura
  // nunca se probó (hubiera modificado stock/precio reales del cliente en producción sin
  // autorización): `PUT /v3/inventory?sku=` para stock y `PUT /v3/price` para precio son la
  // forma documentada públicamente por Walmart para actualizar un solo SKU sin pasar por el
  // feed asíncrono — si el primer sync real falla, revisar el mensaje de error de Walmart
  // primero (probablemente venga en `error[0].description`, mismo shape ya visto en /v3/token
  // y /v3/orders).
  async syncListing(conn: any, externalId: string, payload: SyncPayload): Promise<void> {
    await this.request(conn, `/v3/inventory?sku=${encodeURIComponent(externalId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: externalId,
        quantity: { unit: 'EACH', amount: Math.max(0, Math.round(payload.stock)) },
      }),
    });

    if (payload.price != null) {
      await this.request(conn, '/v3/price', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku: externalId,
          pricing: [{ currentPrice: { currency: 'CLP', amount: Math.round(payload.price) }, currentPriceType: 'BASE' }],
        }),
      });
    }
    this.logger.log(`Walmart sync: sku=${externalId} stock=${payload.stock}${payload.price != null ? ` price=${Math.round(payload.price)}` : ''}`);
  }

  // ─── Publicación de productos nuevos ──────────────────────────────────────────
  // NO implementado: crear un producto nuevo en Walmart exige enviar un feed asíncrono
  // (`POST /v3/feeds?feedType=MP_ITEM`) cuyo JSON debe cumplir el "Item Spec" específico de
  // la categoría (productType) — el set de atributos obligatorios cambia por categoría y
  // Walmart lo expone por una API de specs aparte que no se llegó a probar. Publicar sin eso
  // arriesgaría feeds rechazados (o mal cargados) en la cuenta real del cliente. Por ahora
  // esta integración cubre sincronización de stock/precio e importación de catálogo/ventas
  // ya existentes — mismo punto de partida con el que arrancaron Ripley y Falabella antes de
  // tener publish.
  // La publicación es asíncrona (feed): se hace desde la pestaña "Walmart" del producto
  // (submitItemFeed + checkItemFeed), no desde el flujo genérico de "Publicar".
  async publishProduct(_conn: any, _product: any): Promise<PublishResult> {
    throw new BadRequestException(
      'En Walmart la publicación se hace desde la pestaña "Walmart" del producto: completa sus datos y presiona "Publicar en Walmart".',
    );
  }

  // ─── Publicar en Walmart Chile (feed MP_ITEM_INTL) ────────────────────────────
  // Formato VALIDADO en vivo (cuenta real, feed aceptado ok=1): la API no entrega el esquema
  // de Chile, se obtuvo de los errores del feed. Header: version 4.46 + mart WALMART_CHILE
  // (con WALMART_CL responde "versión no encontrada"). Campos generales en `Orderable` y los de
  // la categoría (en español; validada "Muebles") en `Visible.<Categoría>`. Ojo con nombres
  // exactos: shippingDimensionsHeight va con minúscula inicial. Si el GTIN ya existe en el
  // catálogo de Walmart, la oferta se asocia a ESA ficha (nombre/fotos de Walmart).

  async upsertListingFields(productId: string, connectionId: string, dto: { title?: string; description?: string; channelAttributes?: any }) {
    const current = await this.prisma.listing.findUnique({ where: { productId_connectionId_slot: { productId, connectionId, slot: 0 } } });
    // Se conserva el seguimiento del feed (feedId/estado/errores) al guardar el formulario.
    const prev: any = current?.channelAttributes || {};
    const merged = dto.channelAttributes !== undefined
      ? { ...dto.channelAttributes, feed: prev.feed ?? dto.channelAttributes?.feed }
      : undefined;
    return this.prisma.listing.upsert({
      where: { productId_connectionId_slot: { productId, connectionId, slot: 0 } },
      update: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(merged !== undefined ? { channelAttributes: merged } : {}),
      },
      create: { productId, connectionId, title: dto.title, description: dto.description, channelAttributes: merged, status: 'DRAFT' as any },
      include: { images: { orderBy: { order: 'asc' } } },
    });
  }

  async addListingImage(productId: string, connectionId: string, filename: string, url: string) {
    const listing = await this.prisma.listing.upsert({
      where: { productId_connectionId_slot: { productId, connectionId, slot: 0 } }, update: {}, create: { productId, connectionId, status: 'DRAFT' as any },
    });
    const count = await this.prisma.listingImage.count({ where: { listingId: listing.id } });
    return this.prisma.listingImage.create({ data: { listingId: listing.id, filename, url, order: count } });
  }

  async removeListingImage(listingId: string, imageId: string) {
    return this.prisma.listingImage.deleteMany({ where: { id: imageId, listingId } });
  }

  private buildItemFeed(product: any, listing: any, a: any, price: number, images: string[]) {
    const num = (v: any) => (v === '' || v == null || isNaN(Number(v)) ? undefined : Number(v));
    const list = (v: any) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((x: any) => String(x).trim()).filter(Boolean);
    const dim = (v: any, unit: string) => (num(v) != null ? { measure: num(v), unit } : undefined);
    const clean = (o: any) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)));
    const category = String(a.category || 'Muebles').trim();
    const keyFeatures = list(String(a.keyFeatures ?? '').split('\n').join(','));
    const warrantyOn = a.warrantyEnabled !== false;
    return {
      MPItemFeedHeader: { version: '4.46', mart: 'WALMART_CHILE', locale: 'es', sellingChannel: 'marketplace', processMode: 'REPLACE', subset: 'EXTERNAL' },
      MPItem: [{
        Orderable: clean({
          sku: product.sku,
          productIdentifiers: { productIdType: 'GTIN', productId: String(a.gtin || product.barcode || '').replace(/\D/g, '').padStart(14, '0') },
          productName: (listing.title || product.name || '').trim(),
          brand: a.brand,
          price: Math.round(price),
          ShippingWeight: num(a.shippingWeightKg) ?? 1,
          pricePerUnit: { pricePerUnitQuantity: 1, pricePerUnitUom: a.pricePerUnitUom || 'un' },
          shortDescription: (listing.description || product.description || listing.title || product.name || '').trim().slice(0, 4000),
          keyFeatures: keyFeatures.length ? keyFeatures : undefined,
          mainImageUrl: images[0],
          productSecondaryImageURL: images.slice(1).length ? images.slice(1) : images.slice(0, 1),
          manufacturer: a.manufacturer || a.brand,
          condition: a.condition || 'Nuevo',
          countryOfOriginAssembly: list(a.countryOfOrigin),
          ShippingDimensionsWidth: dim(a.shipWidthCm, 'cm'),
          ShippingDimensionsDepth: dim(a.shipDepthCm, 'cm'),
          shippingDimensionsHeight: dim(a.shipHeightCm, 'cm'),
          sellerWarranty: warrantyOn ? 'Sí' : 'No',
          warrantyText: warrantyOn ? a.warrantyText : undefined,
          sellerWarrantyCondition: warrantyOn ? a.warrantyCondition : undefined,
          sellerWarrantyPeriod: warrantyOn ? num(a.warrantyMonths) : undefined,
        }),
        Visible: {
          [category]: clean({
            color: list(a.color),
            material: list(a.material),
            isAssemblyRequired: a.isAssemblyRequired || 'No',
            modelNumber: a.modelNumber || product.sku,
            assembledProductHeight: dim(a.heightCm, 'cm'),
            assembledProductWidth: dim(a.widthCm, 'cm'),
            assembledProductLength: dim(a.lengthCm, 'cm'),
            assembledProductWeight: dim(a.weightKg, 'kg'),
          }),
        },
      }],
    };
  }

  // Envía el feed de publicación y deja su seguimiento en la publicación (estado DRAFT hasta que Walmart lo procese).
  async submitItemFeed(conn: any, productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, include: { images: { orderBy: { order: 'asc' } } } });
    if (!product) throw new BadRequestException('Producto no encontrado');
    const listing = await this.prisma.listing.findUnique({
      where: { productId_connectionId_slot: { productId, connectionId: conn.id, slot: 0 } }, include: { images: { orderBy: { order: 'asc' } } },
    });
    const a: any = listing?.channelAttributes || {};
    const missing: string[] = [];
    const gtin = String(a.gtin || product.barcode || '').replace(/\D/g, '');
    if (gtin.length < 8) missing.push('código de barras (GTIN/EAN)');
    if (!a.brand) missing.push('marca');
    if (!a.countryOfOrigin) missing.push('país de origen');
    if (!a.color) missing.push('color');
    if (!a.material) missing.push('material');
    for (const [k, label] of [['heightCm', 'alto'], ['widthCm', 'ancho'], ['lengthCm', 'largo'], ['weightKg', 'peso'], ['shipWidthCm', 'ancho de envío'], ['shipDepthCm', 'profundidad de envío'], ['shipHeightCm', 'alto de envío']]) {
      if (!(Number(a[k]) > 0)) missing.push(label);
    }
    if (a.warrantyEnabled !== false && (!a.warrantyText || !a.warrantyCondition || !(Number(a.warrantyMonths) > 0))) missing.push('garantía (texto, condiciones y meses)');
    const imgs = listing?.images?.length ? listing.images : product.images;
    if (imgs.length < 2) missing.push('al menos 2 fotos (Walmart exige principal y secundaria)');
    if (missing.length) throw new BadRequestException(`Faltan datos para publicar en Walmart: ${missing.join(', ')}.`);

    const images = await Promise.all(imgs.map((i: any) => toAbsoluteUrl(this.settings, i.url)));
    const price = await getEffectivePrice(this.prisma, product.id, conn.id, Number(product.price));
    const payload = this.buildItemFeed(product, listing || {}, a, price, images);

    const form = new FormData();
    form.append('file', new Blob([JSON.stringify(payload)], { type: 'application/json' }), 'item.json');
    const res = await this.request(conn, '/v3/feeds?feedType=MP_ITEM_INTL', { method: 'POST', body: form as any });
    const feedId = res?.feedId;
    if (!feedId) throw new BadRequestException('Walmart no devolvió el número de feed.');

    const feed = { feedId, status: 'RECEIVED', submittedAt: new Date().toISOString(), errors: [] as string[] };
    await this.prisma.listing.upsert({
      where: { productId_connectionId_slot: { productId, connectionId: conn.id, slot: 0 } },
      update: { channelAttributes: { ...a, feed } as any, errorMsg: null },
      create: { productId, connectionId: conn.id, status: 'DRAFT' as any, channelAttributes: { ...a, feed } as any },
    });
    this.logger.log(`Walmart publicar: sku=${product.sku} feed=${feedId}`);
    return feed;
  }

  // Consulta el feed: si Walmart aceptó el ítem, la publicación queda ACTIVA (externalId = sku)
  // y se envía el stock; si no, guarda los errores de Walmart (en español) para corregir.
  async checkItemFeed(conn: any, productId: string) {
    const listing = await this.prisma.listing.findUnique({ where: { productId_connectionId_slot: { productId, connectionId: conn.id, slot: 0 } }, include: { product: true } });
    const a: any = listing?.channelAttributes || {};
    if (!listing || !a.feed?.feedId) throw new BadRequestException('Este producto no tiene un envío a Walmart pendiente.');
    const d = await this.request(conn, `/v3/feeds/${encodeURIComponent(a.feed.feedId)}?includeDetails=true`);
    const status = String(d?.feedStatus || 'RECEIVED');
    const fileErrors = (d?.ingestionErrors?.ingestionError || []).map((e: any) => String(e.description));
    const item = d?.itemDetails?.itemIngestionStatus?.[0];
    const itemErrors = (item?.ingestionErrors?.ingestionError || []).map((e: any) => `${e.field}: ${String(e.description).split('. Enter')[0]}`);
    const ok = Number(d?.itemsSucceeded || 0) > 0;
    const done = !['RECEIVED', 'INPROGRESS'].includes(status);
    const feed = { ...a.feed, status: ok ? 'OK' : done ? 'ERROR' : status, checkedAt: new Date().toISOString(), errors: [...fileErrors, ...itemErrors], wpid: item?.wpid || null };
    await this.prisma.listing.update({
      where: { id: listing.id },
      data: {
        channelAttributes: { ...a, feed } as any,
        ...(ok ? { status: 'ACTIVE' as any, externalId: listing.product.sku, syncedAt: new Date(), errorMsg: null } : {}),
        ...(done && !ok ? { status: 'ERROR' as any, errorMsg: feed.errors.join(' | ').slice(0, 2000) || 'Walmart rechazó la publicación' } : {}),
      },
    });
    if (ok) {
      try { await this.syncListing(conn, listing.product.sku, { stock: listing.product.stock }); }
      catch (err: any) { this.logger.warn(`Walmart stock tras publicar ${listing.product.sku}: ${err.message}`); }
    }
    return feed;
  }

  // ─── Importar catálogo existente desde Walmart ────────────────────────────────
  // GET /v3/items no trae imágenes, así que el catálogo importado queda sin fotos (se pueden
  // agregar luego a mano, igual que si vinieran de un archivo sin fotos).

  private normalizeItem(it: any) {
    let category: string | null = null;
    try {
      const shelf = JSON.parse(it.shelf || '[]');
      category = Array.isArray(shelf) && shelf.length ? shelf[shelf.length - 1] : null;
    } catch { /* shelf no siempre viene, o no es JSON válido */ }
    return {
      sku: it.sku as string,
      name: it.productName as string,
      category,
      price: Number(it.price?.amount ?? 0),
    };
  }

  async previewImport(conn: any, companyId: string, offset = 0) {
    const data = await this.request(conn, `/v3/items?limit=${IMPORT_PAGE_SIZE}&offset=${offset}`);
    const raw = Array.isArray(data?.ItemResponse) ? data.ItemResponse : [];
    const results = raw.map((it: any) => this.normalizeItem(it));
    const totalItems = Number(data?.totalItems ?? 0);
    const hasMore = offset + results.length < totalItems;

    const skus = results.map((r) => r.sku).filter(Boolean);
    const skuCounts = new Map<string, number>();
    for (const sku of skus) skuCounts.set(sku, (skuCounts.get(sku) || 0) + 1);

    const [existingProducts, existingListings] = await Promise.all([
      this.prisma.product.findMany({ where: { companyId, sku: { in: skus } }, select: { id: true, sku: true, name: true } }),
      this.prisma.listing.findMany({ where: { connectionId: conn.id }, select: { externalId: true } }),
    ]);
    const productBySku = new Map(existingProducts.map((p) => [p.sku, p]));
    const linkedIds = new Set(existingListings.map((l) => l.externalId).filter(Boolean));

    const items: WalmartImportItem[] = results
      .filter((r) => !linkedIds.has(r.sku))
      .map((r) => {
        const skuSuspicious = (skuCounts.get(r.sku) || 0) > 1;
        const matched = productBySku.get(r.sku);
        return {
          externalId: r.sku, title: r.name, thumbnail: null, sku: r.sku, skuSuspicious,
          matchedProductId: matched?.id || null, matchedProductName: matched?.name || null,
        };
      });

    return {
      connectionName: conn.name, total: totalItems, hasMore,
      nextOffset: hasMore ? offset + IMPORT_PAGE_SIZE : null,
      alreadyImportedCount: results.length - items.length,
      items,
    };
  }

  // ─── Fotos del ítem ───────────────────────────────────────────────────────────
  // GET /v3/items (listado) no trae imágenes. Se buscan, en orden, en: el detalle del ítem
  // (/v3/items/{sku}, con y sin includeDetails) y la búsqueda en el catálogo de Walmart por
  // GTIN/UPC (GET y POST /v3/items/walmart/search, como en Walmart US/MX/CA). De cada respuesta
  // se toman las URLs de imagen que aparezcan (claves con "image" o URLs .jpg/.png/.webp).

  private collectImageUrls(node: any, out: Set<string>, keyHint = '', depth = 0): void {
    if (node == null || depth > 8) return;
    if (typeof node === 'string') {
      const v = node.trim();
      if (/^https?:\/\//i.test(v) && (/image|img/i.test(keyHint) || /\.(jpe?g|png|webp)(\?|$)/i.test(v))) out.add(v);
      return;
    }
    if (Array.isArray(node)) { for (const n of node) this.collectImageUrls(n, out, keyHint, depth + 1); return; }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) this.collectImageUrls(v, out, `${keyHint} ${k}`, depth + 1);
    }
  }

  // Intenta cada fuente y devuelve las URLs encontradas (y, para el diagnóstico, qué respondió cada una).
  // mode 'first': se detiene en la primera fuente con fotos (miniatura de la vista previa).
  // mode 'all': junta las fotos de todas las fuentes, sin repetir (al importar).
  async findItemImages(conn: any, sku: string, raw?: any, mode: 'first' | 'all' = 'all'): Promise<{ images: string[]; attempts: { source: string; ok: boolean; info: string; images: number }[] }> {
    const attempts: { source: string; ok: boolean; info: string; images: number }[] = [];
    const found = new Set<string>();
    const tryCall = async (source: string, fn: () => Promise<any>, pick?: (data: any) => any) => {
      if (mode === 'first' && found.size) return;
      try {
        const data = await fn();
        const target = pick ? pick(data) : data;
        const local = new Set<string>();
        this.collectImageUrls(target, local);
        local.forEach((u) => found.add(u));
        const keys = data && typeof data === 'object' ? Object.keys(Array.isArray(data) ? data[0] || {} : data).slice(0, 12).join(',') : String(data).slice(0, 80);
        attempts.push({ source, ok: true, info: `claves: ${keys}`, images: local.size });
      } catch (err: any) {
        attempts.push({ source, ok: false, info: String(err?.message || err).slice(0, 200), images: 0 });
      }
    };

    const enc = encodeURIComponent(sku);
    let item = raw;
    await tryCall('GET /v3/items/{sku}', async () => {
      const d = await this.request(conn, `/v3/items/${enc}`);
      item = item || (Array.isArray(d?.ItemResponse) ? d.ItemResponse[0] : d);
      return d;
    });
    await tryCall('GET /v3/items/{sku}?includeDetails=true', () => this.request(conn, `/v3/items/${enc}?productIdType=SKU&includeDetails=true`));

    const gtin = item?.gtin || item?.upc || item?.ean || null;
    const matches = (d: any) => {
      const list: any[] = d?.items || d?.ItemResponse || d?.payload || (Array.isArray(d) ? d : []);
      const norm = (v: any) => String(v ?? '').replace(/^0+/, '');
      const target = norm(gtin || sku);
      // Solo el ítem con el MISMO código (sin ceros a la izquierda): nunca "el primero que aparezca".
      return list.filter((x: any) => [x?.gtin, x?.upc, x?.ean, ...(x?.standardUpc || [])].map(norm).includes(target));
    };
    if (gtin) {
      await tryCall('GET /v3/items/walmart/search?gtin=', () => this.request(conn, `/v3/items/walmart/search?gtin=${encodeURIComponent(gtin)}`), matches);
      await tryCall('GET /v3/items/walmart/search?upc=', () => this.request(conn, `/v3/items/walmart/search?upc=${encodeURIComponent(gtin)}`), matches);
      await tryCall('POST /v3/items/walmart/search (gtin)', () => this.request(conn, '/v3/items/walmart/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: { field: 'gtin', value: gtin } }),
      }), matches);
    } else {
      attempts.push({ source: 'búsqueda por GTIN/UPC', ok: false, info: 'el ítem no informa GTIN/UPC', images: 0 });
    }
    // Sin búsqueda por nombre: el catálogo de /v3/items/walmart/search es el de Walmart EE.UU.
    // (verificado con la cuenta de Chile), así que por nombre devolvía fotos de OTRO producto.
    // Solo se acepta la coincidencia exacta por GTIN/UPC, que es el mismo producto.
    // Sin repetir la misma foto en distinto tamaño/parámetros (misma URL sin query string).
    const unique = new Map<string, string>();
    for (const u of found) {
      const key = u.split('?')[0].toLowerCase();
      if (!unique.has(key)) unique.set(key, u);
    }
    return { images: [...unique.values()], attempts };
  }

  // Completa las fotos de productos ya importados de esta conexión que no tienen ninguna.
  async fetchMissingImages(conn: any, limit = 200) {
    const listings = await this.prisma.listing.findMany({
      where: { connectionId: conn.id, externalId: { not: null }, product: { images: { none: {} } } },
      select: { externalId: true, productId: true },
      take: limit,
    });
    let updated = 0;
    const withoutImages: string[] = [];
    for (const l of listings) {
      const { images } = await this.findItemImages(conn, l.externalId!).catch(() => ({ images: [] as string[] }));
      if (!images.length) { withoutImages.push(l.externalId!); continue; }
      await this.saveProductImages(l.productId, images);
      updated++;
    }
    return { checked: listings.length, updated, withoutImages: withoutImages.length, pending: listings.length === limit };
  }

  private async saveProductImages(productId: string, urls: string[]) {
    await this.prisma.productImage.createMany({
      data: urls.map((url, i) => ({
        productId, url, filename: url.split('/').pop()?.split('?')[0] || `walmart-${i}.jpg`, isPrimary: i === 0, order: i,
      })),
    });
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

    for (const externalId of externalIds) {
      try {
        if (linkedIds.has(externalId)) { skipped++; continue; }

        const data = await this.request(conn, `/v3/items/${encodeURIComponent(externalId)}`).catch(() => null);
        const raw = Array.isArray(data?.ItemResponse) ? data.ItemResponse[0] : null;
        if (!raw) { errors.push(`${externalId}: no se encontró en Walmart`); continue; }
        const r = this.normalizeItem(raw);

        let stock = 0;
        try { stock = await this.getStock(conn, externalId); } catch { /* si falla, el sync posterior lo corrige */ }

        const skuSuspicious = false; // Walmart ya deduplica por sku (id único de catálogo)
        const forceNew = unlinkSet.has(externalId);
        const sku = (!forceNew && r.sku) || (await this.nextSku(companyId));

        let product = forceNew ? null : await this.prisma.product.findUnique({ where: { sku_companyId: { sku, companyId } } });
        if (product && linkedProductIds.has(product.id)) { skipped++; continue; }

        if (!product) {
          product = await this.prisma.product.create({
            data: {
              sku, name: r.name, price: r.price || 0,
              stock: Math.max(0, Math.round(stock)), category: r.category || undefined, companyId,
            },
          });
          // Fotos: el listado no las trae; se buscan en el detalle / catálogo de Walmart.
          const { images } = await this.findItemImages(conn, externalId, raw).catch(() => ({ images: [] as string[] }));
          if (images.length) await this.saveProductImages(product.id, images);
          imported++;
        } else {
          linked++;
        }
        linkedProductIds.add(product.id);
        linkedIds.add(externalId);

        await this.prisma.listing.upsert({
          where: { productId_connectionId_slot: { productId: product.id, connectionId: conn.id, slot: 0 } },
          update: { externalId, status: 'ACTIVE' as any, syncedAt: new Date(), title: r.name },
          create: { productId: product.id, connectionId: conn.id, externalId, status: 'ACTIVE' as any, syncedAt: new Date(), title: r.name },
        });
        void skuSuspicious;
      } catch (err: any) {
        errors.push(`${externalId}: ${err.message}`);
      }
    }

    return { imported, linked, skipped, errors };
  }

  // ─── Importar ventas ──────────────────────────────────────────────────────────
  // Mismo alcance que Paris/Ripley/Falabella: la importación manual crea Sale/SaleItem para
  // historial/reportes; la automática (cron) además pasa `onCreated`, con el que
  // ChannelOrdersService crea la Orden de despacho y descuenta stock. Confirmado en vivo:
  // - GET /v3/orders (list) pagina con `cursor` (OJO: el `nextCursor` que devuelve YA viene
  //   URL-encoded en el JSON — hay que reusarlo tal cual en la siguiente query string, NO
  //   volver a aplicarle encodeURIComponent o queda doble-encodeado y Walmart lo rechaza).
  // - GET /v3/orders/{purchaseOrderId} (detalle) devuelve `{order: {...}}` (objeto, no array).
  // - Cada `orderLine` YA trae su propia cantidad (`orderLineQuantity.amount`) y el precio
  //   total de esa línea (charge tipo "PRODUCT") — a diferencia de Falabella, acá no hay que
  //   agrupar por SKU contando filas repetidas.
  // - El sku de cada orderLine es `item.sku`, igual que `Listing.externalId`.

  private async resolveOrderLines(connectionId: string, orderLines: any[]) {
    let resolved = true;
    const out: Array<{ productId: string | null; quantity: number; unitPrice: number; title: string; productName: string | null; unitCost: number | null }> = [];
    for (const line of orderLines || []) {
      const sku = line.item?.sku;
      const quantity = Math.max(1, Number(line.orderLineQuantity?.amount ?? 1) || 1);
      const charges = line.charges?.charge || [];
      const productCharge = charges.find((c: any) => c.chargeType === 'PRODUCT');
      const lineTotal = Number(productCharge?.chargeAmount?.amount ?? 0);
      const unitPrice = lineTotal / quantity;
      const title = line.item?.productName;

      const listing = sku ? await this.prisma.listing.findFirst({
        where: { connectionId, externalId: sku },
        select: { productId: true, product: { select: { name: true, cost: true } } },
      }) : null;
      if (!listing) { resolved = false; out.push({ productId: null, quantity, unitPrice, title, productName: null, unitCost: null }); continue; }
      out.push({ productId: listing.productId, quantity, unitPrice, title, productName: listing.product.name, unitCost: listing.product.cost != null ? Number(listing.product.cost) : null });
    }
    return { resolved, items: out };
  }

  // Cargos por línea, verificado contra órdenes reales (245 y luego 57):
  // - PRODUCT/ItemPrice = precio del producto SIN IVA (su IVA viene en `tax.taxAmount`).
  // - SHIPPING = envío a cargo del vendedor, sin IVA (coincide con "Cargos y bonificaciones" de
  //   Seller Center; al comprador se le compensa con DISCOUNT/SHIP_DISC, que no es costo del vendedor).
  // - COMMISSION = comisión. La API la entrega en 0 en todas las órdenes (igual que Seller Center).
  // - DISCOUNT (≠ SHIP_DISC) = promoción sobre el producto; el IVA se calcula sobre el precio SIN
  //   descuento, así que se resta directo del ingreso sin IVA.
  // - TAX/TAX = IVA total (= suma de los `tax.taxAmount`). Total = PRODUCT + SHIPPING + TAX − SHIP_DISC.
  // - Una línea con todos sus estados en "Cancelled" no suma al neto.
  private orderBreakdown(conn: any, order: any, orderLines: any[], unitCosts: (number | null)[]): SaleBreakdown & { total: number } {
    const total = Number(order.orderSummary?.totalAmount?.amount ?? 0);
    const rows: ChargeDetailRow[] = [];
    const lines: LineCalc[] = orderLines.map((line) => {
      const charges: any[] = line.charges?.charge || [];
      const amt = (m: (c: any) => boolean) => charges.filter(m).reduce((s, c) => s + Number(c.chargeAmount?.amount ?? 0), 0);
      const taxOf = (m: (c: any) => boolean) => charges.filter(m).reduce((s, c) => s + Number(c.tax?.taxAmount?.amount ?? 0), 0);
      for (const c of charges) {
        rows.push({ type: String(c.chargeType || 'OTRO'), name: String(c.chargeName || ''), amount: Number(c.chargeAmount?.amount ?? 0), tax: Number(c.tax?.taxAmount?.amount ?? 0) });
      }
      const product = amt((c) => c.chargeType === 'PRODUCT');
      const discount = amt((c) => c.chargeType === 'DISCOUNT' && c.chargeName !== 'SHIP_DISC');
      const hasCommission = charges.some((c) => c.chargeType === 'COMMISSION');
      const statuses = ([] as any[]).concat(line.orderLineStatuses?.orderLineStatus || []).map((s: any) => String(s?.status || ''));
      return {
        title: line.item?.productName,
        quantity: Math.max(1, Number(line.orderLineQuantity?.amount ?? 1) || 1),
        revenue: round2(product - discount),
        discount: round2(discount),
        gross: round2(product + taxOf((c) => c.chargeType === 'PRODUCT') - discount),
        commission: hasCommission ? round2(amt((c) => c.chargeType === 'COMMISSION')) : null,
        shipping: round2(-amt((c) => c.chargeType === 'SHIPPING')),
        tax: round2(taxOf(() => true)),
        cancelled: statuses.length > 0 && statuses.every((s) => /cancel/i.test(s)),
      };
    });
    return {
      total,
      ...buildBreakdown({
        lines, unitCosts, chargeDetail: groupChargeRows(rows),
        platform: 'Walmart', shippingLabel: 'Envío a cargo del vendedor',
      }),
    };
  }

  private extractOrderLines(order: any): any[] {
    const lines = order.orderLines?.orderLine;
    return Array.isArray(lines) ? lines : lines ? [lines] : [];
  }

  async previewSalesImport(conn: any, companyId: string, from?: string, to?: string) {
    const PAGE = 50;
    const MAX = 300;
    const params = new URLSearchParams({ limit: String(PAGE) });
    params.set('createdStartDate', from ? new Date(from).toISOString() : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());
    if (to) params.set('createdEndDate', new Date(`${to}T23:59:59`).toISOString());

    let cursor: string | null = null;
    let totalCount = 0;
    const rawOrders: any[] = [];
    do {
      const query = cursor ? `${params}&cursor=${cursor}` : params.toString();
      const data = await this.request(conn, `/v3/orders?${query}`);
      totalCount = Number(data?.list?.meta?.totalCount ?? 0);
      const raw = data?.list?.elements?.order;
      const page = Array.isArray(raw) ? raw : raw ? [raw] : [];
      if (!page.length) break;
      rawOrders.push(...page);
      cursor = data?.list?.meta?.nextCursor || null;
    } while (cursor && rawOrders.length < MAX);
    const truncated = totalCount > rawOrders.length;

    const externalIds = rawOrders.map((o) => o.purchaseOrderId);
    const existing = await this.prisma.sale.findMany({
      where: { channel: SaleChannel.WALMART, externalId: { in: externalIds } },
      select: { id: true, externalId: true },
    });
    const existingById = new Map(existing.map((s) => [s.externalId, s.id]));

    const orders = [];
    for (const o of rawOrders) {
      const saleId = existingById.get(o.purchaseOrderId);
      const orderLines = this.extractOrderLines(o);
      const { resolved, items } = await this.resolveOrderLines(conn.id, orderLines);
      const { total, ...b } = this.orderBreakdown(conn, o, orderLines, items.map((i) => i.unitCost));
      // Recalcula cargos/neto (sin IVA) de ventas ya importadas con los datos de este mismo listado.
      if (saleId) await backfillSale(this.prisma, saleId, b, items.map((i) => i.productId));
      orders.push({
        externalId: o.purchaseOrderId,
        date: new Date(Number(o.orderDate)).toISOString(),
        total,
        ...b,
        buyerName: o.shippingInfo?.postalAddress?.name || null,
        items: previewItems(items, b),
        importable: !saleId && resolved && items.length > 0,
        alreadyRegistered: !!saleId,
      });
    }
    const alreadyImportedCount = orders.filter((o) => o.alreadyRegistered).length;

    return { connectionName: conn.name, total: totalCount, truncated, alreadyImportedCount, orders };
  }

  // Estados de Walmart por línea (orderLineStatus): Created, Acknowledged, Shipped, Delivered,
  // Cancelled. El seguimiento viene en trackingInfo de la línea despachada.
  private orderState(o: any): ChannelOrderState {
    const STATUS: Record<string, [ChannelOrderStatus, string]> = {
      created: ['PENDING', 'Creada'], acknowledged: ['PENDING', 'Confirmada'], shipped: ['SHIPPED', 'Despachada'],
      delivered: ['DELIVERED', 'Entregada'], cancelled: ['CANCELLED', 'Cancelada'],
    };
    const statuses: (ChannelOrderStatus | null)[] = [];
    const labels: string[] = [];
    let tracking: any = null;
    for (const line of this.extractOrderLines(o)) {
      for (const st of ([] as any[]).concat(line.orderLineStatuses?.orderLineStatus || [])) {
        const raw = String(st?.status || '');
        const known = STATUS[raw.toLowerCase()];
        statuses.push(known ? known[0] : null);
        labels.push(known ? known[1] : raw);
        if (st?.trackingInfo) tracking = st.trackingInfo;
      }
    }
    const status = combineLineStatuses(statuses);
    const shipDate = tracking?.shipDateTime ? new Date(Number(tracking.shipDateTime) || tracking.shipDateTime) : null;
    return {
      status,
      label: joinLabels(labels),
      courier: tracking?.carrierName?.carrier || tracking?.carrierName?.otherCarrier || null,
      trackingCode: tracking?.trackingNumber ? String(tracking.trackingNumber) : null,
      shippedAt: shipDate && !isNaN(shipDate.getTime()) ? shipDate : null,
    };
  }

  async getOrderStates(conn: any, externalIds: string[]): Promise<Map<string, ChannelOrderState>> {
    const out = new Map<string, ChannelOrderState>();
    for (const id of externalIds) {
      try {
        const data = await this.request(conn, `/v3/orders/${encodeURIComponent(id)}`);
        if (data?.order) out.set(id, this.orderState(data.order));
      } catch (err: any) {
        this.logger.warn(`Walmart estado orden ${id}: ${err.message}`);
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
        const existing = await this.prisma.sale.findFirst({ where: { channel: SaleChannel.WALMART, externalId: id } });
        if (existing) { skipped++; continue; }

        const data = await this.request(conn, `/v3/orders/${encodeURIComponent(id)}`);
        const o = data?.order;
        if (!o) { errors.push(`${id}: no se encontró en Walmart`); continue; }

        const orderLines = this.extractOrderLines(o);
        const { resolved, items } = await this.resolveOrderLines(conn.id, orderLines);
        if (!resolved || !items.length) { errors.push(`${id}: uno o más productos no están vinculados en el catálogo`); continue; }
        const b = this.orderBreakdown(conn, o, orderLines, items.map((i) => i.unitCost));
        const addr = o.shippingInfo?.postalAddress || {};

        await this.prisma.$transaction(async (tx) => {
          const sale = await tx.sale.create({
            data: {
              channel: SaleChannel.WALMART,
              externalId: id,
              total: b.total,
              ...b.charges,
              companyId,
              connectionId: conn.id,
              customerName: addr.name || null,
              customerPhone: o.shippingInfo?.phone || null,
              address: addr.address1 || null,
              commune: addr.city || null,
              createdAt: new Date(Number(o.orderDate)),
              items: { create: items.map((i, idx) => ({ productId: i.productId!, quantity: i.quantity, unitPrice: i.unitPrice, netAmount: b.lines[idx]?.net })) },
            },
            include: { items: true },
          });
          if (onCreated) {
            await onCreated(tx, {
              sale, externalId: id, state: this.orderState(o),
              cancelledProductIds: items.filter((_, idx) => b.lines[idx]?.cancelled).map((i) => i.productId!),
              customer: { name: addr.name, phone: o.shippingInfo?.phone, address: [addr.address1, addr.address2].filter(Boolean).join(', '), commune: addr.city, region: addr.state },
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

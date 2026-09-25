import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SaleChannel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAdapter, SyncPayload, PublishResult } from './platform.interface';
import { SaleBreakdown, ChargeDetailRow, groupChargeRows } from './sale-breakdown';

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

  constructor(private prisma: PrismaService) {}

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
  async publishProduct(_conn: any, _product: any): Promise<PublishResult> {
    throw new BadRequestException(
      'Publicar productos nuevos en Walmart todavía no está soportado — por ahora la integración sincroniza stock/precio e importa catálogo/ventas ya existentes en Walmart.',
    );
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
          imported++;
        } else {
          linked++;
        }
        linkedProductIds.add(product.id);
        linkedIds.add(externalId);

        await this.prisma.listing.upsert({
          where: { productId_connectionId: { productId: product.id, connectionId: conn.id } },
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
  // Mismo alcance que Paris/Ripley/Falabella: crea Sale/SaleItem para historial/reportes,
  // sin descontar stock ni generar orden de despacho. Confirmado en vivo:
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
    const out: Array<{ productId: string | null; quantity: number; unitPrice: number; title: string; productName: string | null }> = [];
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
        select: { productId: true, product: { select: { name: true } } },
      }) : null;
      if (!listing) { resolved = false; out.push({ productId: null, quantity, unitPrice, title, productName: null }); continue; }
      out.push({ productId: listing.productId, quantity, unitPrice, title, productName: listing.product.name });
    }
    return { resolved, items: out };
  }

  private chargeTotal(orderLines: any[], match: (c: any) => boolean): number {
    let total = 0;
    for (const line of orderLines || []) {
      for (const c of line.charges?.charge || []) {
        if (match(c)) total += Number(c.chargeAmount?.amount ?? 0);
      }
    }
    return total;
  }

  // Cargos del vendedor por orden, verificado contra 245 órdenes reales:
  // - SHIPPING = envío a cargo del vendedor (coincide con "Cargos y bonificaciones" de Seller Center;
  //   el comprador lo ve compensado por el cargo DISCOUNT/SHIP_DISC, que no es costo del vendedor).
  // - COMMISSION = comisión marketplace. La API la entrega en 0 en todas las órdenes (igual que
  //   Seller Center) y los reportes de conciliación vienen vacíos, así que no hay otra fuente.
  // - DISCOUNT (distinto de SHIP_DISC) = descuento/promoción sobre el producto. El IVA de la orden se
  //   calcula sobre el precio SIN descuento, así que el descuento sale directo del ingreso del vendedor.
  // - El neto parte del precio del producto sin IVA (cargo PRODUCT): el IVA que Walmart cobra al
  //   comprador (total de la orden) no es ganancia del vendedor, va al fisco.
  // - IVA = cargo TAX/TAX (= suma de `charge.tax.taxAmount` de PRODUCT y SHIPPING, verificado en vivo).
  // - Total de la orden = PRODUCT + SHIPPING + TAX − SHIP_DISC (verificado contra 57 órdenes reales).
  private orderBreakdown(order: any, orderLines: any[]): SaleBreakdown & { total: number } {
    const total = Number(order.orderSummary?.totalAmount?.amount ?? 0);
    const productNet = this.chargeTotal(orderLines, (c) => c.chargeType === 'PRODUCT');
    const shippingCost = this.chargeTotal(orderLines, (c) => c.chargeType === 'SHIPPING');
    const marketplaceFee = this.chargeTotal(orderLines, (c) => c.chargeType === 'COMMISSION');
    const discount = this.chargeTotal(orderLines, (c) => c.chargeType === 'DISCOUNT' && c.chargeName !== 'SHIP_DISC');
    let taxes: number | null = null;
    const rows: ChargeDetailRow[] = [];
    for (const line of orderLines || []) {
      for (const c of line.charges?.charge || []) {
        const tax = c.tax?.taxAmount?.amount;
        if (tax != null) taxes = (taxes ?? 0) + Number(tax);
        rows.push({ type: String(c.chargeType || 'OTRO'), name: String(c.chargeName || ''), amount: Number(c.chargeAmount?.amount ?? 0), tax: Number(tax ?? 0) });
      }
    }
    const netAmount = productNet - discount - shippingCost - marketplaceFee;
    return {
      total,
      charges: { shippingCost, marketplaceFee, taxes, discount, netAmount },
      breakdown: [
        { label: 'Precio productos sin IVA', amount: productNet },
        { label: 'Descuento/Promoción', amount: -discount },
        { label: 'Envío a cargo del vendedor', amount: -shippingCost },
        { label: 'Comisión Walmart', amount: -marketplaceFee },
      ],
      chargeDetail: groupChargeRows(rows),
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
      select: { externalId: true },
    });
    const existingSet = new Set(existing.map((s) => s.externalId));

    // Recalcula cargos/neto de ventas ya importadas (corrige las guardadas sin cargos o con la
    // fórmula anterior) con los datos que este mismo listado ya trae, sin llamadas extra.
    const pendingCharges = await this.prisma.sale.findMany({
      where: { channel: SaleChannel.WALMART, externalId: { in: externalIds } },
      select: { id: true, externalId: true },
    });
    const byId = new Map(rawOrders.map((o) => [o.purchaseOrderId, o]));
    for (const sale of pendingCharges) {
      const o = byId.get(sale.externalId!);
      if (!o) continue;
      const { charges } = this.orderBreakdown(o, this.extractOrderLines(o));
      await this.prisma.sale.update({ where: { id: sale.id }, data: charges });
    }

    const orders = [];
    for (const o of rawOrders) {
      const alreadyRegistered = existingSet.has(o.purchaseOrderId);
      const orderLines = this.extractOrderLines(o);
      const { resolved, items } = await this.resolveOrderLines(conn.id, orderLines);
      const { total, ...breakdown } = this.orderBreakdown(o, orderLines);
      orders.push({
        externalId: o.purchaseOrderId,
        date: new Date(Number(o.orderDate)).toISOString(),
        total,
        ...breakdown,
        buyerName: o.shippingInfo?.postalAddress?.name || null,
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
        const existing = await this.prisma.sale.findFirst({ where: { channel: SaleChannel.WALMART, externalId: id } });
        if (existing) { skipped++; continue; }

        const data = await this.request(conn, `/v3/orders/${encodeURIComponent(id)}`);
        const o = data?.order;
        if (!o) { errors.push(`${id}: no se encontró en Walmart`); continue; }

        const orderLines = this.extractOrderLines(o);
        const { resolved, items } = await this.resolveOrderLines(conn.id, orderLines);
        if (!resolved || !items.length) { errors.push(`${id}: uno o más productos no están vinculados en el catálogo`); continue; }

        await this.prisma.sale.create({
          data: {
            channel: SaleChannel.WALMART,
            externalId: id,
            total: Number(o.orderSummary?.totalAmount?.amount ?? 0),
            ...this.orderBreakdown(o, orderLines).charges,
            companyId,
            connectionId: conn.id,
            customerName: o.shippingInfo?.postalAddress?.name || null,
            address: o.shippingInfo?.postalAddress?.address1 || null,
            commune: o.shippingInfo?.postalAddress?.city || null,
            createdAt: new Date(Number(o.orderDate)),
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
}

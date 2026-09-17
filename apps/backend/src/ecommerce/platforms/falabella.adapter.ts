import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { SaleChannel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { PlatformAdapter, SyncPayload, PublishResult } from './platform.interface';
import { getEffectivePrice } from '../../common/effective-price.util';
import { toAbsoluteUrl } from '../../common/absolute-url.util';

// Falabella Seller Center corre sobre la misma familia de API que Lazada/Linio/Dafiti
// ("Rocket/Kaymu Seller Center API"): un único endpoint con Action=X por query string,
// firmado con HMAC-SHA256, cuerpo en XML para las escrituras. La página de autenticación
// del portal de Falabella está "en construcción" (vacía) — el esquema de firma se confirmó
// probando en vivo contra la cuenta real (seller "Habita2 Chile"), igual que ProductUpdate/
// ProductCreate SÍ existen como Action (confirmado con un POST vacío: da error de "falta
// contenido", no "acción inválida") pero sus páginas de doc también están vacías, así que el
// XML exacto se armó por mejor esfuerzo a partir de la forma que devuelve GetProducts.
const BASE = 'https://sellercenter-api.falabella.com';

function timestamp(): string {
  return `${new Date().toISOString().split('.')[0]}+00:00`;
}

function formatDate(d: Date): string {
  return `${d.toISOString().split('.')[0]}+00:00`;
}

function sign(params: Record<string, string>, secret: string): { queryString: string; signature: string } {
  const queryString = Object.keys(params).sort()
    .map((k) => `${k}=${encodeURIComponent(params[k])}`).join('&');
  const signature = createHmac('sha256', secret).update(queryString).digest('hex');
  return { queryString, signature };
}

function xmlEscape(value: string | number | null | undefined): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface FalabellaCategory { id: string; name: string; isLeaf: boolean }

export interface FalabellaChannelAttributes {
  categoryId: string;
  categoryName?: string;
  brand?: string;
}

export interface FalabellaImportItem {
  externalId: string; // = SellerSku (identificador propio del seller, igual que nuestro SKU)
  title: string;
  thumbnail: string | null;
  sku: string | null;
  skuSuspicious: boolean;
  matchedProductId: string | null;
  matchedProductName: string | null;
}

const PAGE_SIZE = 25;

@Injectable()
export class FalabellaAdapter implements PlatformAdapter {
  private readonly logger = new Logger(FalabellaAdapter.name);

  constructor(private prisma: PrismaService, private settings: SettingsService) {}

  private creds(conn: any): any {
    return (conn.credentials as any) || {};
  }

  private async call(conn: any, action: string, extraParams: Record<string, string> = {}): Promise<any> {
    const { userId, apiKey } = this.creds(conn);
    if (!userId || !apiKey) throw new Error('Faltan UserID/API Key de Falabella');
    const params = { Action: action, Format: 'JSON', Timestamp: timestamp(), UserID: userId, Version: '1.0', ...extraParams };
    const { queryString, signature } = sign(params, apiKey);
    const res = await fetch(`${BASE}/?${queryString}&Signature=${signature}`);
    const data = await res.json().catch(() => null);
    if (data?.ErrorResponse) {
      const h = data.ErrorResponse.Head;
      throw new Error(`Falabella (${action}): ${h.ErrorMessage || `error ${h.ErrorCode}`}`);
    }
    return data?.SuccessResponse?.Body;
  }

  // GetOrders trae el total real (Head.TotalCount) para paginar, a diferencia de `call()`
  // que descarta el Head — se usa solo donde hace falta ese dato.
  private async callFull(conn: any, action: string, extraParams: Record<string, string> = {}): Promise<{ body: any; head: any }> {
    const { userId, apiKey } = this.creds(conn);
    if (!userId || !apiKey) throw new Error('Faltan UserID/API Key de Falabella');
    const params = { Action: action, Format: 'JSON', Timestamp: timestamp(), UserID: userId, Version: '1.0', ...extraParams };
    const { queryString, signature } = sign(params, apiKey);
    const res = await fetch(`${BASE}/?${queryString}&Signature=${signature}`);
    const data = await res.json().catch(() => null);
    if (data?.ErrorResponse) {
      const h = data.ErrorResponse.Head;
      throw new Error(`Falabella (${action}): ${h.ErrorMessage || `error ${h.ErrorCode}`}`);
    }
    return { body: data?.SuccessResponse?.Body, head: data?.SuccessResponse?.Head };
  }

  private async post(conn: any, action: string, xmlBody: string): Promise<any> {
    const { userId, apiKey } = this.creds(conn);
    if (!userId || !apiKey) throw new Error('Faltan UserID/API Key de Falabella');
    const params = { Action: action, Format: 'JSON', Timestamp: timestamp(), UserID: userId, Version: '1.0' };
    const { queryString, signature } = sign(params, apiKey);
    const res = await fetch(`${BASE}/?${queryString}&Signature=${signature}`, {
      method: 'POST', headers: { 'Content-Type': 'text/xml' }, body: xmlBody,
    });
    const data = await res.json().catch(() => null);
    if (data?.ErrorResponse) {
      const h = data.ErrorResponse.Head;
      throw new Error(`Falabella (${action}): ${h.ErrorMessage || `error ${h.ErrorCode}`}`);
    }
    return data?.SuccessResponse?.Body;
  }

  async testConnection(conn: any): Promise<{ success: boolean; message?: string }> {
    try {
      await this.call(conn, 'GetCategoryTree', { Limit: '1' });
      return { success: true, message: 'Conectado correctamente' };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  async getCategories(conn: any): Promise<FalabellaCategory[]> {
    const data = await this.call(conn, 'GetCategoryTree');
    const out: FalabellaCategory[] = [];
    const walk = (nodes: any) => {
      const list = Array.isArray(nodes) ? nodes : [nodes];
      for (const n of list) {
        if (!n) continue;
        const children = n.Children?.Category;
        const isLeaf = !children;
        out.push({ id: n.CategoryId, name: n.Name, isLeaf });
        if (children) walk(children);
      }
    };
    walk(data?.Categories?.Category || []);
    return out.filter((c) => c.isLeaf);
  }

  private async getListingWithImages(productId: string, connectionId: string) {
    return this.prisma.listing.findUnique({
      where: { productId_connectionId: { productId, connectionId } },
      include: { images: { orderBy: { order: 'asc' } } },
    });
  }

  // ─── Publicación ───────────────────────────────────────────────────────────
  // NUNCA probado en escritura real (hubiera creado un producto real en la cuenta del
  // cliente sin autorización) — el XML se arma con los nombres de campo confirmados desde
  // la forma que devuelve GetProducts, pero no está verificado que ProductCreate acepte
  // exactamente este set de tags. Antes de confiar en esto, publicar un producto de prueba
  // y revisar el ErrorMessage si falla.
  async publishProduct(conn: any, product: any): Promise<PublishResult> {
    const listing = await this.getListingWithImages(product.id, conn.id);
    if (!listing?.title?.trim()) {
      throw new BadRequestException('Falta el título de la publicación de Falabella (pestaña "Falabella" del producto)');
    }
    const attrs = (listing.channelAttributes as unknown as FalabellaChannelAttributes) || null;
    if (!attrs?.categoryId) {
      throw new BadRequestException('Falta elegir la categoría de Falabella (pestaña "Falabella" del producto)');
    }
    const { businessUnit, operatorCode } = this.creds(conn);
    if (!businessUnit || !operatorCode) {
      throw new BadRequestException('Falta configurar BusinessUnit/OperatorCode en la conexión de Falabella (ver ajustes de la conexión)');
    }

    const listingImages = listing.images.length
      ? listing.images
      : await this.prisma.productImage.findMany({ where: { productId: product.id }, orderBy: { order: 'asc' } });
    if (!listingImages.length) {
      throw new BadRequestException('Falabella exige al menos una foto (pestaña "Fotos Falabella" o "Imágenes" del producto)');
    }
    const imageUrls = await Promise.all(listingImages.map((img: any) => toAbsoluteUrl(this.settings, img.url)));
    const price = await getEffectivePrice(this.prisma, product.id, conn.id, Number(product.price));

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Request>
  <Product>
    <SellerSku>${xmlEscape(product.sku)}</SellerSku>
    <Name>${xmlEscape(listing.title)}</Name>
    <Description>${xmlEscape(listing.description || product.description || listing.title)}</Description>
    <Brand>${xmlEscape(attrs.brand || 'No Brand')}</Brand>
    <PrimaryCategory>${xmlEscape(attrs.categoryId)}</PrimaryCategory>
    <Images>${imageUrls.map((u) => `<Image>${xmlEscape(u)}</Image>`).join('')}</Images>
    <BusinessUnits>
      <BusinessUnit>
        <OperatorCode>${xmlEscape(operatorCode)}</OperatorCode>
        <Price>${Math.round(price)}</Price>
        <Stock>${Math.max(0, Math.round(Number(product.stock ?? 0)))}</Stock>
        <Status>active</Status>
      </BusinessUnit>
    </BusinessUnits>
  </Product>
</Request>`;

    await this.post(conn, 'ProductCreate', xml);
    return { externalId: product.sku };
  }

  async syncListing(conn: any, externalId: string, payload: SyncPayload): Promise<void> {
    const { operatorCode } = this.creds(conn);
    if (!operatorCode) throw new Error('Falta configurar OperatorCode en la conexión de Falabella');

    const priceTag = payload.price != null ? `<Price>${Math.round(payload.price)}</Price>` : '';
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Request>
  <Product>
    <SellerSku>${xmlEscape(externalId)}</SellerSku>
    <BusinessUnits>
      <BusinessUnit>
        <OperatorCode>${xmlEscape(operatorCode)}</OperatorCode>
        ${priceTag}
        <Stock>${Math.max(0, Math.round(payload.stock))}</Stock>
      </BusinessUnit>
    </BusinessUnits>
  </Product>
</Request>`;

    await this.post(conn, 'ProductUpdate', xml);
    this.logger.log(`Falabella sync: sku=${externalId} stock=${payload.stock}${payload.price != null ? ` price=${Math.round(payload.price)}` : ''}`);
  }

  // ─── Guardar campos/fotos de la publicación antes de publicar (borrador) ─────

  async upsertListingFields(
    productId: string, connectionId: string,
    dto: { title?: string; description?: string; channelAttributes?: FalabellaChannelAttributes },
  ) {
    return this.prisma.listing.upsert({
      where: { productId_connectionId: { productId, connectionId } },
      update: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.channelAttributes !== undefined ? { channelAttributes: dto.channelAttributes as any } : {}),
      },
      create: { productId, connectionId, title: dto.title, description: dto.description, channelAttributes: dto.channelAttributes as any },
      include: { images: { orderBy: { order: 'asc' } } },
    });
  }

  async addListingImage(productId: string, connectionId: string, filename: string, url: string) {
    const listing = await this.prisma.listing.upsert({
      where: { productId_connectionId: { productId, connectionId } }, update: {}, create: { productId, connectionId },
    });
    const count = await this.prisma.listingImage.count({ where: { listingId: listing.id } });
    return this.prisma.listingImage.create({ data: { listingId: listing.id, filename, url, order: count } });
  }

  async removeListingImage(listingId: string, imageId: string) {
    return this.prisma.listingImage.deleteMany({ where: { id: imageId, listingId } });
  }

  // ─── Importar catálogo existente desde Falabella ─────────────────────────────
  // GetProducts ya trae nombre/descripción/marca/categoría/precio/stock/fotos en un solo
  // llamado (sin fetch de detalle por ítem). OJO: esta API no devuelve un total_count, así
  // que "hasMore" es una estimación (se asume que hay más si la página vino llena).

  private normalizeProduct(p: any) {
    const bu = p.BusinessUnits?.BusinessUnit;
    const unit = Array.isArray(bu) ? bu[0] : bu;
    return {
      sellerSku: p.SellerSku as string,
      name: p.Name as string,
      description: p.Description as string | undefined,
      brand: p.Brand as string | undefined,
      categoryId: p.PrimaryCategoryId as string | undefined,
      categoryName: p.PrimaryCategory as string | undefined,
      thumbnail: (p.MainImage as string) || null,
      images: (Array.isArray(p.Images?.Image) ? p.Images.Image : p.Images?.Image ? [p.Images.Image] : []) as string[],
      price: unit ? Number(unit.Price) : 0,
      stock: unit ? Number(unit.Stock) : 0,
    };
  }

  async previewImport(conn: any, companyId: string, offset = 0) {
    const data = await this.call(conn, 'GetProducts', { Limit: String(PAGE_SIZE), Offset: String(offset) });
    const raw = data?.Products?.Product;
    const results = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((p: any) => this.normalizeProduct(p));
    const hasMore = results.length === PAGE_SIZE;

    const skus = results.map((r) => r.sellerSku).filter(Boolean);
    const skuCounts = new Map<string, number>();
    for (const sku of skus) skuCounts.set(sku, (skuCounts.get(sku) || 0) + 1);

    const [existingProducts, existingListings] = await Promise.all([
      this.prisma.product.findMany({ where: { companyId, sku: { in: skus } }, select: { id: true, sku: true, name: true } }),
      this.prisma.listing.findMany({ where: { connectionId: conn.id }, select: { externalId: true } }),
    ]);
    const productBySku = new Map(existingProducts.map((p) => [p.sku, p]));
    const linkedIds = new Set(existingListings.map((l) => l.externalId).filter(Boolean));

    const items: FalabellaImportItem[] = results
      .filter((r) => !linkedIds.has(r.sellerSku))
      .map((r) => {
        const skuSuspicious = (skuCounts.get(r.sellerSku) || 0) > 1;
        const matched = productBySku.get(r.sellerSku);
        return {
          externalId: r.sellerSku, title: r.name, thumbnail: r.thumbnail, sku: r.sellerSku, skuSuspicious,
          matchedProductId: matched?.id || null, matchedProductName: matched?.name || null,
        };
      });

    return {
      connectionName: conn.name, total: -1, hasMore,
      nextOffset: hasMore ? offset + PAGE_SIZE : null,
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

    // GetProducts no filtra por lista de SKUs de forma confirmada — se pagina hasta juntar
    // los seleccionados (el lote de import ya viene acotado por lo que el usuario marcó).
    const wanted = new Set(externalIds);
    const found = new Map<string, ReturnType<FalabellaAdapter['normalizeProduct']>>();
    let offset = 0;
    for (let page = 0; page < 40 && found.size < wanted.size; page++) {
      const data = await this.call(conn, 'GetProducts', { Limit: String(PAGE_SIZE), Offset: String(offset) }).catch(() => null);
      const raw = data?.Products?.Product;
      const results = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((p: any) => this.normalizeProduct(p));
      if (!results.length) break;
      for (const r of results) if (wanted.has(r.sellerSku)) found.set(r.sellerSku, r);
      offset += PAGE_SIZE;
    }

    const skuCountsInBatch = new Map<string, number>();
    for (const r of found.values()) skuCountsInBatch.set(r.sellerSku, (skuCountsInBatch.get(r.sellerSku) || 0) + 1);

    const preexistingListings = await this.prisma.listing.findMany({ where: { connectionId: conn.id }, select: { productId: true, externalId: true } });
    const linkedProductIds = new Set(preexistingListings.map((l) => l.productId));
    const linkedIds = new Set(preexistingListings.map((l) => l.externalId).filter(Boolean));

    for (const externalId of externalIds) {
      const r = found.get(externalId);
      if (!r) { errors.push(`${externalId}: no se encontró en Falabella`); continue; }
      try {
        if (linkedIds.has(r.sellerSku)) { skipped++; continue; }
        const skuSuspicious = (skuCountsInBatch.get(r.sellerSku) || 0) > 1;
        const forceNew = unlinkSet.has(externalId) || skuSuspicious;
        const sku = (!forceNew && r.sellerSku) || (await this.nextSku(companyId));

        let product = forceNew ? null : await this.prisma.product.findUnique({ where: { sku_companyId: { sku, companyId } } });
        if (product && linkedProductIds.has(product.id)) { skipped++; continue; }

        if (!product) {
          product = await this.prisma.product.create({
            data: {
              sku, name: r.name, description: r.description, price: r.price || 0,
              stock: Math.max(0, Math.round(r.stock || 0)), category: r.categoryName, companyId,
            },
          });
          if (r.images.length) {
            await this.prisma.productImage.createMany({
              data: r.images.map((url, i) => ({ productId: product!.id, url, filename: url.split('/').pop() || `falabella-${i}.jpg`, isPrimary: i === 0, order: i })),
            });
          }
          imported++;
        } else {
          linked++;
        }
        linkedProductIds.add(product.id);
        linkedIds.add(r.sellerSku);

        const listing = await this.prisma.listing.upsert({
          where: { productId_connectionId: { productId: product.id, connectionId: conn.id } },
          update: {
            externalId: r.sellerSku, status: 'ACTIVE' as any, syncedAt: new Date(),
            title: r.name, description: r.description,
            channelAttributes: { categoryId: r.categoryId, categoryName: r.categoryName, brand: r.brand } as any,
          },
          create: {
            productId: product.id, connectionId: conn.id,
            externalId: r.sellerSku, status: 'ACTIVE' as any, syncedAt: new Date(),
            title: r.name, description: r.description,
            channelAttributes: { categoryId: r.categoryId, categoryName: r.categoryName, brand: r.brand } as any,
          },
        });
        if (r.images.length) {
          await this.prisma.listingImage.createMany({
            data: r.images.map((url, i) => ({ listingId: listing.id, url, filename: url.split('/').pop() || `falabella-${i}.jpg`, order: i })),
          });
        }
      } catch (err: any) {
        errors.push(`${externalId}: ${err.message}`);
      }
    }

    return { imported, linked, skipped, errors };
  }

  // ─── Importar ventas ──────────────────────────────────────────────────────────
  // Mismo alcance que Paris/Ripley: crea Sale/SaleItem para historial/reportes, sin tocar
  // stock. GetOrders (probado en vivo) no trae las líneas del pedido — hay que pedirlas
  // aparte con GetMultipleOrderItems. El "Sku" de cada OrderItem es el SellerSku (mismo
  // campo que ya usa GetProducts/confirmImport), es decir nuestro Listing.externalId
  // directo, sin prefijo compuesto. Cuando la orden trae más de una unidad del mismo SKU,
  // Falabella devuelve un OrderItem por unidad (no un campo "quantity"), así que se agrupan
  // por Sku igual que en Paris. Falabella no expone comisión a nivel de orden en esta API,
  // así que marketplaceFee queda sin dato (no se inventa un valor).

  private parseMoney(v: any): number {
    return Number(String(v ?? '0').replace(/,/g, ''));
  }

  private async fetchOrderItemsMap(conn: any, orderIds: string[]): Promise<Map<string, any[]>> {
    const map = new Map<string, any[]>();
    const CHUNK = 20;
    for (let i = 0; i < orderIds.length; i += CHUNK) {
      const chunk = orderIds.slice(i, i + CHUNK);
      if (!chunk.length) continue;
      const data = await this.call(conn, 'GetMultipleOrderItems', { OrderIdList: JSON.stringify(chunk) });
      const raw = data?.Orders?.Order;
      const orders = Array.isArray(raw) ? raw : raw ? [raw] : [];
      for (const o of orders) {
        const itemsRaw = o.OrderItems?.OrderItem;
        const items = Array.isArray(itemsRaw) ? itemsRaw : itemsRaw ? [itemsRaw] : [];
        map.set(o.OrderId, items);
      }
    }
    return map;
  }

  private async resolveOrderItems(connectionId: string, items: any[]) {
    const bySku = new Map<string, { count: number; unitPrice: number; title: string }>();
    for (const it of items || []) {
      const sku = it.Sku;
      if (!sku) continue;
      const price = this.parseMoney(it.ItemPrice ?? it.PaidPrice);
      const cur = bySku.get(sku) || { count: 0, unitPrice: price, title: it.Name };
      cur.count++;
      bySku.set(sku, cur);
    }
    let resolved = true;
    const out: Array<{ productId: string | null; quantity: number; unitPrice: number; title: string; productName: string | null }> = [];
    for (const [sku, info] of bySku) {
      const listing = await this.prisma.listing.findFirst({
        where: { connectionId, externalId: sku },
        select: { productId: true, product: { select: { name: true } } },
      });
      if (!listing) { resolved = false; out.push({ productId: null, quantity: info.count, unitPrice: info.unitPrice, title: info.title, productName: null }); continue; }
      out.push({ productId: listing.productId, quantity: info.count, unitPrice: info.unitPrice, title: info.title, productName: listing.product.name });
    }
    return { resolved, items: out };
  }

  async previewSalesImport(conn: any, companyId: string, from?: string, to?: string) {
    const PAGE = 50;
    const MAX = 300;
    const params: Record<string, string> = { Limit: String(PAGE) };
    if (from) params.CreatedAfter = formatDate(new Date(from));
    if (to) params.CreatedBefore = formatDate(new Date(`${to}T23:59:59`));

    let offset = 0;
    let totalCount = 0;
    const rawOrders: any[] = [];
    do {
      const { body, head } = await this.callFull(conn, 'GetOrders', { ...params, Offset: String(offset) });
      totalCount = Number(head?.TotalCount || 0);
      const raw = body?.Orders?.Order;
      const page = Array.isArray(raw) ? raw : raw ? [raw] : [];
      if (!page.length) break;
      rawOrders.push(...page);
      offset += PAGE;
    } while (offset < totalCount && rawOrders.length < MAX);
    const truncated = totalCount > rawOrders.length;

    const externalIds = rawOrders.map((o) => o.OrderId);
    const existing = await this.prisma.sale.findMany({
      where: { channel: SaleChannel.FALABELLA, externalId: { in: externalIds } },
      select: { externalId: true },
    });
    const existingSet = new Set(existing.map((s) => s.externalId));
    const itemsMap = await this.fetchOrderItemsMap(conn, externalIds);

    const orders = [];
    for (const o of rawOrders) {
      const alreadyRegistered = existingSet.has(o.OrderId);
      const { resolved, items } = await this.resolveOrderItems(conn.id, itemsMap.get(o.OrderId) || []);
      orders.push({
        externalId: o.OrderId,
        date: o.CreatedAt,
        total: this.parseMoney(o.Price),
        buyerName: [o.CustomerFirstName, o.CustomerLastName].filter(Boolean).join(' ') || null,
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
        const existing = await this.prisma.sale.findFirst({ where: { channel: SaleChannel.FALABELLA, externalId: id } });
        if (existing) { skipped++; continue; }

        const data = await this.call(conn, 'GetOrders', { OrderIdList: JSON.stringify([id]) });
        const raw = data?.Orders?.Order;
        const o = Array.isArray(raw) ? raw[0] : raw;
        if (!o) { errors.push(`${id}: no se encontró en Falabella`); continue; }

        const itemsMap = await this.fetchOrderItemsMap(conn, [id]);
        const { resolved, items } = await this.resolveOrderItems(conn.id, itemsMap.get(id) || []);
        if (!resolved || !items.length) { errors.push(`${id}: uno o más productos no están vinculados en el catálogo`); continue; }

        await this.prisma.sale.create({
          data: {
            channel: SaleChannel.FALABELLA,
            externalId: id,
            total: this.parseMoney(o.Price),
            shippingCost: this.parseMoney(o.ShippingFeeTotal),
            companyId,
            connectionId: conn.id,
            customerName: [o.CustomerFirstName, o.CustomerLastName].filter(Boolean).join(' ') || null,
            address: o.AddressShipping?.Address1 || null,
            commune: o.AddressShipping?.City || null,
            createdAt: new Date(String(o.CreatedAt).replace(' ', 'T')),
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

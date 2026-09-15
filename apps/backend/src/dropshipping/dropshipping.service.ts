import {
  Injectable, Logger, NotFoundException, ForbiddenException,
  BadRequestException, ConflictException,
} from '@nestjs/common';
import { DropshipConnectorType, DropshipOrderStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import {
  CreateDropshipSupplierDto, UpdateDropshipSupplierDto,
  CreateDropshipProductDto, UpdateDropshipProductDto,
  ListDropshipOrdersDto, UpdateDropshipOrderDto,
} from './dto/dropshipping.dto';
import { NoriegaAdapter } from './providers/noriega.adapter';
import { DropshipCatalogProvider } from './providers/provider.interface';

const PAGE_SIZE = 20;

interface CatalogRow {
  sku: string;
  name?: string;
  description?: string;
  imageUrl?: string;
  stock?: number;
  cost?: number;
  price?: number;
}

// Subconjunto de DropshipSupplier que necesitan los conectores API (login/token/credenciales).
interface DropshipSupplierRef {
  id: string;
  companyId: string;
  connectorType: DropshipConnectorType;
  credentials: unknown;
  apiToken: string | null;
  apiTokenExpiresAt: Date | null;
}

// Alias de columnas aceptados en el feed del proveedor (JSON keys o cabeceras CSV).
const FIELD_ALIASES: Record<keyof CatalogRow, string[]> = {
  sku: ['sku', 'codigo', 'código', 'code', 'id'],
  name: ['name', 'nombre', 'title', 'titulo', 'título', 'producto'],
  description: ['description', 'descripcion', 'descripción', 'desc', 'detalle'],
  imageUrl: ['imageurl', 'image_url', 'image', 'imagen', 'foto', 'photo', 'img'],
  stock: ['stock', 'cantidad', 'quantity', 'qty', 'disponible', 'available'],
  cost: ['cost', 'costo', 'supplier_cost', 'suppliercost', 'precio_proveedor', 'precioproveedor', 'costo_proveedor', 'wholesale', 'mayorista'],
  price: ['price', 'precio', 'sale_price', 'saleprice', 'precio_venta', 'precioventa', 'pvp', 'retail'],
};

function num(v: any): number | undefined {
  if (v == null || v === '') return undefined;
  let s = String(v).trim().replace(/[^0-9.,-]/g, '');
  if (!s) return undefined;
  if (s.includes('.') && s.includes(',')) {
    // El último separador es el decimal.
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    const parts = s.split(',');
    s = parts.length === 2 && parts[1].length <= 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeKey(k: string): string {
  return k.trim().toLowerCase().replace(/\s+/g, '_');
}

// Con mapeo explícito (configurado por el admin), cada campo usa la columna que él
// asoció y nada más — si la dejó sin asociar, ese campo simplemente no se completa,
// no se cae a adivinar por alias. Sin mapeo (proveedor nunca configurado), se mantiene
// el comportamiento anterior de detectar por nombre de columna conocido.
function rowFromRecord(rec: Record<string, any>, mapping?: Record<string, string | null> | null): CatalogRow {
  const lower: Record<string, any> = {};
  for (const [k, v] of Object.entries(rec)) lower[normalizeKey(k)] = v;
  const pick = (field: keyof CatalogRow) => {
    if (mapping) {
      const col = mapping[field];
      if (!col) return undefined;
      const val = lower[normalizeKey(col)];
      return val != null && val !== '' ? val : undefined;
    }
    for (const alias of FIELD_ALIASES[field]) {
      if (lower[alias] != null && lower[alias] !== '') return lower[alias];
    }
    return undefined;
  };
  return {
    sku: String(pick('sku') ?? '').trim(),
    name: pick('name') != null ? String(pick('name')).trim() : undefined,
    description: pick('description') != null ? String(pick('description')).trim() : undefined,
    imageUrl: pick('imageUrl') != null ? String(pick('imageUrl')).trim() : undefined,
    stock: num(pick('stock')) != null ? Math.max(0, Math.round(num(pick('stock'))!)) : undefined,
    cost: num(pick('cost')),
    price: num(pick('price')),
  };
}

// Divide una línea CSV respetando comillas dobles ("" escapa una comilla).
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',' || c === ';') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// Registros crudos (sin todavía interpretar cuál columna es cuál) del feed del proveedor,
// sea JSON o CSV/TSV. Se usa tanto para sincronizar como para armar la vista previa de
// columnas al configurar el mapeo.
function extractFeedRecords(text: string): Record<string, any>[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed) ? parsed : (parsed.products ?? parsed.data ?? parsed.items ?? []);
      if (Array.isArray(arr)) return arr.filter((r) => r && typeof r === 'object');
    } catch {
      // cae a CSV
    }
  }

  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const rec: Record<string, any> = {};
    headers.forEach((h, i) => { rec[h] = cells[i]; });
    return rec;
  });
}

function parseCatalogFeed(text: string, mapping?: Record<string, string | null> | null): CatalogRow[] {
  return extractFeedRecords(text).map((rec) => rowFromRecord(rec, mapping)).filter((r) => r.sku);
}

// Para la pantalla de mapeo: por cada campo nuestro, propone la columna del proveedor
// que calzaría según la misma lista de alias que usa la detección automática.
function suggestMapping(columns: string[]): Record<string, string | null> {
  const byNormalized: Record<string, string> = {};
  for (const c of columns) byNormalized[normalizeKey(c)] = c;
  const result: Record<string, string | null> = {};
  (Object.keys(FIELD_ALIASES) as (keyof CatalogRow)[]).forEach((field) => {
    let found: string | null = null;
    for (const alias of FIELD_ALIASES[field]) {
      if (byNormalized[alias]) { found = byNormalized[alias]; break; }
    }
    result[field] = found;
  });
  return result;
}

const CATALOG_CACHE_TTL_MS = 15 * 60 * 1000;

// Filas ya descargadas del proveedor API para un supplier + cuánto falta por traer.
// browseCatalog solo pide la página 1 al inicio (rápido) y va sumando páginas del
// proveedor bajo demanda ("Cargar más del proveedor"), en vez de esperar el catálogo
// completo antes de mostrar algo.
interface ApiCatalogCacheEntry {
  rows: CatalogRow[];
  hasMore: boolean;
  nextProviderPage: number | null;
  fetchedAt: number;
}

@Injectable()
export class DropshippingService {
  private readonly logger = new Logger(DropshippingService.name);
  // Conectores con API autenticada (login + token). FEED no pasa por acá: se maneja
  // directo con fetch() en syncCatalog, como siempre.
  private readonly apiProviders: Map<DropshipConnectorType, DropshipCatalogProvider>;
  // Cache en memoria del último catálogo consultado a cada proveedor API, para poder
  // paginar/buscar sin volver a pegarle al proveedor en cada tecleo. Se pierde si el
  // proceso se reinicia (no es crítico: el usuario solo tiene que "Actualizar" de nuevo).
  private readonly catalogCache = new Map<string, ApiCatalogCacheEntry>();

  constructor(
    private prisma: PrismaService,
    private email: EmailService,
    private noriega: NoriegaAdapter,
  ) {
    this.apiProviders = new Map([[DropshipConnectorType.NORIEGA_API, this.noriega]]);
  }

  // Nunca exponer credenciales/token del proveedor al frontend.
  private sanitizeSupplier<T extends { credentials?: unknown; apiToken?: string | null }>(s: T) {
    const { credentials, apiToken, ...rest } = s as any;
    return { ...rest, hasCredentials: credentials != null };
  }

  private resolveCompanyId(user: any, companyId?: string): string {
    if (user.role === Role.SUPER_ADMIN) {
      if (!companyId) throw new BadRequestException('companyId requerido para Super Admin');
      return companyId;
    }
    if (!user.companyId) throw new ForbiddenException('Sin empresa asignada');
    return user.companyId;
  }

  private scopeWhere(user: any, companyId?: string) {
    return user.role === Role.SUPER_ADMIN
      ? (companyId ? { companyId } : {})
      : { companyId: user.companyId };
  }

  // ─── Proveedores dropship ─────────────────────────────────────────────────

  async listSuppliers(user: any, companyId?: string) {
    const suppliers = await this.prisma.dropshipSupplier.findMany({
      where: this.scopeWhere(user, companyId),
      include: {
        supplier: true,
        _count: { select: { products: true, orders: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return suppliers.map((s) => this.sanitizeSupplier(s));
  }

  // Verifica credenciales contra el proveedor sin guardar nada (botón "Probar conexión").
  async testConnection(connectorType: DropshipConnectorType, credentials: Record<string, string>) {
    const provider = this.apiProviders.get(connectorType);
    if (!provider) return { success: true };
    return provider.testConnection(credentials);
  }

  async createSupplier(dto: CreateDropshipSupplierDto, user: any) {
    const companyId = this.resolveCompanyId(user, dto.companyId);

    let supplierId = dto.supplierId;
    if (supplierId) {
      const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier || supplier.companyId !== companyId) {
        throw new BadRequestException('Proveedor no válido para esta empresa');
      }
      const existing = await this.prisma.dropshipSupplier.findUnique({ where: { supplierId } });
      if (existing) throw new ConflictException('Ese proveedor ya está configurado como dropship');
    } else {
      if (!dto.name?.trim()) throw new BadRequestException('Indica un proveedor existente o el nombre de uno nuevo');
      const created = await this.prisma.supplier.create({
        data: {
          companyId,
          name: dto.name.trim(),
          taxId: dto.taxId,
          email: dto.email,
          phone: dto.phone,
          address: dto.address,
        },
      });
      supplierId = created.id;
    }

    const created = await this.prisma.dropshipSupplier.create({
      data: {
        companyId,
        supplierId,
        autoCreateOrders: dto.autoCreateOrders ?? true,
        leadTimeDays: dto.leadTimeDays ?? null,
        notes: dto.notes,
        connectorType: dto.connectorType ?? DropshipConnectorType.FEED,
        credentials: dto.credentials ?? undefined,
      },
      include: { supplier: true, _count: { select: { products: true, orders: true } } },
    });
    return this.sanitizeSupplier(created);
  }

  async updateSupplier(id: string, dto: UpdateDropshipSupplierDto, user: any) {
    const ds = await this.prisma.dropshipSupplier.findUnique({ where: { id } });
    if (!ds) throw new NotFoundException('Proveedor dropship no encontrado');
    if (user.role !== Role.SUPER_ADMIN && ds.companyId !== user.companyId) throw new ForbiddenException();
    const updated = await this.prisma.dropshipSupplier.update({
      where: { id },
      data: {
        active: dto.active,
        autoCreateOrders: dto.autoCreateOrders,
        leadTimeDays: dto.leadTimeDays,
        notes: dto.notes,
        catalogUrl: dto.catalogUrl === '' ? null : dto.catalogUrl,
        ...(dto.fieldMapping !== undefined ? { fieldMapping: dto.fieldMapping as any } : {}),
        ...(dto.connectorType !== undefined ? { connectorType: dto.connectorType } : {}),
        // Cambiar credenciales invalida el token cacheado.
        ...(dto.credentials !== undefined ? { credentials: dto.credentials as any, apiToken: null, apiTokenExpiresAt: null } : {}),
      },
      include: { supplier: true, _count: { select: { products: true, orders: true } } },
    });
    return this.sanitizeSupplier(updated);
  }

  // Trae una muestra del feed del proveedor (sin guardar nada) para que el admin vea
  // qué columnas entrega realmente y las asocie con nuestros campos antes de sincronizar.
  async previewFeed(catalogUrl: string) {
    const url = (catalogUrl || '').trim();
    if (!/^https?:\/\//i.test(url)) {
      throw new BadRequestException('Ingresa una URL de catálogo válida (http/https)');
    }

    let text: string;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
    } catch (err: any) {
      throw new BadRequestException(`No se pudo descargar el catálogo: ${err?.message || err}`);
    }

    const records = extractFeedRecords(text);
    if (!records.length) throw new BadRequestException('El catálogo no tiene filas legibles (se espera JSON o CSV)');

    const columnSet = new Set<string>();
    records.slice(0, 20).forEach((r) => Object.keys(r).forEach((k) => columnSet.add(k)));
    const columns = Array.from(columnSet);

    return {
      columns,
      sample: records.slice(0, 3),
      suggestedMapping: suggestMapping(columns),
    };
  }

  // ─── Sincronización del catálogo del proveedor ────────────────────────────

  // Descarga el feed del proveedor (JSON o CSV) y sincroniza los productos: crea
  // los nuevos en el catálogo (marcados como dropship) y actualiza en los existentes
  // el nombre/foto/descripción/cantidad/precio que informa el proveedor.
  async syncCatalog(id: string, user: any, catalogUrl?: string) {
    const ds = await this.prisma.dropshipSupplier.findUnique({ where: { id } });
    if (!ds) throw new NotFoundException('Proveedor dropship no encontrado');
    if (user.role !== Role.SUPER_ADMIN && ds.companyId !== user.companyId) throw new ForbiddenException();

    if (ds.connectorType !== DropshipConnectorType.FEED) {
      return this.syncFromApiProvider(ds);
    }

    const url = (catalogUrl || ds.catalogUrl || '').trim();
    if (!/^https?:\/\//i.test(url)) {
      throw new BadRequestException('Configura una URL de catálogo válida (http/https) para el proveedor');
    }

    let text: string;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
    } catch (err: any) {
      throw new BadRequestException(`No se pudo descargar el catálogo: ${err?.message || err}`);
    }

    const rows = parseCatalogFeed(text, ds.fieldMapping as Record<string, string | null> | null);
    if (!rows.length) throw new BadRequestException('El catálogo no tiene filas legibles (se espera JSON o CSV con columna sku)');

    const result = await this.applyCatalogRows(ds, rows);

    await this.prisma.dropshipSupplier.update({
      where: { id },
      data: { lastSyncedAt: new Date(), catalogUrl: catalogUrl?.trim() || ds.catalogUrl },
    });

    return result;
  }

  // "Sincronizar" para un conector API: SOLO actualiza precio/stock/nombre de los
  // productos que el usuario ya eligió traer (DropshipProduct existente). No crea productos
  // nuevos — el catálogo de un proveedor como Noriega tiene 18.000+ SKU y no todos aplican
  // al negocio; para sumar productos nuevos el usuario los elige explícitamente con
  // browseCatalog()/importSelected() (ver "Buscar y agregar productos" en la UI).
  private async syncFromApiProvider(ds: DropshipSupplierRef) {
    const rows = await this.fetchProviderCatalog(ds);
    if (!rows.length) throw new BadRequestException('El proveedor no devolvió productos');

    const result = await this.applyCatalogRows(ds, rows, { createNew: false });
    await this.prisma.dropshipSupplier.update({ where: { id: ds.id }, data: { lastSyncedAt: new Date() } });
    return result;
  }

  // Descarga el catálogo completo del proveedor API (login + token cacheado + paginación)
  // y deja el token nuevo/reutilizado guardado. Usado tanto por el sync de actualización
  // como por la búsqueda para elegir productos nuevos.
  private async fetchProviderCatalog(ds: DropshipSupplierRef): Promise<CatalogRow[]> {
    const provider = this.apiProviders.get(ds.connectorType);
    if (!provider) throw new BadRequestException('Conector no soportado');

    const credentials = (ds.credentials as Record<string, string>) || {};
    if (!Object.keys(credentials).length) {
      throw new BadRequestException('Configura las credenciales del proveedor antes de continuar');
    }

    const cachedToken = ds.apiToken && ds.apiTokenExpiresAt
      ? { token: ds.apiToken, expiresAt: ds.apiTokenExpiresAt }
      : null;

    let fetchResult;
    try {
      fetchResult = await provider.fetchCatalog(credentials, cachedToken);
    } catch (err: any) {
      throw new BadRequestException(`No se pudo conectar con el proveedor: ${err?.message || err}`);
    }

    // Cachea el token nuevo/reutilizado ya mismo, para no perderlo si algo falla después.
    await this.prisma.dropshipSupplier.update({
      where: { id: ds.id },
      data: { apiToken: fetchResult.tokenCache.token, apiTokenExpiresAt: fetchResult.tokenCache.expiresAt },
    });

    this.catalogCache.set(ds.id, { rows: fetchResult.rows, hasMore: false, nextProviderPage: null, fetchedAt: Date.now() });
    return fetchResult.rows;
  }

  // Trae UNA página del proveedor (rápido) y persiste el token. Usado por browseCatalog
  // para responder enseguida en vez de esperar el catálogo completo.
  private async fetchProviderPage(ds: DropshipSupplierRef, page: number) {
    const provider = this.apiProviders.get(ds.connectorType);
    if (!provider) throw new BadRequestException('Conector no soportado');

    const credentials = (ds.credentials as Record<string, string>) || {};
    if (!Object.keys(credentials).length) {
      throw new BadRequestException('Configura las credenciales del proveedor antes de continuar');
    }

    const cachedToken = ds.apiToken && ds.apiTokenExpiresAt
      ? { token: ds.apiToken, expiresAt: ds.apiTokenExpiresAt }
      : null;

    let result;
    try {
      result = await provider.fetchPage(credentials, cachedToken, page);
    } catch (err: any) {
      throw new BadRequestException(`No se pudo conectar con el proveedor: ${err?.message || err}`);
    }

    await this.prisma.dropshipSupplier.update({
      where: { id: ds.id },
      data: { apiToken: result.tokenCache.token, apiTokenExpiresAt: result.tokenCache.expiresAt },
    });

    return result;
  }

  // Consulta (paginada, con búsqueda) el catálogo de un proveedor API para que el usuario
  // elija qué productos traer — no crea ni modifica nada todavía. Solo pide la primera
  // página del proveedor de entrada (rápido); "Cargar más" trae páginas adicionales.
  async browseCatalog(id: string, user: any, opts: { q?: string; page?: number; pageSize?: number; refresh?: boolean; loadMore?: boolean }) {
    const ds = await this.prisma.dropshipSupplier.findUnique({ where: { id } });
    if (!ds) throw new NotFoundException('Proveedor dropship no encontrado');
    if (user.role !== Role.SUPER_ADMIN && ds.companyId !== user.companyId) throw new ForbiddenException();
    if (ds.connectorType === DropshipConnectorType.FEED) {
      throw new BadRequestException('Este proveedor usa un feed URL; no tiene catálogo consultable por API');
    }

    let cached = this.catalogCache.get(id);
    const stale = !cached || Date.now() - cached.fetchedAt > CATALOG_CACHE_TTL_MS;

    if (opts.refresh || stale) {
      const first = await this.fetchProviderPage(ds, 1);
      cached = { rows: first.rows, hasMore: first.hasMore, nextProviderPage: first.nextPage, fetchedAt: Date.now() };
      this.catalogCache.set(id, cached);
    } else if (opts.loadMore && cached!.hasMore && cached!.nextProviderPage != null) {
      const next = await this.fetchProviderPage(ds, cached!.nextProviderPage);
      cached = {
        rows: [...cached!.rows, ...next.rows],
        hasMore: next.hasMore,
        nextProviderPage: next.nextPage,
        fetchedAt: cached!.fetchedAt,
      };
      this.catalogCache.set(id, cached);
    }

    const linked = await this.prisma.dropshipProduct.findMany({
      where: { dropshipSupplierId: id },
      select: { supplierSku: true },
    });
    const linkedSkus = new Set(linked.map((p) => p.supplierSku).filter(Boolean) as string[]);

    let rows = cached!.rows;
    const q = (opts.q || '').trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) =>
        r.sku.toLowerCase().includes(q) ||
        r.name?.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q));
    }

    const total = rows.length;
    const pageSize = Math.min(Math.max(1, opts.pageSize ?? 50), 200);
    const page = Math.max(1, opts.page ?? 1);
    const pageRows = rows
      .slice((page - 1) * pageSize, page * pageSize)
      .map((r) => ({ ...r, alreadyLinked: linkedSkus.has(r.sku) }));

    return {
      rows: pageRows,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / pageSize)),
      fetchedAt: new Date(cached!.fetchedAt).toISOString(),
      // Hay más productos en el proveedor que todavía no se han traído al buscador
      // (el catálogo completo no cabe/no conviene descargarlo entero de una).
      providerHasMore: cached!.hasMore,
    };
  }

  // Importa solo los SKU que el usuario seleccionó tras consultar el catálogo (browseCatalog).
  async importSelected(id: string, user: any, skus: string[]) {
    const ds = await this.prisma.dropshipSupplier.findUnique({ where: { id } });
    if (!ds) throw new NotFoundException('Proveedor dropship no encontrado');
    if (user.role !== Role.SUPER_ADMIN && ds.companyId !== user.companyId) throw new ForbiddenException();
    if (ds.connectorType === DropshipConnectorType.FEED) {
      throw new BadRequestException('Este proveedor usa un feed URL; usa "Sincronizar" en vez de esto');
    }
    if (!skus?.length) throw new BadRequestException('Selecciona al menos un producto');

    const cached = this.catalogCache.get(id);
    if (!cached) throw new BadRequestException('Primero consulta el catálogo del proveedor');

    const wanted = new Set(skus);
    const rows = cached.rows.filter((r) => wanted.has(r.sku));
    if (!rows.length) throw new BadRequestException('Esos productos ya no están en el último catálogo consultado; actualiza la búsqueda');

    const result = await this.applyCatalogRows(ds, rows, { createNew: true });
    await this.prisma.dropshipSupplier.update({ where: { id }, data: { lastSyncedAt: new Date() } });
    return result;
  }

  // Crea/actualiza DropshipProduct y Product a partir de filas ya normalizadas, sin
  // importar si vinieron de un feed CSV/JSON o de una API autenticada.
  // createNew=false (usado por el sync de "actualización" de un conector API) solo
  // refresca los productos ya vinculados; nunca crea ni auto-vincula uno nuevo — eso
  // requiere que el usuario lo elija explícitamente vía importSelected().
  private async applyCatalogRows(ds: { id: string; companyId: string }, rows: CatalogRow[], opts: { createNew?: boolean } = {}) {
    const createNew = opts.createNew ?? true;
    let created = 0;
    let updated = 0;
    const skipped: string[] = [];
    const id = ds.id;

    for (const row of rows) {
      if (!row.sku) { skipped.push('(fila sin SKU)'); continue; }

      const existingDp = await this.prisma.dropshipProduct.findFirst({
        where: { dropshipSupplierId: id, supplierSku: row.sku },
      });

      const cost = row.cost ?? existingDp?.supplierCost ?? undefined;

      if (!existingDp && !createNew) { skipped.push(`${row.sku} (no importado — usa "Buscar y agregar productos")`); continue; }

      if (existingDp) {
        await this.prisma.$transaction([
          this.prisma.dropshipProduct.update({
            where: { id: existingDp.id },
            data: {
              supplierName: row.name ?? existingDp.supplierName,
              supplierImageUrl: row.imageUrl ?? existingDp.supplierImageUrl,
              supplierDescription: row.description ?? existingDp.supplierDescription,
              supplierStock: row.stock ?? existingDp.supplierStock,
              ...(cost != null ? { supplierCost: cost } : {}),
              lastSyncedAt: new Date(),
            },
          }),
          this.prisma.product.update({
            where: { id: existingDp.productId },
            data: {
              ...(cost != null ? { supplierPrice: cost } : {}),
              ...(row.stock != null ? { stock: row.stock } : {}),
            },
          }),
        ]);
        updated++;
        continue;
      }

      // Sin DropshipProduct para este SKU: engancha el Product del catálogo por SKU,
      // o créalo si no existe.
      const product = await this.prisma.product.findUnique({
        where: { sku_companyId: { sku: row.sku, companyId: ds.companyId } },
      });

      if (product) {
        const linkedElsewhere = await this.prisma.dropshipProduct.findUnique({ where: { productId: product.id } });
        if (linkedElsewhere) { skipped.push(`${row.sku} (ya vinculado a otro proveedor)`); continue; }
        if (cost == null) { skipped.push(`${row.sku} (sin precio de proveedor)`); continue; }
        await this.prisma.$transaction([
          this.prisma.dropshipProduct.create({
            data: {
              companyId: ds.companyId,
              productId: product.id,
              dropshipSupplierId: id,
              supplierSku: row.sku,
              supplierCost: cost,
              supplierName: row.name,
              supplierImageUrl: row.imageUrl,
              supplierDescription: row.description,
              supplierStock: row.stock ?? null,
              lastSyncedAt: new Date(),
            },
          }),
          this.prisma.product.update({
            where: { id: product.id },
            data: { dropship: true, supplierPrice: cost, ...(row.stock != null ? { stock: row.stock } : {}) },
          }),
        ]);
        created++;
        continue;
      }

      if (cost == null || !row.name) { skipped.push(`${row.sku} (faltan nombre o precio para crear el producto)`); continue; }
      await this.prisma.$transaction(async (tx) => {
        const newProduct = await tx.product.create({
          data: {
            companyId: ds.companyId,
            sku: row.sku,
            name: row.name!,
            description: row.description ?? null,
            price: row.price ?? cost,
            supplierPrice: cost,
            cost: cost,
            stock: row.stock ?? 0,
            dropship: true,
          },
        });
        await tx.dropshipProduct.create({
          data: {
            companyId: ds.companyId,
            productId: newProduct.id,
            dropshipSupplierId: id,
            supplierSku: row.sku,
            supplierCost: cost,
            supplierName: row.name,
            supplierImageUrl: row.imageUrl,
            supplierDescription: row.description,
            supplierStock: row.stock ?? null,
            lastSyncedAt: new Date(),
          },
        });
      });
      created++;
    }

    return { created, updated, skipped };
  }

  async removeSupplier(id: string, user: any) {
    const ds = await this.prisma.dropshipSupplier.findUnique({
      where: { id },
      include: { _count: { select: { orders: true } }, products: { select: { productId: true } } },
    });
    if (!ds) throw new NotFoundException('Proveedor dropship no encontrado');
    if (user.role !== Role.SUPER_ADMIN && ds.companyId !== user.companyId) throw new ForbiddenException();
    if (ds._count.orders > 0) {
      throw new ConflictException(`Tiene ${ds._count.orders} pedido(s) registrado(s). Desactívalo en vez de eliminarlo.`);
    }
    await this.prisma.$transaction([
      this.prisma.product.updateMany({
        where: { id: { in: ds.products.map((p) => p.productId) } },
        data: { dropship: false },
      }),
      this.prisma.dropshipSupplier.delete({ where: { id } }),
    ]);
    return { deleted: true };
  }

  // ─── Productos dropship ───────────────────────────────────────────────────

  async listProducts(user: any, companyId?: string) {
    const where = this.scopeWhere(user, companyId);
    const [linked, availableProducts] = await Promise.all([
      this.prisma.dropshipProduct.findMany({
        where,
        include: {
          product: { select: { id: true, sku: true, name: true, price: true, mlPrice: true } },
          dropshipSupplier: { include: { supplier: { select: { id: true, name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.product.findMany({
        where: { ...where, active: true, dropshipProduct: null },
        select: { id: true, sku: true, name: true, price: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return { linked, availableProducts };
  }

  async createProduct(dto: CreateDropshipProductDto, user: any) {
    const companyId = this.resolveCompanyId(user, dto.companyId);

    const [product, ds] = await Promise.all([
      this.prisma.product.findUnique({ where: { id: dto.productId } }),
      this.prisma.dropshipSupplier.findUnique({ where: { id: dto.dropshipSupplierId } }),
    ]);
    if (!product || product.companyId !== companyId) throw new BadRequestException('Producto no válido para esta empresa');
    if (!ds || ds.companyId !== companyId) throw new BadRequestException('Proveedor dropship no válido para esta empresa');

    const existing = await this.prisma.dropshipProduct.findUnique({ where: { productId: dto.productId } });
    if (existing) throw new ConflictException('Ese producto ya está vinculado a un proveedor dropship');

    const [created] = await this.prisma.$transaction([
      this.prisma.dropshipProduct.create({
        data: {
          companyId,
          productId: dto.productId,
          dropshipSupplierId: dto.dropshipSupplierId,
          supplierCost: dto.supplierCost,
          supplierSku: dto.supplierSku,
          leadTimeDays: dto.leadTimeDays ?? null,
        },
        include: {
          product: { select: { id: true, sku: true, name: true, price: true, mlPrice: true } },
          dropshipSupplier: { include: { supplier: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.product.update({
        where: { id: dto.productId },
        data: { dropship: true, supplierPrice: dto.supplierCost },
      }),
    ]);
    return created;
  }

  async updateProduct(id: string, dto: UpdateDropshipProductDto, user: any) {
    const dp = await this.prisma.dropshipProduct.findUnique({ where: { id } });
    if (!dp) throw new NotFoundException('Producto dropship no encontrado');
    if (user.role !== Role.SUPER_ADMIN && dp.companyId !== user.companyId) throw new ForbiddenException();

    const active = dto.active ?? dp.active;
    const [updated] = await this.prisma.$transaction([
      this.prisma.dropshipProduct.update({
        where: { id },
        data: {
          supplierCost: dto.supplierCost,
          supplierSku: dto.supplierSku,
          leadTimeDays: dto.leadTimeDays,
          active: dto.active,
        },
        include: {
          product: { select: { id: true, sku: true, name: true, price: true, mlPrice: true } },
          dropshipSupplier: { include: { supplier: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.product.update({
        where: { id: dp.productId },
        data: {
          dropship: active,
          ...(dto.supplierCost != null ? { supplierPrice: dto.supplierCost } : {}),
        },
      }),
    ]);
    return updated;
  }

  async removeProduct(id: string, user: any) {
    const dp = await this.prisma.dropshipProduct.findUnique({ where: { id } });
    if (!dp) throw new NotFoundException('Producto dropship no encontrado');
    if (user.role !== Role.SUPER_ADMIN && dp.companyId !== user.companyId) throw new ForbiddenException();
    await this.prisma.$transaction([
      this.prisma.dropshipProduct.delete({ where: { id } }),
      this.prisma.product.update({ where: { id: dp.productId }, data: { dropship: false } }),
    ]);
    return { deleted: true };
  }

  // ─── Pedidos al proveedor ─────────────────────────────────────────────────

  async listOrders(user: any, query: ListDropshipOrdersDto) {
    const page = Math.max(1, Number(query.page ?? 1));
    const where: Prisma.DropshipOrderWhereInput = this.scopeWhere(user, query.companyId);
    if (query.status) where.status = query.status;
    if (query.dropshipSupplierId) where.dropshipSupplierId = query.dropshipSupplierId;

    const [orders, total] = await Promise.all([
      this.prisma.dropshipOrder.findMany({
        where,
        include: {
          items: true,
          dropshipSupplier: { include: { supplier: { select: { id: true, name: true, email: true } } } },
          sale: { select: { id: true, channel: true, externalId: true, customerName: true, customerEmail: true, address: true, commune: true, city: true, createdAt: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.dropshipOrder.count({ where }),
    ]);
    return { orders, total, page, pages: Math.ceil(total / PAGE_SIZE) };
  }

  async getOrder(id: string, user: any) {
    const order = await this.prisma.dropshipOrder.findUnique({
      where: { id },
      include: {
        items: { include: { product: { select: { id: true, sku: true, name: true } } } },
        dropshipSupplier: { include: { supplier: true } },
        sale: true,
      },
    });
    if (!order) throw new NotFoundException('Pedido dropship no encontrado');
    if (user.role !== Role.SUPER_ADMIN && order.companyId !== user.companyId) throw new ForbiddenException();
    return order;
  }

  async updateOrder(id: string, dto: UpdateDropshipOrderDto, user: any) {
    const order = await this.getOrder(id, user);

    const data: Prisma.DropshipOrderUpdateInput = {
      trackingCode: dto.trackingCode,
      courier: dto.courier,
      supplierRef: dto.supplierRef,
      notes: dto.notes,
    };

    if (dto.status && dto.status !== order.status) {
      data.status = dto.status;
      const now = new Date();
      if (dto.status === DropshipOrderStatus.SENT && !order.sentAt) data.sentAt = now;
      if (dto.status === DropshipOrderStatus.CONFIRMED && !order.confirmedAt) data.confirmedAt = now;
      if (dto.status === DropshipOrderStatus.SHIPPED && !order.shippedAt) data.shippedAt = now;
      if (dto.status === DropshipOrderStatus.DELIVERED && !order.deliveredAt) data.deliveredAt = now;
      if (dto.status === DropshipOrderStatus.CANCELLED && !order.cancelledAt) data.cancelledAt = now;
    }

    return this.prisma.dropshipOrder.update({
      where: { id },
      data,
      include: {
        items: true,
        dropshipSupplier: { include: { supplier: { select: { id: true, name: true, email: true } } } },
        sale: { select: { id: true, channel: true, externalId: true, customerName: true } },
      },
    });
  }

  async sendOrder(id: string, user: any) {
    const order = await this.getOrder(id, user);
    if (order.status === DropshipOrderStatus.CANCELLED) {
      throw new BadRequestException('El pedido está cancelado');
    }
    const to = order.dropshipSupplier.supplier.email?.trim();
    if (!to) throw new BadRequestException('El proveedor no tiene correo configurado');

    await this.email.sendDropshipOrderEmail(order.companyId, to, order);

    return this.prisma.dropshipOrder.update({
      where: { id },
      data: {
        status: order.status === DropshipOrderStatus.PENDING ? DropshipOrderStatus.SENT : order.status,
        sentAt: order.sentAt ?? new Date(),
      },
      include: {
        items: true,
        dropshipSupplier: { include: { supplier: { select: { id: true, name: true, email: true } } } },
        sale: { select: { id: true, channel: true, externalId: true, customerName: true } },
      },
    });
  }

  // ─── Generación de pedidos desde las ventas ───────────────────────────────

  // Recorre las ventas recientes con productos dropship y crea el pedido al proveedor
  // correspondiente (uno por venta y proveedor). Idempotente: el índice único
  // (saleId, dropshipSupplierId) evita duplicar y se ignoran las colisiones.
  async generateOrders(companyId: string, sinceDays = 30) {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

    const dropshipProducts = await this.prisma.dropshipProduct.findMany({
      where: { companyId, active: true },
      include: { dropshipSupplier: true },
    });
    if (!dropshipProducts.length) return { created: 0, sent: 0, skipped: 0 };

    const byProduct = new Map(dropshipProducts.map((dp) => [dp.productId, dp]));

    const sales = await this.prisma.sale.findMany({
      where: {
        companyId,
        createdAt: { gte: since },
        items: { some: { productId: { in: [...byProduct.keys()] } } },
      },
      include: {
        items: { include: { product: { select: { id: true, sku: true, name: true } } } },
        dropshipOrders: { select: { dropshipSupplierId: true } },
      },
    });

    let created = 0;
    let sent = 0;
    let skipped = 0;

    for (const sale of sales) {
      const alreadyBySupplier = new Set(sale.dropshipOrders.map((o) => o.dropshipSupplierId));

      // Agrupa los ítems dropship de la venta por proveedor.
      const groups = new Map<string, typeof sale.items>();
      for (const item of sale.items) {
        const dp = byProduct.get(item.productId);
        if (!dp) continue;
        const arr = groups.get(dp.dropshipSupplierId) ?? [];
        arr.push(item);
        groups.set(dp.dropshipSupplierId, arr);
      }

      for (const [dropshipSupplierId, items] of groups) {
        if (alreadyBySupplier.has(dropshipSupplierId)) { skipped++; continue; }

        const ds = dropshipProducts.find((dp) => dp.dropshipSupplierId === dropshipSupplierId)!.dropshipSupplier;

        let supplierCost = 0;
        let saleAmount = 0;
        const orderItems = items.map((item) => {
          const dp = byProduct.get(item.productId)!;
          const unitCost = Number(dp.supplierCost);
          supplierCost += unitCost * item.quantity;
          saleAmount += Number(item.unitPrice) * item.quantity;
          return {
            productId: item.productId,
            saleItemId: item.id,
            productName: item.product.name,
            productSku: item.product.sku,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            unitCost: new Prisma.Decimal(unitCost),
          };
        });

        // Comisión del canal prorrateada por la parte dropship de la venta.
        const saleTotal = Number(sale.total) || 0;
        const channelFee = sale.marketplaceFee && saleTotal > 0
          ? new Prisma.Decimal((Number(sale.marketplaceFee) * saleAmount) / saleTotal)
          : null;

        try {
          const order = await this.prisma.$transaction(async (tx) => {
            const dropOrder = await tx.dropshipOrder.create({
              data: {
                companyId,
                dropshipSupplierId,
                saleId: sale.id,
                status: DropshipOrderStatus.PENDING,
                supplierCost: new Prisma.Decimal(supplierCost),
                saleAmount: new Prisma.Decimal(saleAmount),
                channelFee,
                items: { create: orderItems },
              },
              include: {
                items: true,
                dropshipSupplier: { include: { supplier: true } },
                sale: true,
              },
            });

            // Costea las líneas dropship de la venta al costo del proveedor (si aún no).
            for (const item of items) {
              const dp = byProduct.get(item.productId)!;
              if (item.totalCost == null) {
                await tx.saleItem.update({
                  where: { id: item.id },
                  data: { totalCost: new Prisma.Decimal(Number(dp.supplierCost) * item.quantity) },
                });
              }
            }
            return dropOrder;
          });

          created++;

          if (ds.autoCreateOrders && order.dropshipSupplier.supplier.email?.trim()) {
            try {
              await this.email.sendDropshipOrderEmail(
                companyId,
                order.dropshipSupplier.supplier.email.trim(),
                order,
              );
              await this.prisma.dropshipOrder.update({
                where: { id: order.id },
                data: { status: DropshipOrderStatus.SENT, sentAt: new Date() },
              });
              sent++;
            } catch (err: any) {
              this.logger.warn(`No se pudo enviar el pedido dropship ${order.id} al proveedor: ${err?.message}`);
            }
          }
        } catch (err: any) {
          if (err?.code === 'P2002') { skipped++; continue; } // otra corrida lo creó
          throw err;
        }
      }
    }

    return { created, sent, skipped };
  }

  async generateOrdersForUser(user: any, companyId?: string, sinceDays?: number) {
    const cid = this.resolveCompanyId(user, companyId);
    return this.generateOrders(cid, sinceDays ?? 30);
  }

  // ─── Reporte de rentabilidad dropship ────────────────────────────────────

  async report(user: any, companyId?: string, from?: string, to?: string) {
    const where: Prisma.DropshipOrderWhereInput = this.scopeWhere(user, companyId);
    where.status = { not: DropshipOrderStatus.CANCELLED };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const orders = await this.prisma.dropshipOrder.findMany({
      where,
      include: {
        dropshipSupplier: { include: { supplier: { select: { id: true, name: true } } } },
        sale: { select: { id: true, channel: true, externalId: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const rows = orders.map((o) => {
      const saleAmount = Number(o.saleAmount);
      const supplierCost = Number(o.supplierCost);
      const channelFee = Number(o.channelFee ?? 0);
      const margin = saleAmount - supplierCost - channelFee;
      return {
        id: o.id,
        createdAt: o.createdAt,
        status: o.status,
        supplierName: o.dropshipSupplier.supplier.name,
        saleChannel: o.sale.channel,
        saleRef: o.sale.externalId ?? o.sale.id.slice(-8).toUpperCase(),
        saleAmount,
        supplierCost,
        channelFee,
        margin,
        marginPct: saleAmount > 0 ? (margin / saleAmount) * 100 : 0,
      };
    });

    const totals = rows.reduce(
      (acc, r) => ({
        orders: acc.orders + 1,
        saleAmount: acc.saleAmount + r.saleAmount,
        supplierCost: acc.supplierCost + r.supplierCost,
        channelFee: acc.channelFee + r.channelFee,
        margin: acc.margin + r.margin,
      }),
      { orders: 0, saleAmount: 0, supplierCost: 0, channelFee: 0, margin: 0 },
    );

    return {
      rows,
      totals: {
        ...totals,
        marginPct: totals.saleAmount > 0 ? (totals.margin / totals.saleAmount) * 100 : 0,
      },
    };
  }

  // Empresas con el módulo dropshipping activo (para el cron).
  async companiesWithModule(): Promise<string[]> {
    const companies = await this.prisma.company.findMany({
      where: { active: true },
      select: { id: true, modules: true },
    });
    return companies
      .filter((c) => {
        const mods = c.modules as unknown;
        if (!mods || !Array.isArray(mods)) return true; // null = todos licenciados
        return mods.some((m: string) => m === 'dropshipping' || m.startsWith('dropshipping_'));
      })
      .map((c) => c.id);
  }
}

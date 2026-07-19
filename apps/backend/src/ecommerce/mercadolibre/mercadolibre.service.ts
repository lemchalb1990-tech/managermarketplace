import {
  Injectable, Logger, BadRequestException, NotFoundException,
  InternalServerErrorException, ForbiddenException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Role, SaleChannel, MovementType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService } from '../../catalog/catalog.service';
import { SettingsService } from '../../settings/settings.service';
import { ListingStatus } from '@prisma/client';
import { SyncService } from '../sync/sync.service';

const ML_API = 'https://api.mercadolibre.com';
const ML_AUTH = 'https://auth.mercadolibre.cl';

@Injectable()
export class MercadolibreService {
  private readonly logger = new Logger(MercadolibreService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private catalog: CatalogService,
    private settings: SettingsService,
    private sync: SyncService,
  ) {}

  // ─── Credenciales por empresa ────────────────────────────────────────────────

  private async getCompanyCredentials(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { mlClientId: true, mlClientSecret: true },
    });
    const clientId = company?.mlClientId || this.config.get('ML_CLIENT_ID');
    const clientSecret = company?.mlClientSecret || this.config.get('ML_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      throw new BadRequestException(
        'Configura el Client ID y Secret de Mercado Libre en la sección Mercado Libre antes de continuar.',
      );
    }
    return { clientId, clientSecret };
  }

  async getMlSettings(user: any, companyId?: string) {
    const cid = user.role !== Role.SUPER_ADMIN ? user.companyId : companyId;
    if (!cid) return { mlClientId: null, hasSecret: false };
    const company = await this.prisma.company.findUnique({
      where: { id: cid },
      select: { mlClientId: true, mlClientSecret: true },
    });
    return {
      mlClientId: company?.mlClientId || null,
      hasSecret: !!company?.mlClientSecret,
    };
  }

  async saveCredentials(user: any, mlClientId: string, mlClientSecret: string, companyId?: string) {
    const cid = user.role !== Role.SUPER_ADMIN ? user.companyId : companyId;
    if (!cid) throw new BadRequestException('Selecciona una empresa');
    return this.prisma.company.update({
      where: { id: cid },
      data: { mlClientId, mlClientSecret },
      select: { id: true, name: true, mlClientId: true },
    });
  }

  // ─── OAuth ───────────────────────────────────────────────────────────────────

  async createCredentialConnection(user: any, name: string, mlClientId: string, mlClientSecret: string, companyId?: string) {
    const cid = user.role === Role.SUPER_ADMIN ? companyId : user.companyId;
    if (!cid) throw new BadRequestException('companyId requerido');
    if (!mlClientId?.trim() || !mlClientSecret?.trim()) {
      throw new BadRequestException('Client ID y Client Secret son requeridos');
    }
    const conn = await this.prisma.marketplaceConnection.create({
      data: {
        name,
        marketplace: 'MERCADO_LIBRE',
        mlClientId: mlClientId.trim(),
        mlClientSecret: mlClientSecret.trim(),
        accessToken: '',
        active: false,
        companyId: cid,
      },
      select: {
        id: true, name: true, marketplace: true, mlClientId: true, active: true, expiresAt: true, createdAt: true,
        company: { select: { id: true, name: true } },
      },
    });
    return { ...conn, authorized: false };
  }

  private async getRedirectUri(): Promise<string> {
    const appUrl = await this.settings.get('APP_URL');
    if (!appUrl) {
      throw new BadRequestException(
        'Configura la URL del backend (APP_URL) en Configuración antes de conectar Mercado Libre.',
      );
    }
    return `${appUrl.replace(/\/+$/, '')}/api/ecommerce/ml/callback`;
  }

  async getAuthUrlForConnection(connectionId: string, user: any): Promise<string> {
    const conn = await this.getConnectionForUser(connectionId, user);
    if (!conn.mlClientId || !conn.mlClientSecret) {
      throw new BadRequestException('Esta conexión no tiene credenciales guardadas');
    }
    const redirectUri = await this.getRedirectUri();

    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    const state = Buffer.from(JSON.stringify({ connectionId: conn.id, codeVerifier })).toString('base64url');
    return `${ML_AUTH}/authorization?response_type=code&client_id=${conn.mlClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
  }

  async handleCallback(code: string, state: string, fallbackName: string) {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
    const connectionId: string = decoded.connectionId;
    const codeVerifier: string = decoded.codeVerifier;

    const draft = await this.prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
    if (!draft) throw new BadRequestException('Conexión no encontrada');

    const clientId = draft.mlClientId;
    const clientSecret = draft.mlClientSecret;
    const redirectUri = await this.getRedirectUri();

    const res = await fetch(`${ML_API}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      this.logger.error(`ML token exchange failed [${res.status}]: ${err}`);
      throw new BadRequestException('Error al conectar con Mercado Libre');
    }

    const tokens = await res.json() as any;
    return this.prisma.marketplaceConnection.update({
      where: { id: connectionId },
      data: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        active: true,
      },
    });
  }

  // ─── Token management ────────────────────────────────────────────────────────

  private async refreshToken(connectionId: string) {
    const conn = await this.prisma.marketplaceConnection.findUnique({
      where: { id: connectionId },
      include: { company: { select: { mlClientId: true, mlClientSecret: true } } },
    });
    if (!conn?.refreshToken) throw new InternalServerErrorException('Sin refresh token');

    const clientId = conn.mlClientId || conn.company?.mlClientId || this.config.get('ML_CLIENT_ID');
    const clientSecret = conn.mlClientSecret || conn.company?.mlClientSecret || this.config.get('ML_CLIENT_SECRET');

    const res = await fetch(`${ML_API}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: conn.refreshToken,
      }),
    });

    if (!res.ok) throw new InternalServerErrorException('Error al renovar token de ML');

    const tokens = await res.json() as any;
    return this.prisma.marketplaceConnection.update({
      where: { id: connectionId },
      data: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      },
    });
  }

  private async getValidToken(connectionId: string): Promise<string> {
    let conn = await this.prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');
    if (conn.expiresAt && conn.expiresAt < new Date(Date.now() + 5 * 60 * 1000)) {
      conn = await this.refreshToken(connectionId);
    }
    return conn.accessToken;
  }

  async refreshConnectionToken(connectionId: string, user: any) {
    const conn = await this.prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) {
      throw new ForbiddenException();
    }
    const updated = await this.refreshToken(connectionId);
    return {
      id: updated.id,
      name: updated.name,
      active: updated.active,
      expiresAt: updated.expiresAt,
    };
  }

  // ─── Connections ─────────────────────────────────────────────────────────────

  async getConnections(user: any, companyId?: string) {
    const where: any = { marketplace: 'MERCADO_LIBRE', OR: [{ active: true }, { accessToken: '' }] };
    if (user.role !== Role.SUPER_ADMIN) {
      where.companyId = user.companyId;
    } else if (companyId) {
      where.companyId = companyId;
    }
    const rows = await this.prisma.marketplaceConnection.findMany({
      where,
      select: {
        id: true, name: true, marketplace: true, mlClientId: true, active: true, accessToken: true,
        expiresAt: true, createdAt: true,
        company: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(({ accessToken, ...rest }) => ({ ...rest, authorized: !!accessToken }));
  }

  async removeConnection(id: string, user: any) {
    const conn = await this.prisma.marketplaceConnection.findUnique({ where: { id } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) {
      throw new ForbiddenException();
    }
    if (!conn.accessToken) {
      return this.prisma.marketplaceConnection.delete({ where: { id } });
    }
    return this.prisma.marketplaceConnection.update({ where: { id }, data: { active: false } });
  }

  // ─── Categorías ──────────────────────────────────────────────────────────────

  async searchCategories(q: string) {
    if (!q?.trim()) return [];
    try {
      const res = await fetch(
        `${ML_API}/sites/MLC/domain_discovery/search?q=${encodeURIComponent(q)}&limit=8`,
      );
      if (!res.ok) {
        this.logger.error(`ML category search HTTP ${res.status}`);
        return [];
      }
      const data = await res.json() as any[];
      return (Array.isArray(data) ? data : [])
        .filter((item: any) => item?.category_id)
        .map((item: any) => ({
          id: item.category_id,
          name: item.domain_name,
        }));
    } catch (err) {
      this.logger.error('ML category search error', err);
      return [];
    }
  }

  async getCategoryAttributes(categoryId: string) {
    try {
      const [attrsRes, catRes] = await Promise.all([
        fetch(`${ML_API}/categories/${categoryId}/attributes`),
        fetch(`${ML_API}/categories/${categoryId}`),
      ]);

      const attrsData = attrsRes.ok ? await attrsRes.json() as any[] : [];
      const catData = catRes.ok ? await catRes.json() as any : {};

      const settings = catData.settings || {};
      const supportsHtml = !!settings.allow_pictures_in_description;

      const attributes = (Array.isArray(attrsData) ? attrsData : [])
        .filter((a: any) => a.tags?.required || a.tags?.catalog_required)
        .map((a: any) => ({
          id: a.id,
          name: a.name,
          value_type: a.value_type,
          values: Array.isArray(a.values) && a.values.length > 0
            ? a.values.map((v: any) => ({ id: v.id, name: v.name }))
            : [],
          required: !!a.tags?.required,
          catalog_required: !!a.tags?.catalog_required,
        }));

      return { attributes, supportsHtml };
    } catch (err) {
      this.logger.error('ML category attributes error', err);
      return { attributes: [], supportsHtml: false };
    }
  }

  private async upsertMlDescription(itemId: string, token: string, plainText: string): Promise<string | null> {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const payload = JSON.stringify({ plain_text: plainText });
    this.logger.log(`ML upsertDescription [${itemId}]: ${payload.substring(0, 200)}`);

    for (const method of ['PUT', 'POST'] as const) {
      const res = await fetch(`${ML_API}/items/${itemId}/description`, {
        method, headers, body: payload,
      });
      const text = await res.text();
      this.logger.log(`ML description ${method} [${res.status}]: ${text.substring(0, 100)}`);

      if (res.ok) {
        try {
          const data = JSON.parse(text);
          // ML puede responder 200 pero no guardar nada; verificar que plain_text no sea vacío
          if (data.plain_text && data.plain_text.trim()) return null;
          if (method === 'PUT') continue; // reintentar con POST
        } catch { return null; }
      }

      if (method === 'PUT' && (res.status === 404 || res.status === 405)) continue;

      try {
        const err = JSON.parse(text);
        return err.message || err.error || `HTTP ${res.status}`;
      } catch {
        return `HTTP ${res.status}`;
      }
    }
    return null;
  }

  // ─── Publicaciones ───────────────────────────────────────────────────────────

  async publishProduct(productId: string, connectionId: string, user: any) {
    const product = await this.catalog.findOne(productId, user);
    const token = await this.getValidToken(connectionId);

    const primaryImage = product.images.find((i: any) => i.isPrimary) || product.images[0];

    const categoryId = (product as any).mlCategoryId || await this.settings.get('ML_DEFAULT_CATEGORY');
    if (!categoryId) {
      throw new BadRequestException(
        'Debes asignar una categoría de Mercado Libre al producto antes de publicar.',
      );
    }

    const appUrl = await this.settings.get('APP_URL');
    const toAbsolute = (url: string) =>
      url.startsWith('http') ? url : `${appUrl}${url}`;

    const mlItem = {
      title: product.name,
      category_id: categoryId,
      price: Math.round(Number(product.mlPrice ?? product.price)),
      currency_id: 'CLP',
      available_quantity: product.stock,
      buying_mode: 'buy_it_now',
      listing_type_id: 'gold_special',
      condition: 'new',
      description: { plain_text: product.description || product.name },
      pictures: primaryImage ? [{ source: toAbsolute(primaryImage.url) }] : [],
      attributes: [
        { id: 'SELLER_SKU', value_name: product.sku },
        ...((product as any).mlAttributes || []),
      ],
    };

    const res = await fetch(`${ML_API}/items`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(mlItem),
    });

    if (!res.ok) {
      const err = await res.json() as any;
      this.logger.error('ML publish error', JSON.stringify(err));

      const mlErrors: string[] = Array.isArray(err.cause) && err.cause.length > 0
        ? err.cause.map((c: any) => c.message || c.reference || c.code).filter(Boolean)
        : [err.message || 'Error al publicar en Mercado Libre'];

      const summary = mlErrors[0];

      await this.prisma.listing.upsert({
        where: { productId_connectionId: { productId, connectionId } },
        update: { status: ListingStatus.ERROR, errorMsg: mlErrors.join(' | ') },
        create: { productId, connectionId, status: ListingStatus.ERROR, errorMsg: mlErrors.join(' | ') },
      });
      throw new BadRequestException({ message: summary, mlErrors });
    }

    const mlData = await res.json() as any;

    // Enviar descripción siempre vía endpoint dedicado
    let descriptionWarning: string | null = null;
    const rawPlainPublish = (product.description || product.name || '').trim();
    const safePlainPublish = rawPlainPublish.length >= 10
      ? rawPlainPublish
      : `${product.name}. ${product.name}. ${product.name}`;

    if (mlData.id) {
      const reason = await this.upsertMlDescription(mlData.id, token, safePlainPublish);
      if (reason) {
        descriptionWarning = `Publicación creada, pero la descripción fue rechazada por ML (${reason}).`;
      }
    }

    const listing = await this.prisma.listing.upsert({
      where: { productId_connectionId: { productId, connectionId } },
      update: {
        externalId: mlData.id,
        externalUrl: mlData.permalink,
        status: ListingStatus.ACTIVE,
        syncedAt: new Date(),
        errorMsg: null,
      },
      create: {
        productId, connectionId,
        externalId: mlData.id,
        externalUrl: mlData.permalink,
        status: ListingStatus.ACTIVE,
        syncedAt: new Date(),
      },
    });

    return { ...listing, descriptionWarning };
  }

  private async syncListingCore(product: any, listing: any, token: string): Promise<{ warnings: string[] }> {
    const warnings: string[] = [];

    // Sincronizar precio y stock (ML no permite cambiar título de items activos)
    const itemRes = await fetch(`${ML_API}/items/${listing.externalId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        price: Math.round(Number(product.mlPrice ?? product.price)),
        available_quantity: product.stock,
      }),
    });

    if (!itemRes.ok) {
      const err = await itemRes.json() as any;
      this.logger.error(`ML sync item error [${itemRes.status}]: ${JSON.stringify(err)}`);
      throw new BadRequestException(err.message || 'Error al sincronizar en Mercado Libre');
    }

    // Sincronizar descripción siempre con plain_text
    const rawPlain = (product.description || product.name || '').trim();
    const safePlain = rawPlain.length >= 10
      ? rawPlain
      : `${product.name}. ${product.name}. ${product.name}`;

    this.logger.log(`ML sync description [${listing.externalId}]: "${safePlain.substring(0, 80)}"`);
    const descErr = await this.upsertMlDescription(listing.externalId, token, safePlain);
    if (descErr) warnings.push(`Descripción no sincronizada: ${descErr}`);

    return { warnings };
  }

  async syncStock(productId: string, connectionId: string, user: any) {
    const product = await this.catalog.findOne(productId, user);
    const listing = await this.prisma.listing.findUnique({
      where: { productId_connectionId: { productId, connectionId } },
    });
    if (!listing?.externalId) throw new BadRequestException('La publicación no existe en ML');

    const token = await this.getValidToken(connectionId);
    const { warnings } = await this.syncListingCore(product, listing, token);

    const newStatus = product.stock === 0 ? ListingStatus.PAUSED : ListingStatus.ACTIVE;
    const updated = await this.prisma.listing.update({
      where: { id: listing.id },
      data: { status: newStatus, syncedAt: new Date() },
    });

    return { ...updated, warnings };
  }

  async syncAllListings(productId: string, user: any) {
    const product = await this.catalog.findOne(productId, user);
    const listings = await this.prisma.listing.findMany({
      where: {
        productId,
        externalId: { not: null },
        status: { in: [ListingStatus.ACTIVE, ListingStatus.PAUSED] },
        connection: { marketplace: 'MERCADO_LIBRE' },
      },
      include: { connection: { select: { id: true, name: true } } },
    });

    if (!listings.length) {
      throw new BadRequestException('Este producto no tiene publicaciones activas en Mercado Libre.');
    }

    const results: Array<{ connectionId: string; connectionName: string; success: boolean; warnings: string[]; error: string | null }> = [];

    for (const listing of listings) {
      try {
        const token = await this.getValidToken(listing.connectionId);
        const { warnings } = await this.syncListingCore(product, listing, token);
        const newStatus = product.stock === 0 ? ListingStatus.PAUSED : ListingStatus.ACTIVE;
        await this.prisma.listing.update({
          where: { id: listing.id },
          data: { status: newStatus, syncedAt: new Date() },
        });
        results.push({ connectionId: listing.connectionId, connectionName: listing.connection.name, success: true, warnings, error: null });
      } catch (err: any) {
        results.push({ connectionId: listing.connectionId, connectionName: listing.connection.name, success: false, warnings: [], error: err.message || 'Error desconocido' });
      }
    }

    return {
      syncedCount: results.filter((r) => r.success).length,
      failedCount: results.filter((r) => !r.success).length,
      results,
    };
  }

  async syncProductListings(productId: string, newStock: number) {
    const listings = await this.prisma.listing.findMany({
      where: { productId, status: { in: [ListingStatus.ACTIVE, ListingStatus.PAUSED] } },
    });
    if (!listings.length) return;

    for (const listing of listings) {
      if (!listing.externalId) continue;
      try {
        const token = await this.getValidToken(listing.connectionId);
        const newMlStatus = newStock === 0 ? 'paused' : 'active';
        await fetch(`${ML_API}/items/${listing.externalId}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ available_quantity: newStock, status: newMlStatus }),
        });
        const newStatus = newStock === 0 ? ListingStatus.PAUSED : ListingStatus.ACTIVE;
        await this.prisma.listing.update({
          where: { id: listing.id },
          data: { status: newStatus, syncedAt: new Date() },
        });
        this.logger.log(`ML post-venta: item=${listing.externalId} stock=${newStock} status=${newMlStatus}`);
      } catch (err) {
        this.logger.error(`ML post-venta sync error listing=${listing.id}`, err);
      }
    }
  }

  async toggleListingStatus(productId: string, connectionId: string, user: any) {
    const product = await this.catalog.findOne(productId, user);
    const listing = await this.prisma.listing.findUnique({
      where: { productId_connectionId: { productId, connectionId } },
    });
    if (!listing?.externalId) throw new BadRequestException('La publicación no existe en ML');

    const isActive = listing.status === ListingStatus.ACTIVE;
    const newMlStatus = isActive ? 'paused' : 'active';

    if (!isActive && product.stock === 0) {
      throw new BadRequestException('No se puede activar la publicación: el producto no tiene stock.');
    }

    const token = await this.getValidToken(connectionId);
    const res = await fetch(`${ML_API}/items/${listing.externalId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newMlStatus }),
    });

    if (!res.ok) {
      const err = await res.json() as any;
      throw new BadRequestException(err.message || `Error al ${isActive ? 'pausar' : 'activar'} en Mercado Libre`);
    }

    const newStatus = newMlStatus === 'active' ? ListingStatus.ACTIVE : ListingStatus.PAUSED;
    return this.prisma.listing.update({
      where: { id: listing.id },
      data: { status: newStatus, syncedAt: new Date() },
    });
  }

  // ─── Importación de publicaciones existentes ─────────────────────────────────

  private async getConnectionForUser(connectionId: string, user: any) {
    const conn = await this.prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) {
      throw new ForbiddenException();
    }
    return conn;
  }

  private extractSku(attributes: any[]): string | null {
    const attr = Array.isArray(attributes) ? attributes.find((a) => a.id === 'SELLER_SKU') : null;
    const value = attr?.value_name?.trim();
    return value || null;
  }

  // El ID de publicación de ML (item.id) es solo un identificador externo y se guarda
  // como externalId del Listing. Nunca debe usarse como SKU: cuando la publicación no
  // trae SELLER_SKU, se genera un SKU correlativo por empresa, editable luego por el usuario.
  private async nextSku(companyId: string): Promise<string> {
    let n = (await this.prisma.product.count({ where: { companyId } })) + 1;
    let sku = `SKU-${String(n).padStart(6, '0')}`;
    while (
      await this.prisma.product.findUnique({ where: { sku_companyId: { sku, companyId } } })
    ) {
      n++;
      sku = `SKU-${String(n).padStart(6, '0')}`;
    }
    return sku;
  }

  private async fetchMlItems(itemIds: string[], token: string): Promise<any[]> {
    const attrs = 'id,title,price,available_quantity,thumbnail,secure_thumbnail,permalink,status,category_id,attributes,pictures';
    const items: any[] = [];
    for (let i = 0; i < itemIds.length; i += 20) {
      const batch = itemIds.slice(i, i + 20);
      try {
        const res = await fetch(
          `${ML_API}/items?ids=${batch.join(',')}&attributes=${attrs}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) {
          this.logger.warn(`ML items batch fetch HTTP ${res.status}, se omite este lote`);
          continue;
        }
        const data = await res.json() as any[];
        for (const entry of data) {
          if (entry.code === 200 && entry.body) items.push(entry.body);
        }
      } catch (err: any) {
        this.logger.warn(`ML items batch fetch error, se omite este lote: ${err?.message || err}`);
      }
    }
    return items;
  }

  async previewImport(connectionId: string, user: any, scrollId?: string) {
    const conn = await this.getConnectionForUser(connectionId, user);
    const token = await this.getValidToken(connectionId);

    try {
      const meRes = await fetch(`${ML_API}/users/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (!meRes.ok) throw new BadRequestException('No se pudo obtener el usuario de Mercado Libre');
      const me = await meRes.json() as any;

      // Catálogos grandes (>1000) requieren la API de "scan" de ML, que pagina por
      // cursor (scroll_id) en vez de offset, sin techo de resultados totales.
      const PAGES_PER_BATCH = 3; // 3 x 100 = hasta 300 publicaciones por llamada
      const itemIds: string[] = [];
      let currentScrollId = scrollId;
      let total = 0;
      let lastPageEmpty = false;

      for (let i = 0; i < PAGES_PER_BATCH; i++) {
        const params = new URLSearchParams({ search_type: 'scan', limit: '100' });
        if (currentScrollId) params.set('scroll_id', currentScrollId);
        const searchRes = await fetch(
          `${ML_API}/users/${me.id}/items/search?${params}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!searchRes.ok) {
          const errBody = await searchRes.text();
          this.logger.error(`ML items scan failed [${searchRes.status}]: ${errBody}`);
          throw new BadRequestException(
            `Mercado Libre rechazó la búsqueda de publicaciones (HTTP ${searchRes.status}). Revisa los logs del backend para más detalle.`,
          );
        }
        const searchData = await searchRes.json() as any;
        total = searchData.paging?.total || total;
        currentScrollId = searchData.scroll_id;
        const pageResults: string[] = searchData.results || [];
        itemIds.push(...pageResults);
        if (pageResults.length === 0) { lastPageEmpty = true; break; }
      }

      const nextScrollId = currentScrollId || null;
      const hasMore = !lastPageEmpty && !!nextScrollId;

      const mlItems = await this.fetchMlItems(itemIds, token);

      const skus = mlItems.map((i) => this.extractSku(i.attributes)).filter((s): s is string => !!s);
      const [existingProducts, existingListings] = await Promise.all([
        this.prisma.product.findMany({
          where: { companyId: conn.companyId, sku: { in: skus } },
          select: { id: true, sku: true, name: true },
        }),
        this.prisma.listing.findMany({
          where: { connectionId, externalId: { in: mlItems.map((i) => i.id) } },
          select: { externalId: true, productId: true, product: { select: { name: true } } },
        }),
      ]);
      const productBySku = new Map(existingProducts.map((p) => [p.sku, p]));
      const listingByExternalId = new Map(existingListings.map((l) => [l.externalId, l]));

      const items = mlItems
        .filter((i) => !listingByExternalId.has(i.id))
        .map((i) => {
          const sku = this.extractSku(i.attributes);
          const matchedProduct = sku ? productBySku.get(sku) : undefined;
          return {
            externalId: i.id,
            title: i.title,
            price: i.price,
            stock: i.available_quantity,
            thumbnail: i.secure_thumbnail || i.thumbnail,
            permalink: i.permalink,
            status: i.status,
            sku,
            matchedProductId: matchedProduct?.id || null,
            matchedProductName: matchedProduct?.name || null,
          };
        });

      const alreadyImportedCount = mlItems.length - items.length;

      return { connectionName: conn.name, total, hasMore, nextScrollId, alreadyImportedCount, items };
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`previewImport error: ${err?.message || err}`, err?.stack);
      throw new BadRequestException(
        'Ocurrió un error inesperado al buscar publicaciones en Mercado Libre. Revisa los logs del backend.',
      );
    }
  }

  async confirmImport(connectionId: string, externalIds: string[], user: any, unlinkIds: string[] = []) {
    const conn = await this.getConnectionForUser(connectionId, user);
    const token = await this.getValidToken(connectionId);
    const unlinkSet = new Set(unlinkIds);

    let mlItems: any[];
    try {
      mlItems = await this.fetchMlItems(externalIds, token);
    } catch (err: any) {
      this.logger.error(`confirmImport fetchMlItems error: ${err?.message || err}`, err?.stack);
      throw new BadRequestException('No se pudo obtener el detalle de las publicaciones desde Mercado Libre.');
    }

    let imported = 0;
    let linked = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const item of mlItems) {
      try {
        const alreadyLinked = await this.prisma.listing.findFirst({
          where: { connectionId, externalId: item.id },
        });
        if (alreadyLinked) { skipped++; continue; }

        const status = item.status === 'active' ? ListingStatus.ACTIVE : ListingStatus.PAUSED;
        const forceNew = unlinkSet.has(item.id);
        const matchedSku = this.extractSku(item.attributes);
        const sku = (!forceNew && matchedSku) || (await this.nextSku(conn.companyId));

        const product = forceNew ? null : await this.prisma.product.findUnique({
          where: { sku_companyId: { sku, companyId: conn.companyId } },
        });

        if (product) {
          await this.prisma.listing.create({
            data: {
              productId: product.id,
              connectionId,
              externalId: item.id,
              externalUrl: item.permalink,
              status,
              syncedAt: new Date(),
            },
          });
          linked++;
        } else {
          const newProduct = await this.prisma.product.create({
            data: {
              sku,
              name: item.title,
              price: item.price,
              mlPrice: item.price,
              stock: item.available_quantity,
              mlCategoryId: item.category_id,
              companyId: conn.companyId,
            },
          });
          const pictures: Array<{ secure_url?: string; url?: string }> = Array.isArray(item.pictures) && item.pictures.length
            ? item.pictures
            : (item.secure_thumbnail || item.thumbnail ? [{ url: item.secure_thumbnail || item.thumbnail }] : []);

          for (let i = 0; i < pictures.length; i++) {
            const url = pictures[i].secure_url || pictures[i].url;
            if (!url) continue;
            await this.prisma.productImage.create({
              data: {
                productId: newProduct.id,
                filename: `${item.id}-${i}.jpg`,
                url,
                isPrimary: i === 0,
                order: i,
              },
            });
          }
          await this.prisma.listing.create({
            data: {
              productId: newProduct.id,
              connectionId,
              externalId: item.id,
              externalUrl: item.permalink,
              status,
              syncedAt: new Date(),
            },
          });
          imported++;
        }
      } catch (err: any) {
        this.logger.error(`confirmImport item ${item?.id} error: ${err?.message || err}`, err?.stack);
        errors.push(`${item?.id || 'ítem'}: ${err?.message || 'error desconocido'}`);
      }
    }

    return { imported, linked, skipped, errors };
  }

  // ─── Importación de ventas históricas (sin descontar stock) ──────────────────

  private computeOrderCharges(order: any) {
    const payment = (order.payments || [])[0] || {};
    const itemFees = (order.order_items || []).reduce((sum: number, oi: any) => sum + Number(oi.sale_fee || 0), 0);
    return {
      shippingCost: Math.round(Number(payment.shipping_cost || order.shipping?.cost || 0)),
      marketplaceFee: Math.round(Number(payment.marketplace_fee || itemFees || 0)),
      taxes: Math.round(Number(payment.taxes_amount || 0)),
      coupon: Math.round(Number(payment.coupon_amount || 0)),
      totalPaid: Math.round(Number(payment.total_paid_amount ?? order.total_amount ?? 0)),
    };
  }

  // Neto real que recibe el vendedor: precio del producto - comisión - envío a su cargo - impuestos - cupón.
  // Verificado contra el panel de ML: $8.499 - $1.530 - $799 = $6.170.
  private computeSellerNetAmount(order: any, charges: { marketplaceFee: number; shippingCost: number; taxes: number; coupon: number }): number {
    const productTotal = Math.round(Number(order.total_amount || 0));
    return productTotal - charges.marketplaceFee - charges.shippingCost - charges.taxes - charges.coupon;
  }

  private static readonly ML_LOGISTIC_LABELS: Record<string, string> = {
    fulfillment: 'Full',
    self_service: 'Flex',
    drop_off: 'Colecta (agencia)',
    xd_drop_off: 'Colecta (agencia)',
    cross_docking: 'Colecta (a domicilio)',
    not_specified: 'A coordinar',
  };

  // TEMPORAL: diagnóstico directo de una orden puntual, sin pasar por logs.
  async debugOrder(connectionId: string, orderId: string, user: any) {
    await this.getConnectionForUser(connectionId, user);
    const token = await this.getValidToken(connectionId);

    const orderRes = await fetch(`${ML_API}/orders/${orderId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!orderRes.ok) {
      return { error: `No se pudo obtener la orden (HTTP ${orderRes.status})` };
    }
    const order = await orderRes.json() as any;

    const shippingId = order.shipping?.id;
    let shipment: any = null;
    let costs: any = null;
    if (shippingId) {
      const [shipmentRes, costsRes] = await Promise.all([
        fetch(`${ML_API}/shipments/${shippingId}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${ML_API}/shipments/${shippingId}/costs`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      shipment = shipmentRes.ok ? await shipmentRes.json() : { error: `HTTP ${shipmentRes.status}` };
      costs = costsRes.ok ? await costsRes.json() : { error: `HTTP ${costsRes.status}` };
    }

    const billing = await this.findBillingDetailsForOrder(orderId, order.date_created, token);

    return {
      order_total_amount: order.total_amount,
      order_date_created: order.date_created,
      order_items: (order.order_items || []).map((oi: any) => ({ title: oi.item?.title, sale_fee: oi.sale_fee, unit_price: oi.unit_price })),
      payments: order.payments,
      shipping_id: shippingId,
      shipment,
      costs,
      billing,
    };
  }

  // TEMPORAL: recorre la API de Billing de ML para ubicar los cargos/bonificaciones
  // de una orden puntual. Encadena: listar períodos -> ubicar el que contiene la fecha
  // de la venta -> paginar el detalle de ese período (probando grupos MP y ML) ->
  // filtrar por sales_info[].order_id.
  private async findBillingDetailsForOrder(orderId: string, saleDateIso: string, token: string): Promise<any> {
    const result: any = { periods_lookup: {}, period_key: {}, matched_details: [], raw_sample: null, errors: [] };
    const saleDate = new Date(saleDateIso);

    for (const group of ['ML', 'MP']) {
      let periods: any[] = [];
      try {
        const periodsRes = await fetch(`${ML_API}/billing/integration/periods?group=${group}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!periodsRes.ok) {
          result.errors.push(`GET /billing/integration/periods?group=${group} -> HTTP ${periodsRes.status}: ${await periodsRes.text()}`);
          continue;
        }
        const periodsData = await periodsRes.json() as any;
        result.periods_lookup[group] = periodsData;
        periods = Array.isArray(periodsData) ? periodsData : (periodsData.results || periodsData.periods || []);
      } catch (err: any) {
        result.errors.push(`GET /billing/integration/periods?group=${group} error: ${err?.message || err}`);
        continue;
      }

      const period = periods.find((p: any) => {
        const from = p.date_from ? new Date(p.date_from) : null;
        const to = p.date_to ? new Date(p.date_to) : null;
        return from && to && saleDate >= from && saleDate <= new Date(to.getTime() + 24 * 60 * 60 * 1000);
      });
      if (!period) {
        result.errors.push(`No se encontró un período (group=${group}) que contenga la fecha de la venta.`);
        continue;
      }
      result.period_key[group] = period.key;

      let offset = 0;
      const limit = 100;
      let total = Infinity;
      let sampleCaptured = false;
      while (offset < total && offset < 2000) {
        try {
          const url = `${ML_API}/billing/integration/periods/key/${period.key}/group/${group}/details?document_type=BILL&limit=${limit}&offset=${offset}`;
          const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) {
            result.errors.push(`GET group=${group} offset=${offset} -> HTTP ${res.status}: ${await res.text()}`);
            break;
          }
          const data = await res.json() as any;
          total = data.paging?.total ?? data.total ?? 0;
          const details = data.results || data.details || [];
          if (!sampleCaptured && details.length > 0) {
            result.raw_sample = details[0];
            sampleCaptured = true;
          }
          for (const d of details) {
            const salesInfo = d.sales_info || [];
            if (salesInfo.some((s: any) => String(s.order_id) === String(orderId))) {
              result.matched_details.push({ group, ...d });
            }
          }
          offset += limit;
          if (details.length === 0) break;
        } catch (err: any) {
          result.errors.push(`GET group=${group} offset=${offset} error: ${err?.message || err}`);
          break;
        }
      }
    }

    return result;
  }

  private async getMlShippingInfo(order: any, token: string): Promise<{ method: string | null; sellerCost: number | null }> {
    const orderId = order.id;
    const buyerShippingPaid = Number((order.payments || [])[0]?.shipping_cost || 0);

    const shippingId = order.shipping?.id;
    if (!shippingId) return { method: null, sellerCost: null };
    try {
      const [shipmentRes, costsRes] = await Promise.all([
        fetch(`${ML_API}/shipments/${shippingId}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${ML_API}/shipments/${shippingId}/costs`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      let shipment: any = {};
      if (shipmentRes.ok) shipment = await shipmentRes.json();

      let costs: any = null;
      if (costsRes.ok) {
        costs = await costsRes.json();
        this.logger.log(`ML shipment ${shippingId} costs: ${JSON.stringify(costs).slice(0, 2000)}`);
      }

      const logisticType = shipment.logistic_type || shipment.shipping_option?.name;
      const method = logisticType ? (MercadolibreService.ML_LOGISTIC_LABELS[logisticType] || logisticType) : null;

      const sender = Array.isArray(costs?.senders) ? costs.senders[0] : undefined;

      // Bonificación al vendedor (ej. Flex): compensation directa + suma de compensations[] + charge_flex
      // negativo si ML lo expresa como cargo negativo. Reduce el costo neto a cargo del vendedor.
      const compensationsSum = Array.isArray(sender?.compensations)
        ? sender.compensations.reduce((s: number, c: any) => s + Number(c?.amount ?? c ?? 0), 0)
        : 0;
      const flexCharge = Number(sender?.charges?.charge_flex || 0);

      // Caso confirmado: Flex con descuento "loyal" 100% al comprador (envío gratis) y costo $0
      // al vendedor en costs.senders — ahí costs.gross_amount es la bonificación real que ML
      // acredita al vendedor (ej. orden 2000017435932280: gross_amount=3090 = "Bonificación por envío").
      const isFlex = logisticType === 'self_service';
      const senderCostRaw = sender?.cost != null ? Number(sender.cost) : null;
      const grossAmount = costs?.gross_amount != null ? Number(costs.gross_amount) : 0;
      const flexFullBonus = isFlex && senderCostRaw === 0 && grossAmount > 0 ? grossAmount : 0;
      if (flexFullBonus > 0) {
        this.logger.log(`ML orden ${orderId} bonificación Flex por gross_amount detectada: ${flexFullBonus}`);
      }

      const bonus = Number(sender?.compensation || 0) + compensationsSum - flexCharge + flexFullBonus;

      // 1) Si /costs trae el cargo real al vendedor, se usa directo (menos la bonificación, si existe).
      const sendersCost = sender?.cost != null ? Number(sender.cost) - bonus : undefined;

      // 2) Si no, se infiere: costo real de envío menos lo que pagó el comprador.
      //    Positivo = se le cobra la diferencia al vendedor (ej. envío "gratis" para el comprador).
      //    Negativo = Mercado Libre le bonifica el excedente al vendedor (ej. Flex, buyerPaid > costo real)
      //    — sin Math.max(0, ...): ese excedente debe sumarse al total, no descartarse.
      const actualShippingCost = shipment.shipping_option?.cost;
      const inferredSellerCost = actualShippingCost != null
        ? Number(actualShippingCost) - buyerShippingPaid
        : null;

      const rawSellerCost = sendersCost != null ? sendersCost : inferredSellerCost;
      const sellerCost = rawSellerCost != null ? Math.round(rawSellerCost) : null;

      if (bonus !== 0) {
        this.logger.log(`ML orden ${orderId} bonificación de envío detectada: ${bonus} (compensation=${sender?.compensation}, compensations=${JSON.stringify(sender?.compensations)}, charge_flex=${flexCharge})`);
      }

      this.logger.log(
        `ML orden ${orderId} envío: pagó comprador=${buyerShippingPaid}, costo real=${actualShippingCost ?? 'n/d'}, ` +
        `costo vendedor (senders.cost)=${sendersCost ?? 'n/d'}, costo vendedor (inferido)=${inferredSellerCost ?? 'n/d'}`,
      );

      return { method, sellerCost };
    } catch (err: any) {
      this.logger.warn(`No se pudo obtener datos de envío de la orden ${orderId}: ${err?.message || err}`);
      return { method: null, sellerCost: null };
    }
  }

  async previewSalesImport(connectionId: string, user: any, from?: string, to?: string) {
    const conn = await this.getConnectionForUser(connectionId, user);
    const token = await this.getValidToken(connectionId);

    const meRes = await fetch(`${ML_API}/users/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!meRes.ok) throw new BadRequestException('No se pudo obtener el usuario de Mercado Libre');
    const me = await meRes.json() as any;

    const MAX_ORDERS = 300;
    const baseParams = new URLSearchParams({ seller: String(me.id), limit: '50' });
    if (from) baseParams.set('order.date_created.from', new Date(from).toISOString());
    if (to) baseParams.set('order.date_created.to', new Date(`${to}T23:59:59`).toISOString());

    const orders: any[] = [];
    let offset = 0;
    let total = 0;
    do {
      const params = new URLSearchParams(baseParams);
      params.set('offset', String(offset));
      const res = await fetch(`${ML_API}/orders/search?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const errBody = await res.text();
        this.logger.error(`ML orders/search failed [${res.status}]: ${errBody}`);
        throw new BadRequestException(
          `Mercado Libre rechazó la búsqueda de ventas (HTTP ${res.status}). Revisa los logs del backend para más detalle.`,
        );
      }
      const data = await res.json() as any;
      total = data.paging?.total || 0;
      orders.push(...(data.results || []));
      offset += 50;
    } while (offset < total && orders.length < MAX_ORDERS);

    const truncated = total > orders.length;

    const orderIds = orders.map((o) => String(o.id));
    const itemIds = Array.from(new Set(
      orders.flatMap((o) => (o.order_items || []).map((oi: any) => oi.item?.id).filter(Boolean)),
    ));

    const [existingSales, listings] = await Promise.all([
      this.prisma.sale.findMany({ where: { externalId: { in: orderIds } }, select: { externalId: true } }),
      this.prisma.listing.findMany({
        where: { connectionId, externalId: { in: itemIds } },
        select: { externalId: true, productId: true, product: { select: { name: true } } },
      }),
    ]);
    const existingIds = new Set(existingSales.map((s) => s.externalId));
    const listingByItemId = new Map(listings.map((l) => [l.externalId, l]));

    const unfiltered = orders.map((o) => {
      const orderItems = (o.order_items || []).map((oi: any) => {
        const listing = listingByItemId.get(oi.item?.id);
        return {
          title: oi.item?.title || 'Ítem',
          quantity: oi.quantity || 1,
          unitPrice: Number(oi.unit_price || 0),
          resolved: !!listing,
          productName: listing?.product?.name || null,
        };
      });
      const importable = orderItems.length > 0 && orderItems.every((i: any) => i.resolved);
      const charges = this.computeOrderCharges(o);
      return {
        externalId: String(o.id),
        date: o.date_created,
        total: Number(o.total_amount || 0),
        buyerNickname: o.buyer?.nickname || null,
        items: orderItems,
        charges,
        importable,
      };
    });

    const orderResults = unfiltered.filter((o) => !existingIds.has(o.externalId));
    const alreadyImportedCount = unfiltered.length - orderResults.length;

    return { connectionName: conn.name, total, truncated, alreadyImportedCount, orders: orderResults };
  }

  async confirmSalesImport(connectionId: string, externalOrderIds: string[], user: any) {
    const conn = await this.getConnectionForUser(connectionId, user);
    const token = await this.getValidToken(connectionId);

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const orderId of externalOrderIds) {
      const existing = await this.prisma.sale.findFirst({ where: { externalId: orderId } });
      if (existing) { skipped++; continue; }

      const orderRes = await fetch(`${ML_API}/orders/${orderId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!orderRes.ok) { errors.push(`Orden ${orderId}: no se pudo obtener de Mercado Libre`); continue; }
      const order = await orderRes.json() as any;

      const resolvedItems: Array<{ productId: string; quantity: number; unitPrice: number }> = [];
      let allResolved = true;
      for (const oi of order.order_items || []) {
        const listing = await this.prisma.listing.findFirst({
          where: { connectionId, externalId: oi.item?.id },
        });
        if (!listing) { allResolved = false; break; }
        resolvedItems.push({ productId: listing.productId, quantity: oi.quantity || 1, unitPrice: Number(oi.unit_price || 0) });
      }
      if (!allResolved || !resolvedItems.length) {
        errors.push(`Orden ${orderId}: uno o más productos no están vinculados en el catálogo`);
        continue;
      }

      const charges = this.computeOrderCharges(order);
      const shippingInfo = await this.getMlShippingInfo(order, token);
      if (shippingInfo.sellerCost != null) charges.shippingCost = shippingInfo.sellerCost;
      charges.totalPaid = this.computeSellerNetAmount(order, charges);
      await this.prisma.sale.create({
        data: {
          channel: SaleChannel.MERCADO_LIBRE,
          externalId: orderId,
          total: Number(order.total_amount || 0),
          shippingCost: charges.shippingCost,
          marketplaceFee: charges.marketplaceFee,
          taxes: charges.taxes,
          discount: charges.coupon,
          netAmount: charges.totalPaid,
          shippingMethod: shippingInfo.method,
          companyId: conn.companyId,
          customerName: order.buyer?.nickname || null,
          createdAt: new Date(order.date_created),
          items: { create: resolvedItems },
        },
      });
      imported++;
    }

    return { imported, skipped, errors };
  }

  // ─── Procesamiento de órdenes (compartido entre webhook y auto-sync) ─────────

  // Crea la venta y descuenta stock de forma atómica. Usado tanto por el webhook de ML
  // como por el cron de auto-sync, para que ambos caminos tengan exactamente el mismo efecto.
  // companyIdHint: si el caller ya conoce la empresa (p.ej. el cron, que parte de una
  // MarketplaceConnection concreta), se usa directo; si no (webhook), se infiere del primer
  // ítem de la orden que resuelva a un Listing.
  private async processOrder(
    orderId: string,
    order: any,
    token: string,
    companyIdHint?: string,
  ): Promise<'imported' | 'skipped'> {
    const orderTotal = Number(order.total_amount || 0);

    let companyId: string | null = companyIdHint || null;
    const resolvedItems: Array<{ listing: any; quantity: number; unitPrice: number }> = [];

    for (const orderItem of order.order_items || []) {
      const itemId = orderItem.item?.id;
      const quantity = orderItem.quantity || 1;
      const unitPrice = Number(orderItem.unit_price || 0);

      const listing = await this.prisma.listing.findFirst({
        where: { externalId: itemId },
        include: { product: true, connection: true },
      });
      if (!listing) continue;

      companyId = companyId || listing.connection.companyId;
      resolvedItems.push({ listing, quantity, unitPrice });
    }

    if (!resolvedItems.length || !companyId) return 'skipped';

    const charges = this.computeOrderCharges(order);
    const shippingInfo = await this.getMlShippingInfo(order, token);
    if (shippingInfo.sellerCost != null) charges.shippingCost = shippingInfo.sellerCost;
    charges.totalPaid = this.computeSellerNetAmount(order, charges);

    try {
      await this.prisma.$transaction(async (tx) => {
        const sale = await tx.sale.create({
          data: {
            channel: SaleChannel.MERCADO_LIBRE,
            externalId: orderId,
            total: orderTotal,
            shippingCost: charges.shippingCost,
            marketplaceFee: charges.marketplaceFee,
            taxes: charges.taxes,
            discount: charges.coupon,
            netAmount: charges.totalPaid,
            shippingMethod: shippingInfo.method,
            companyId: companyId as string,
            customerName: order.buyer?.nickname || null,
            items: {
              create: resolvedItems.map(({ listing, quantity, unitPrice }) => ({
                productId: listing.productId,
                quantity,
                unitPrice,
              })),
            },
          },
          include: { items: true },
        });

        for (let i = 0; i < resolvedItems.length; i++) {
          const { listing, quantity } = resolvedItems[i];
          const saleItem = sale.items[i];

          const product = listing.product;
          const newStock = Math.max(0, product.stock - quantity);

          await tx.product.update({
            where: { id: listing.productId },
            data: { stock: newStock },
          });

          await tx.stockMovement.create({
            data: {
              type: MovementType.SALE,
              quantity: -quantity,
              reason: `Venta Mercado Libre orden #${orderId}`,
              productId: listing.productId,
              saleItemId: saleItem.id,
            },
          });

          const newStatus = newStock === 0 ? ListingStatus.PAUSED : ListingStatus.ACTIVE;
          await tx.listing.update({
            where: { id: listing.id },
            data: { status: newStatus, syncedAt: new Date() },
          });

          // Pausar en ML si se agotó el stock
          if (newStock === 0) {
            const itemToken = await this.getValidToken(listing.connectionId);
            await fetch(`${ML_API}/items/${listing.externalId}`, {
              method: 'PUT',
              headers: { Authorization: `Bearer ${itemToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'paused' }),
            });
          }

          this.logger.log(`ML orden ${orderId}: producto=${listing.productId} stock=${product.stock}→${newStock}`);
        }
      });
    } catch (err: any) {
      // Otra corrida (webhook vs cron, o dos ticks del cron solapados) ya insertó esta orden
      // entre nuestro chequeo previo y este create: el constraint único la frena acá.
      if (err?.code === 'P2002') {
        this.logger.log(`ML orden ${orderId} ya fue importada por otro proceso`);
        return 'skipped';
      }
      throw err;
    }

    // Sincronizar otras plataformas tras la venta de ML
    for (const { listing, quantity } of resolvedItems) {
      const newStock = Math.max(0, listing.product.stock - quantity);
      this.sync.syncProduct(listing.productId, newStock).catch((e) =>
        this.logger.error(`Sync otras plataformas tras venta ML: ${e.message}`),
      );
    }

    return 'imported';
  }

  // ─── Webhook ─────────────────────────────────────────────────────────────────

  async handleWebhook(body: any) {
    this.logger.log(`ML Webhook: topic=${body.topic} resource=${body.resource}`);
    if (body.topic !== 'orders_v2') return { received: true };

    try {
      const orderId = body.resource?.split('/').pop();
      if (!orderId) return { received: true };

      // Evitar procesar la misma orden dos veces
      const existing = await this.prisma.sale.findFirst({ where: { externalId: orderId } });
      if (existing) {
        this.logger.log(`ML Webhook: orden ${orderId} ya procesada`);
        return { received: true };
      }

      // Obtener token via cualquier listing activo
      const anyListing = await this.prisma.listing.findFirst({
        where: { externalId: { not: null } },
        include: { connection: true },
      });
      if (!anyListing) return { received: true };

      const token = await this.getValidToken(anyListing.connectionId);
      const orderRes = await fetch(`${ML_API}/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!orderRes.ok) return { received: true };

      const order = await orderRes.json() as any;
      await this.processOrder(orderId, order, token);
    } catch (error) {
      this.logger.error('Error procesando webhook ML', error);
    }

    return { received: true };
  }

  // ─── Auto-sync (cron) ────────────────────────────────────────────────────────

  // Busca y procesa las órdenes nuevas de una conexión ML desde la última corrida
  // (con 2 min de solape), con el mismo efecto que el webhook: descuenta stock,
  // crea StockMovement y pausa el listing en ML si el stock llega a 0.
  async importRecentSalesForConnection(connectionId: string): Promise<{ imported: number; skipped: number; errors: number }> {
    const connection = await this.prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
    if (!connection) return { imported: 0, skipped: 0, errors: 0 };

    const token = await this.getValidToken(connectionId);

    const to = new Date();
    const from = connection.lastSalesImportAt
      ? new Date(connection.lastSalesImportAt.getTime() - 2 * 60 * 1000)
      : new Date(to.getTime() - 60 * 60 * 1000);

    const meRes = await fetch(`${ML_API}/users/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!meRes.ok) throw new InternalServerErrorException('No se pudo obtener el usuario de Mercado Libre');
    const me = await meRes.json() as any;

    const MAX_ORDERS = 100;
    const baseParams = new URLSearchParams({
      seller: String(me.id),
      limit: '50',
      'order.date_created.from': from.toISOString(),
      'order.date_created.to': to.toISOString(),
    });

    const orderIds: string[] = [];
    let offset = 0;
    let total = 0;
    do {
      const params = new URLSearchParams(baseParams);
      params.set('offset', String(offset));
      const res = await fetch(`${ML_API}/orders/search?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const errBody = await res.text();
        this.logger.error(`Auto-sync ML orders/search falló [${res.status}] conexión ${connectionId}: ${errBody}`);
        throw new InternalServerErrorException(`Mercado Libre rechazó la búsqueda de ventas (HTTP ${res.status})`);
      }
      const data = await res.json() as any;
      total = data.paging?.total || 0;
      orderIds.push(...(data.results || []).map((o: any) => String(o.id)));
      offset += 50;
    } while (offset < total && orderIds.length < MAX_ORDERS);

    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const orderId of orderIds) {
      try {
        const existing = await this.prisma.sale.findFirst({ where: { externalId: orderId } });
        if (existing) { skipped++; continue; }

        const orderRes = await fetch(`${ML_API}/orders/${orderId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!orderRes.ok) { errors++; continue; }
        const order = await orderRes.json() as any;

        const result = await this.processOrder(orderId, order, token, connection.companyId);
        if (result === 'imported') imported++; else skipped++;
      } catch (err: any) {
        errors++;
        this.logger.error(`Auto-sync ML: error procesando orden ${orderId} (conexión ${connectionId}): ${err?.message || err}`);
      }
    }

    // Solo avanzamos el cursor si la búsqueda en sí funcionó (llegamos hasta acá);
    // errores de órdenes individuales no impiden avanzar, para no reintentarlas indefinidamente
    // si el problema es de datos (ej. producto no vinculado) y no transitorio.
    await this.prisma.marketplaceConnection.update({
      where: { id: connectionId },
      data: { lastSalesImportAt: to },
    });

    return { imported, skipped, errors };
  }
}

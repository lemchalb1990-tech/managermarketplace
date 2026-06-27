import {
  Injectable, Logger, BadRequestException, NotFoundException,
  InternalServerErrorException, ForbiddenException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Role, SaleChannel, MovementType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService } from '../../catalog/catalog.service';
import { ListingStatus } from '@prisma/client';

const ML_API = 'https://api.mercadolibre.com';
const ML_AUTH = 'https://auth.mercadolibre.cl';

@Injectable()
export class MercadolibreService {
  private readonly logger = new Logger(MercadolibreService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private catalog: CatalogService,
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

  async getAuthUrl(companyId: string, name: string, mlClientId: string, mlClientSecret: string): Promise<string> {
    if (!mlClientId || !mlClientSecret) {
      throw new BadRequestException('Client ID y Client Secret son requeridos');
    }
    const redirectUri = this.config.get('ML_REDIRECT_URI');

    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    // Crear conexión draft con las credenciales propias
    const draft = await this.prisma.marketplaceConnection.create({
      data: {
        name,
        marketplace: 'MERCADO_LIBRE',
        mlClientId,
        mlClientSecret,
        accessToken: '',
        active: false,
        companyId,
      },
    });

    const state = Buffer.from(JSON.stringify({ connectionId: draft.id, codeVerifier })).toString('base64url');
    return `${ML_AUTH}/authorization?response_type=code&client_id=${mlClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
  }

  async handleCallback(code: string, state: string, fallbackName: string) {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
    const connectionId: string = decoded.connectionId;
    const codeVerifier: string = decoded.codeVerifier;

    const draft = await this.prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
    if (!draft) throw new BadRequestException('Conexión no encontrada');

    const clientId = draft.mlClientId;
    const clientSecret = draft.mlClientSecret;
    const redirectUri = this.config.get('ML_REDIRECT_URI');

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
      await this.prisma.marketplaceConnection.delete({ where: { id: connectionId } });
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

  // ─── Connections ─────────────────────────────────────────────────────────────

  async getConnections(user: any, companyId?: string) {
    const cid = user.role !== Role.SUPER_ADMIN ? user.companyId : companyId;
    if (!cid) return [];
    return this.prisma.marketplaceConnection.findMany({
      where: { companyId: cid, active: true },
      select: { id: true, name: true, marketplace: true, mlClientId: true, active: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async removeConnection(id: string, user: any) {
    const conn = await this.prisma.marketplaceConnection.findUnique({ where: { id } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) {
      throw new ForbiddenException();
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

    const categoryId = (product as any).mlCategoryId || this.config.get('ML_DEFAULT_CATEGORY');
    if (!categoryId) {
      throw new BadRequestException(
        'Debes asignar una categoría de Mercado Libre al producto antes de publicar.',
      );
    }

    const appUrl = this.config.get('APP_URL') || '';
    const toAbsolute = (url: string) =>
      url.startsWith('http') ? url : `${appUrl}${url}`;

    const mlItem = {
      title: product.name,
      category_id: categoryId,
      price: Math.round(Number(product.price)),
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

  async syncStock(productId: string, connectionId: string, user: any) {
    const product = await this.catalog.findOne(productId, user);
    const listing = await this.prisma.listing.findUnique({
      where: { productId_connectionId: { productId, connectionId } },
    });
    if (!listing?.externalId) throw new BadRequestException('La publicación no existe en ML');

    const token = await this.getValidToken(connectionId);
    const warnings: string[] = [];

    // Sincronizar precio y stock (ML no permite cambiar título de items activos)
    const itemRes = await fetch(`${ML_API}/items/${listing.externalId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        price: Math.round(Number(product.price)),
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

    const newStatus = product.stock === 0 ? ListingStatus.PAUSED : ListingStatus.ACTIVE;
    const updated = await this.prisma.listing.update({
      where: { id: listing.id },
      data: { status: newStatus, syncedAt: new Date() },
    });

    return { ...updated, warnings };
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
      const orderTotal = Number(order.total_amount || 0);

      // Resolver companyId desde el primer item de la orden
      let companyId: string | null = null;
      const resolvedItems: Array<{ listing: any; quantity: number; unitPrice: number }> = [];

      for (const orderItem of order.order_items) {
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

      if (!resolvedItems.length || !companyId) return { received: true };

      // Crear venta y actualizar stock en transacción atómica
      await this.prisma.$transaction(async (tx) => {
        const sale = await tx.sale.create({
          data: {
            channel: SaleChannel.MERCADO_LIBRE,
            externalId: orderId,
            total: orderTotal,
            companyId,
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
    } catch (error) {
      this.logger.error('Error procesando webhook ML', error);
    }

    return { received: true };
  }
}

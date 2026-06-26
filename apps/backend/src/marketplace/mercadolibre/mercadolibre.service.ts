import {
  Injectable, Logger, BadRequestException, NotFoundException,
  InternalServerErrorException, ForbiddenException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
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
      select: { id: true, name: true, marketplace: true, active: true, expiresAt: true, createdAt: true },
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
      price: Number(product.price),
      currency_id: 'CLP',
      available_quantity: product.stock,
      buying_mode: 'buy_it_now',
      listing_type_id: 'gold_special',
      condition: 'new',
      description: { plain_text: product.description || product.name },
      pictures: primaryImage ? [{ url: toAbsolute(primaryImage.url) }] : [],
      attributes: [{ id: 'SELLER_SKU', value_name: product.sku }],
    };

    const res = await fetch(`${ML_API}/items`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(mlItem),
    });

    if (!res.ok) {
      const err = await res.json() as any;
      this.logger.error('ML publish error', err);
      await this.prisma.listing.upsert({
        where: { productId_connectionId: { productId, connectionId } },
        update: { status: ListingStatus.ERROR, errorMsg: err.message || 'Error al publicar' },
        create: { productId, connectionId, status: ListingStatus.ERROR, errorMsg: err.message },
      });
      throw new BadRequestException(err.message || 'Error al publicar en Mercado Libre');
    }

    const mlData = await res.json() as any;
    return this.prisma.listing.upsert({
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
  }

  async syncStock(productId: string, connectionId: string, user: any) {
    const product = await this.catalog.findOne(productId, user);
    const listing = await this.prisma.listing.findUnique({
      where: { productId_connectionId: { productId, connectionId } },
    });
    if (!listing?.externalId) throw new BadRequestException('La publicación no existe en ML');

    const token = await this.getValidToken(connectionId);
    const res = await fetch(`${ML_API}/items/${listing.externalId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ available_quantity: product.stock }),
    });

    if (!res.ok) {
      const err = await res.json() as any;
      throw new BadRequestException(err.message || 'Error al sincronizar stock');
    }

    const newStatus = product.stock === 0 ? ListingStatus.PAUSED : ListingStatus.ACTIVE;
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

      const listing = await this.prisma.listing.findFirst({
        where: { externalId: { not: null } },
        include: { connection: true, product: true },
      });
      if (!listing) return { received: true };

      const token = await this.getValidToken(listing.connectionId);
      const orderRes = await fetch(`${ML_API}/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!orderRes.ok) return { received: true };

      const order = await orderRes.json() as any;

      for (const orderItem of order.order_items) {
        const itemId = orderItem.item?.id;
        const quantity = orderItem.quantity || 1;

        const affected = await this.prisma.listing.findFirst({
          where: { externalId: itemId },
          include: { product: true },
        });
        if (!affected) continue;

        const newStock = Math.max(0, affected.product.stock - quantity);
        await this.prisma.product.update({ where: { id: affected.productId }, data: { stock: newStock } });

        const newStatus = newStock === 0 ? ListingStatus.PAUSED : ListingStatus.ACTIVE;
        await this.prisma.listing.update({
          where: { id: affected.id },
          data: { status: newStatus, syncedAt: new Date() },
        });

        if (newStock === 0) {
          const itemToken = await this.getValidToken(affected.connectionId);
          await fetch(`${ML_API}/items/${itemId}`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${itemToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'paused' }),
          });
        }

        this.logger.log(`Stock actualizado: producto=${affected.productId} nuevo_stock=${newStock}`);
      }
    } catch (error) {
      this.logger.error('Error procesando webhook ML', error);
    }

    return { received: true };
  }
}

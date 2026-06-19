import {
  Injectable, Logger, BadRequestException, NotFoundException, InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService } from '../../catalog/catalog.service';
import { ListingStatus } from '@prisma/client';

const ML_API = 'https://api.mercadolibre.com';
const ML_AUTH = 'https://auth.mercadolibre.com.ar';

@Injectable()
export class MercadolibreService {
  private readonly logger = new Logger(MercadolibreService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private catalog: CatalogService,
  ) {}

  getAuthUrl(companyId: string): string {
    const clientId = this.config.get('ML_CLIENT_ID');
    const redirectUri = this.config.get('ML_REDIRECT_URI');
    const state = Buffer.from(JSON.stringify({ companyId })).toString('base64');
    return `${ML_AUTH}/authorization?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  }

  async handleCallback(code: string, state: string, connectionName: string) {
    const { companyId } = JSON.parse(Buffer.from(state, 'base64').toString());

    const clientId = this.config.get('ML_CLIENT_ID');
    const clientSecret = this.config.get('ML_CLIENT_SECRET');
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
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      this.logger.error('ML token exchange failed', err);
      throw new BadRequestException('Error al conectar con Mercado Libre');
    }

    const tokens = await res.json() as any;
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    return this.prisma.marketplaceConnection.create({
      data: {
        name: connectionName,
        marketplace: 'MERCADO_LIBRE',
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
        companyId,
      },
    });
  }

  private async refreshToken(connectionId: string) {
    const conn = await this.prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
    if (!conn?.refreshToken) throw new InternalServerErrorException('Sin refresh token');

    const clientId = this.config.get('ML_CLIENT_ID');
    const clientSecret = this.config.get('ML_CLIENT_SECRET');

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
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    return this.prisma.marketplaceConnection.update({
      where: { id: connectionId },
      data: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
      },
    });
  }

  private async getValidToken(connectionId: string): Promise<string> {
    let conn = await this.prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');

    const shouldRefresh = conn.expiresAt && conn.expiresAt < new Date(Date.now() + 5 * 60 * 1000);
    if (shouldRefresh) {
      conn = await this.refreshToken(connectionId);
    }
    return conn.accessToken;
  }

  async publishProduct(productId: string, connectionId: string, user: any) {
    const product = await this.catalog.findOne(productId, user);
    const token = await this.getValidToken(connectionId);

    const primaryImage = product.images.find((i: any) => i.isPrimary) || product.images[0];

    const mlItem = {
      title: product.name,
      category_id: 'MLA5725',
      price: Number(product.price),
      currency_id: 'ARS',
      available_quantity: product.stock,
      buying_mode: 'buy_it_now',
      listing_type_id: 'gold_special',
      condition: 'new',
      description: { plain_text: product.description || product.name },
      pictures: primaryImage ? [{ url: primaryImage.url }] : [],
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
        productId,
        connectionId,
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

        const affectedListing = await this.prisma.listing.findFirst({
          where: { externalId: itemId },
          include: { product: true },
        });

        if (!affectedListing) continue;

        const newStock = Math.max(0, affectedListing.product.stock - quantity);
        await this.prisma.product.update({
          where: { id: affectedListing.productId },
          data: { stock: newStock },
        });

        const newStatus = newStock === 0 ? ListingStatus.PAUSED : ListingStatus.ACTIVE;
        await this.prisma.listing.update({
          where: { id: affectedListing.id },
          data: { status: newStatus, syncedAt: new Date() },
        });

        if (newStock === 0) {
          const itemToken = await this.getValidToken(affectedListing.connectionId);
          await fetch(`${ML_API}/items/${itemId}`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${itemToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'paused' }),
          });
        }

        this.logger.log(`Stock updated: product=${affectedListing.productId} new_stock=${newStock}`);
      }
    } catch (error) {
      this.logger.error('Error processing ML webhook', error);
    }

    return { received: true };
  }
}

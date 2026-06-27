import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { MarketplaceType, ListingStatus, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ShopifyAdapter } from '../platforms/shopify.adapter';
import { WooCommerceAdapter } from '../platforms/woocommerce.adapter';
import { JumpSellerAdapter } from '../platforms/jumpseller.adapter';
import { StubAdapter } from '../platforms/stub.adapter';
import { PlatformAdapter } from '../platforms/platform.interface';
import { CatalogService } from '../../catalog/catalog.service';
import { CreateConnectionDto, LinkProductDto } from './connections.dto';

const NON_ML_TYPES: MarketplaceType[] = [
  MarketplaceType.SHOPIFY, MarketplaceType.WOOCOMMERCE, MarketplaceType.JUMPSELLER,
  MarketplaceType.FALABELLA, MarketplaceType.PARIS, MarketplaceType.HITES,
  MarketplaceType.RIPLEY, MarketplaceType.WALMART,
];

@Injectable()
export class ConnectionsService {
  private readonly logger = new Logger(ConnectionsService.name);

  constructor(
    private prisma: PrismaService,
    private shopify: ShopifyAdapter,
    private woocommerce: WooCommerceAdapter,
    private jumpseller: JumpSellerAdapter,
    private stub: StubAdapter,
    private catalog: CatalogService,
  ) {}

  private getAdapter(marketplace: MarketplaceType): PlatformAdapter {
    switch (marketplace) {
      case MarketplaceType.SHOPIFY: return this.shopify;
      case MarketplaceType.WOOCOMMERCE: return this.woocommerce;
      case MarketplaceType.JUMPSELLER: return this.jumpseller;
      default: return this.stub;
    }
  }

  private resolveCompanyId(user: any, companyId?: string): string {
    if (user.role === Role.SUPER_ADMIN) {
      if (!companyId) throw new BadRequestException('companyId requerido para Super Admin');
      return companyId;
    }
    return user.companyId;
  }

  async listConnections(user: any, marketplace?: string, companyId?: string) {
    const cid = user.role !== Role.SUPER_ADMIN ? user.companyId : companyId;
    if (!cid) return [];

    const where: any = {
      companyId: cid,
      active: true,
      marketplace: { in: NON_ML_TYPES },
    };
    if (marketplace && NON_ML_TYPES.includes(marketplace as MarketplaceType)) {
      where.marketplace = marketplace as MarketplaceType;
    }

    return this.prisma.marketplaceConnection.findMany({
      where,
      select: {
        id: true, name: true, marketplace: true, active: true, createdAt: true,
        credentials: false, // no exponer credenciales en listado
        expiresAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createConnection(dto: CreateConnectionDto, user: any) {
    const companyId = this.resolveCompanyId(user, dto.companyId);
    const marketplace = dto.marketplace as MarketplaceType;
    if (!NON_ML_TYPES.includes(marketplace)) {
      throw new BadRequestException('Plataforma no válida');
    }

    const conn = await this.prisma.marketplaceConnection.create({
      data: {
        name: dto.name,
        marketplace,
        credentials: dto.credentials,
        accessToken: '',
        active: true,
        companyId,
      },
    });

    const adapter = this.getAdapter(marketplace);
    const testResult = await adapter.testConnection({ ...conn, credentials: dto.credentials }).catch((e) => ({
      success: false, message: e.message,
    }));

    if (!testResult.success) {
      await this.prisma.marketplaceConnection.delete({ where: { id: conn.id } });
      throw new BadRequestException(`No se pudo conectar: ${testResult.message}`);
    }

    return { ...conn, credentials: undefined, testMessage: testResult.message };
  }

  async deleteConnection(id: string, user: any) {
    const conn = await this.prisma.marketplaceConnection.findUnique({ where: { id } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) throw new ForbiddenException();
    return this.prisma.marketplaceConnection.update({ where: { id }, data: { active: false } });
  }

  async testConnection(id: string, user: any) {
    const conn = await this.prisma.marketplaceConnection.findUnique({ where: { id } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) throw new ForbiddenException();
    const adapter = this.getAdapter(conn.marketplace as MarketplaceType);
    return adapter.testConnection(conn);
  }

  async publishProduct(connectionId: string, productId: string, user: any) {
    const conn = await this.prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) throw new ForbiddenException();

    const product = await this.catalog.findOne(productId, user);
    const adapter = this.getAdapter(conn.marketplace as MarketplaceType);

    const result = await adapter.publishProduct(conn, product);

    return this.prisma.listing.upsert({
      where: { productId_connectionId: { productId, connectionId } },
      update: { externalId: result.externalId, externalUrl: result.externalUrl, status: ListingStatus.ACTIVE, syncedAt: new Date(), errorMsg: null },
      create: { productId, connectionId, externalId: result.externalId, externalUrl: result.externalUrl, status: ListingStatus.ACTIVE, syncedAt: new Date() },
    });
  }

  async linkProduct(connectionId: string, productId: string, dto: LinkProductDto, user: any) {
    const conn = await this.prisma.marketplaceConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundException('Conexión no encontrada');
    if (user.role !== Role.SUPER_ADMIN && conn.companyId !== user.companyId) throw new ForbiddenException();

    return this.prisma.listing.upsert({
      where: { productId_connectionId: { productId, connectionId } },
      update: { externalId: dto.externalId, externalUrl: dto.externalUrl, status: ListingStatus.ACTIVE, syncedAt: new Date(), errorMsg: null },
      create: { productId, connectionId, externalId: dto.externalId, externalUrl: dto.externalUrl, status: ListingStatus.ACTIVE, syncedAt: new Date() },
    });
  }

  async getProductListings(productId: string, user: any) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Producto no encontrado');
    if (user.role !== Role.SUPER_ADMIN && product.companyId !== user.companyId) throw new ForbiddenException();

    return this.prisma.listing.findMany({
      where: { productId },
      include: {
        connection: {
          select: { id: true, name: true, marketplace: true, active: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}

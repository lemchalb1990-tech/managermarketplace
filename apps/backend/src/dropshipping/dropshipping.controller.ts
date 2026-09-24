import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { DropshippingService } from './dropshipping.service';
import {
  CreateDropshipSupplierDto, UpdateDropshipSupplierDto,
  CreateDropshipProductDto, UpdateDropshipProductDto,
  ListDropshipOrdersDto, UpdateDropshipOrderDto,
  GenerateDropshipOrdersDto, DropshipReportQueryDto, SyncDropshipCatalogDto,
  PreviewDropshipFeedDto, TestDropshipConnectionDto,
  BrowseDropshipCatalogDto, ImportDropshipCatalogDto,
} from './dto/dropshipping.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('dropshipping')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
export class DropshippingController {
  constructor(private service: DropshippingService) {}

  // ─── Proveedores ───────────────────────────────────────────────────────

  @Get('suppliers')
  listSuppliers(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.listSuppliers(user, companyId);
  }

  @Post('suppliers')
  createSupplier(@Body() dto: CreateDropshipSupplierDto, @CurrentUser() user: any) {
    return this.service.createSupplier(dto, user);
  }

  @Post('suppliers/preview-feed')
  previewFeed(@Body() dto: PreviewDropshipFeedDto) {
    return this.service.previewFeed(dto.catalogUrl);
  }

  @Post('suppliers/test-connection')
  testConnection(@Body() dto: TestDropshipConnectionDto) {
    return this.service.testConnection(dto.connectorType, dto.credentials);
  }

  @Patch('suppliers/:id')
  updateSupplier(@Param('id') id: string, @Body() dto: UpdateDropshipSupplierDto, @CurrentUser() user: any) {
    return this.service.updateSupplier(id, dto, user);
  }

  @Delete('suppliers/:id')
  removeSupplier(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.removeSupplier(id, user);
  }

  @Post('suppliers/:id/sync-catalog')
  syncCatalog(@Param('id') id: string, @Body() dto: SyncDropshipCatalogDto, @CurrentUser() user: any) {
    return this.service.syncCatalog(id, user, dto.catalogUrl);
  }

  // Avance (%) de la sincronización/consulta en curso contra un proveedor API.
  @Get('suppliers/:id/progress')
  getProgress(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.getProgress(id, user);
  }

  // Conectores API: consultar el catálogo del proveedor para elegir qué productos traer.
  @Get('suppliers/:id/catalog')
  browseCatalog(@Param('id') id: string, @Query() query: BrowseDropshipCatalogDto, @CurrentUser() user: any) {
    return this.service.browseCatalog(id, user, {
      q: query.q,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
      refresh: query.refresh === '1' || query.refresh === 'true',
      loadMore: query.loadMore === '1' || query.loadMore === 'true',
    });
  }

  // Descarga en segundo plano el catálogo completo para buscar en todos los registros.
  @Post('suppliers/:id/catalog/load-full')
  loadFullCatalog(@Param('id') id: string, @Body() body: { force?: boolean }, @CurrentUser() user: any) {
    return this.service.loadFullCatalog(id, user, body?.force === true);
  }

  @Post('suppliers/:id/catalog/import')
  importCatalog(@Param('id') id: string, @Body() dto: ImportDropshipCatalogDto, @CurrentUser() user: any) {
    return this.service.importSelected(id, user, dto.skus);
  }

  // ─── Productos ─────────────────────────────────────────────────────────

  @Get('products')
  listProducts(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.listProducts(user, companyId);
  }

  @Post('products')
  createProduct(@Body() dto: CreateDropshipProductDto, @CurrentUser() user: any) {
    return this.service.createProduct(dto, user);
  }

  @Patch('products/:id')
  updateProduct(@Param('id') id: string, @Body() dto: UpdateDropshipProductDto, @CurrentUser() user: any) {
    return this.service.updateProduct(id, dto, user);
  }

  @Delete('products/:id')
  removeProduct(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.removeProduct(id, user);
  }

  // ─── Pedidos ───────────────────────────────────────────────────────────

  @Get('orders')
  listOrders(@CurrentUser() user: any, @Query() query: ListDropshipOrdersDto) {
    return this.service.listOrders(user, query);
  }

  @Post('orders/generate')
  generate(@Body() dto: GenerateDropshipOrdersDto, @CurrentUser() user: any) {
    return this.service.generateOrdersForUser(user, dto.companyId, dto.sinceDays);
  }

  @Get('orders/:id')
  getOrder(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.getOrder(id, user);
  }

  @Patch('orders/:id')
  updateOrder(@Param('id') id: string, @Body() dto: UpdateDropshipOrderDto, @CurrentUser() user: any) {
    return this.service.updateOrder(id, dto, user);
  }

  @Post('orders/:id/send')
  sendOrder(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.sendOrder(id, user);
  }

  // ─── Reporte ───────────────────────────────────────────────────────────

  @Get('report')
  report(@CurrentUser() user: any, @Query() query: DropshipReportQueryDto) {
    return this.service.report(user, query.companyId, query.from, query.to);
  }
}

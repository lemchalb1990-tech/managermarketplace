import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards,
  UseInterceptors, UploadedFile, BadRequestException, Res,
} from '@nestjs/common';
import { Response } from 'express';
import { StorageService } from '../../common/storage/storage.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { Role } from '@prisma/client';
import { ConnectionsService } from './connections.service';
import {
  CreateConnectionDto, LinkProductDto, UpdateConnectionDto, UpsertListingFieldsDto, ConfirmImportDto, SetInvoicePushDto,
} from './connections.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

const imageStorage = diskStorage({
  destination: process.env.UPLOAD_DIR || join(process.cwd(), 'uploads'),
  filename: (_req, file, cb) => {
    cb(null, `${crypto.randomUUID()}${extname(file.originalname)}`);
  },
});

@Controller('ecommerce/connections')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConnectionsController {
  constructor(private service: ConnectionsService, private readonly storage: StorageService) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  list(
    @CurrentUser() user: any,
    @Query('marketplace') marketplace?: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.service.listConnections(user, marketplace, companyId);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  create(@Body() dto: CreateConnectionDto, @CurrentUser() user: any) {
    return this.service.createConnection(dto, user);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.deleteConnection(id, user);
  }

  // Largo máximo del nombre por marketplace (contador de la ficha del producto).
  @Get('title-limits')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  titleLimits(@Query('mlCategoryId') mlCategoryId?: string) {
    return this.service.titleLimits(mlCategoryId || undefined);
  }

  // Ver y editar credenciales de una conexión ya creada: solo Super Admin.
  @Get(':id')
  @Roles(Role.SUPER_ADMIN)
  get(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.getConnection(id, user);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateConnectionDto, @CurrentUser() user: any) {
    return this.service.updateConnection(id, dto, user);
  }

  @Post(':id/test')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  test(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.testConnection(id, user);
  }

  // Envío automático de boleta/factura hacia la plataforma (ver BillingService). No exige
  // Super Admin: es un ajuste operativo de la conexión, no credenciales.
  @Patch(':id/invoice-push')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  setInvoicePush(@Param('id') id: string, @Body() dto: SetInvoicePushDto, @CurrentUser() user: any) {
    return this.service.setSendInvoiceToPlatform(id, dto.enabled, user);
  }

  // Check "Sincronizar" de la tienda: apaga o enciende su sincronización sin desconectarla.
  @Patch(':id/sync')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  setSync(@Param('id') id: string, @Body() dto: SetInvoicePushDto, @CurrentUser() user: any) {
    return this.service.setSyncEnabled(id, dto.enabled, user);
  }

  @Post(':connectionId/products/:productId/publish')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  publish(
    @Param('connectionId') connectionId: string,
    @Param('productId') productId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.publishProduct(connectionId, productId, user);
  }

  @Post(':connectionId/products/:productId/sync')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  syncNow(
    @Param('connectionId') connectionId: string,
    @Param('productId') productId: string,
    @CurrentUser() user: any,
    @Query('listingId') listingId?: string,
  ) {
    return this.service.syncListingNow(connectionId, productId, user, listingId);
  }

  @Patch(':connectionId/products/:productId/toggle')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  toggleNow(
    @Param('connectionId') connectionId: string,
    @Param('productId') productId: string,
    @CurrentUser() user: any,
    @Query('listingId') listingId?: string,
  ) {
    return this.service.toggleListingNow(connectionId, productId, user, listingId);
  }

  // Borra la publicación en la tienda (no solo el vínculo).
  @Delete(':connectionId/products/:productId/remote')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  deleteRemote(
    @Param('connectionId') connectionId: string,
    @Param('productId') productId: string,
    @CurrentUser() user: any,
    @Query('listingId') listingId?: string,
  ) {
    return this.service.deleteRemoteListing(connectionId, productId, user, listingId);
  }

  @Patch('listings/:listingId/price')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  setListingPrice(@Param('listingId') listingId: string, @Body() body: { price: number | null }, @CurrentUser() user: any) {
    return this.service.setListingPrice(listingId, body?.price ?? null, user);
  }

  @Post(':connectionId/products/:productId/link')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  link(
    @Param('connectionId') connectionId: string,
    @Param('productId') productId: string,
    @Body() dto: LinkProductDto,
    @CurrentUser() user: any,
  ) {
    return this.service.linkProduct(connectionId, productId, dto, user);
  }

  @Get('products/:productId/listings')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  listings(@Param('productId') productId: string, @CurrentUser() user: any) {
    return this.service.getProductListings(productId, user);
  }

  // ─── Homologación Paris (familia/categoría/atributos) ────────────────────────

  @Get(':id/paris/families')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  parisFamilies(@Param('id') id: string, @Query('q') q: string, @CurrentUser() user: any) {
    return this.service.getParisFamilies(id, user, q);
  }

  @Get(':id/paris/categories/:familyId')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  parisCategories(@Param('id') id: string, @Param('familyId') familyId: string, @CurrentUser() user: any) {
    return this.service.getParisCategories(id, user, familyId);
  }

  @Get(':id/paris/attributes/:familyId')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  parisAttributes(@Param('id') id: string, @Param('familyId') familyId: string, @CurrentUser() user: any) {
    return this.service.getParisAttributes(id, user, familyId);
  }

  @Get(':id/paris/attribute-options/:attributeId')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  parisAttributeOptions(
    @Param('id') id: string, @Param('attributeId') attributeId: string,
    @Query('q') q: string, @CurrentUser() user: any,
  ) {
    return this.service.getParisAttributeOptions(id, user, attributeId, q);
  }

  @Get(':id/paris/store-prices')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  parisStorePrices(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.getParisStorePrices(id, user);
  }

  // ─── Homologación Ripley (árbol de categorías) ────────────────────────────────

  @Get(':id/ripley/hierarchies')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  ripleyHierarchies(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.getRipleyHierarchies(id, user);
  }

  // ─── Homologación Falabella (árbol de categorías) ─────────────────────────────

  @Get(':id/falabella/categories')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  falabellaCategories(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.getFalabellaCategories(id, user);
  }

  // ─── Campos/fotos de la publicación (borrador antes de publicar) ─────────────

  @Patch(':connectionId/products/:productId/listing')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  upsertListing(
    @Param('connectionId') connectionId: string, @Param('productId') productId: string,
    @Body() dto: UpsertListingFieldsDto, @CurrentUser() user: any,
  ) {
    return this.service.upsertListingFields(connectionId, productId, dto, user);
  }

  @Post(':connectionId/products/:productId/listing-images')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  @UseInterceptors(FileInterceptor('file', { storage: imageStorage }))
  async uploadListingImage(
    @Param('connectionId') connectionId: string, @Param('productId') productId: string,
    @UploadedFile() file: Express.Multer.File, @CurrentUser() user: any,
  ) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    if (file.size > 5 * 1024 * 1024) throw new BadRequestException('El archivo supera el límite de 5 MB');
    if (!file.mimetype.match(/^image\/(jpeg|png|webp)$/)) {
      throw new BadRequestException('Tipo de archivo no permitido. Usa JPG, PNG o WebP');
    }
    const { filename, url } = await this.storage.persist(file);
    return this.service.addListingImage(connectionId, productId, filename, url, user);
  }

  @Delete(':connectionId/products/:productId/listing-images/:imageId')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  removeListingImage(
    @Param('connectionId') connectionId: string, @Param('productId') productId: string,
    @Param('imageId') imageId: string, @CurrentUser() user: any,
  ) {
    return this.service.removeListingImage(connectionId, productId, imageId, user);
  }

  // ─── Importar catálogo existente desde el canal (Paris o Ripley) ─────────────

  @Get(':id/import/preview')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  previewImport(@Param('id') id: string, @Query('offset') offset: string, @CurrentUser() user: any) {
    return this.service.previewImport(id, user, offset ? Number(offset) : undefined);
  }

  @Post(':id/import/confirm')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  confirmImport(@Param('id') id: string, @Body() dto: ConfirmImportDto, @CurrentUser() user: any) {
    return this.service.confirmImport(id, user, dto.externalIds, dto.unlinkIds);
  }

  // ─── Importar ventas (historial) ─────────────────────────────────────────────

  @Get(':id/sales-import/preview')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  previewSalesImport(
    @Param('id') id: string, @Query('from') from: string, @Query('to') to: string, @CurrentUser() user: any,
  ) {
    return this.service.previewSalesImport(id, user, from || undefined, to || undefined);
  }

  // Etiqueta de despacho de una orden de JumpSeller (?detail=1 agrega la página de productos).
  @Get('orders/:orderId/label')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  async printChannelLabel(
    @Param('orderId') orderId: string, @Query('detail') detail: string, @CurrentUser() user: any, @Res() res: Response,
  ) {
    const buffer = await this.service.printChannelLabel(orderId, user, detail === '1' || detail === 'true');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="etiqueta-envio.pdf"');
    res.send(buffer);
  }

  // Crea la Orden de despacho de una venta ya importada que quedó solo como historial.
  @Post('sales/:saleId/order')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  createOrderForSale(@Param('saleId') saleId: string, @Body() body: { withoutStock?: boolean }, @CurrentUser() user: any) {
    return this.service.createOrderForExistingSale(saleId, user, { withoutStock: !!body?.withoutStock });
  }

  // Walmart: qué fuente entrega las fotos de un ítem (diagnóstico) y completar las faltantes.
  @Get(':id/walmart/images-diagnostic')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  walmartImageDiagnostic(@Param('id') id: string, @Query('sku') sku: string, @CurrentUser() user: any) {
    return this.service.walmartImageDiagnostic(id, user, sku);
  }

  @Post(':connectionId/products/:productId/walmart/publish')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  walmartPublish(@Param('connectionId') connectionId: string, @Param('productId') productId: string, @CurrentUser() user: any) {
    return this.service.walmartPublish(connectionId, productId, user);
  }

  @Post(':connectionId/products/:productId/walmart/publish-status')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  walmartPublishStatus(@Param('connectionId') connectionId: string, @Param('productId') productId: string, @CurrentUser() user: any) {
    return this.service.walmartPublishStatus(connectionId, productId, user);
  }

  @Get(':id/import/thumbnail')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  importThumbnail(@Param('id') id: string, @Query('sku') sku: string, @CurrentUser() user: any) {
    return this.service.importThumbnail(id, user, sku);
  }

  @Post(':id/import/fetch-images')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  fetchMissingImages(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.fetchMissingImages(id, user);
  }

  @Get(':id/walmart/thumbnail')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  walmartThumbnail(@Param('id') id: string, @Query('sku') sku: string, @CurrentUser() user: any) {
    return this.service.walmartThumbnail(id, user, sku);
  }

  @Post(':id/walmart/fetch-images')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  walmartFetchMissingImages(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.walmartFetchMissingImages(id, user);
  }

  @Post(':id/orders/sync')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  syncOrderStatuses(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.syncOrderStatuses(id, user);
  }

  @Post(':id/sales-import/confirm')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  confirmSalesImport(@Param('id') id: string, @Body() dto: ConfirmImportDto, @CurrentUser() user: any) {
    return this.service.confirmSalesImport(id, user, dto.externalIds, !!dto.createOrders);
  }
}

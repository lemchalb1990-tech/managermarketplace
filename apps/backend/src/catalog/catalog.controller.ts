import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, UseInterceptors, UploadedFile, BadRequestException, Res,
} from '@nestjs/common';
import { StorageService } from '../common/storage/storage.service';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { Role } from '@prisma/client';
import { assertCanEditField, assertCanAddImages } from './product-field-access';
import { CatalogService } from './catalog.service';
import { CreateProductDto, UpdateProductDto, AdjustStockDto, BulkIdsDto, BulkSetActiveDto, MergeProductsDto, BulkUpdateFieldsDto } from './dto/product.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { assertCanMergeProducts } from './product-field-access';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

const imageStorage = diskStorage({
  destination: process.env.UPLOAD_DIR || join(process.cwd(), 'uploads'),
  filename: (_req, file, cb) => {
    cb(null, `${crypto.randomUUID()}${extname(file.originalname)}`);
  },
});

@Controller('catalog')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
export class CatalogController {
  constructor(private service: CatalogService, private readonly storage: StorageService) {}

  @Post('products')
  create(@Body() dto: CreateProductDto, @CurrentUser() user: any) {
    return this.service.create(dto, user);
  }

  @Get('products')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR)
  findAll(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.findAll(user, companyId);
  }

  @Get('products/search')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR)
  findAllPaginated(
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('search') search?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('category') category?: string,
    @Query('type') type?: string,
    @Query('active') active?: string,
    @Query('listingStatus') listingStatus?: string,
    @Query('channel') channel?: string,
    @Query('companyId') companyId?: string,
    @Query('inStock') inStock?: string,
    @Query('stockFilter') stockFilter?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('stockWarehouseId') stockWarehouseId?: string,
  ) {
    return this.service.findAllPaginated(user, { page, search, warehouseId, category, type, active, listingStatus, channel, companyId, inStock, stockFilter, pageSize, sortBy, sortDir, stockWarehouseId });
  }

  // Dashboard: total de productos con stock crítico y los más urgentes (sin descargar el catálogo).
  @Get('products/critical-stock')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR)
  criticalStock(@CurrentUser() user: any, @Query('companyId') companyId?: string, @Query('limit') limit?: string) {
    return this.service.criticalStock(user, companyId, Number(limit) || 6);
  }

  @Get('products/categories')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR)
  listCategories(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.listCategories(user, companyId);
  }

  @Get('products/bulk/import-template')
  async downloadBulkTemplate(
    @CurrentUser() user: any,
    @Res() res: Response,
    @Query('companyId') companyId?: string,
  ) {
    const buffer = await this.service.exportBulkTemplate(user, companyId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla-stock-precios.xlsx"');
    res.send(buffer);
  }

  @Get('products/:id')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR)
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.findOne(id, user);
  }

  @Patch('products/bulk/active')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  bulkSetActive(@Body() dto: BulkSetActiveDto, @CurrentUser() user: any) {
    return this.service.bulkSetActive(dto.ids, dto.active, user);
  }

  // Editar en lote (bodega asignada / stock crítico): solo Super Admin, para implementaciones.
  @Patch('products/bulk/fields')
  @Roles(Role.SUPER_ADMIN)
  bulkUpdateFields(@Body() dto: BulkUpdateFieldsDto, @CurrentUser() user: any) {
    return this.service.bulkUpdateFields(dto, user);
  }

  @Post('products/bulk/delete')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  bulkDelete(@Body() dto: BulkIdsDto, @CurrentUser() user: any) {
    return this.service.bulkDelete(dto.ids, user);
  }

  @Post('products/bulk/delete-listings')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  bulkDeleteListings(@Body() dto: BulkIdsDto, @CurrentUser() user: any) {
    return this.service.bulkDeleteListings(dto.ids, user);
  }

  // Seleccionar varios productos pegando una lista de códigos (SKU, número sin prefijo o N° de
  // publicación del marketplace).
  @Post('products/bulk/resolve-codes')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  resolveCodes(@Body() body: { codes: string[]; companyId?: string }, @CurrentUser() user: any) {
    return this.service.resolveCodes(Array.isArray(body?.codes) ? body.codes : [], user, body?.companyId);
  }

  // Unificar productos duplicados: paso 1, detalle + validación para armar el selector.
  // Con el permiso «Unificar productos duplicados» (Perfiles de acceso).
  @Post('products/bulk/merge-preview')
  getMergeCandidates(@Body() dto: BulkIdsDto, @CurrentUser() user: any) {
    assertCanMergeProducts(user);
    return this.service.getMergeCandidates(dto.ids, user);
  }

  // Unificar productos duplicados: paso 2, ejecuta la fusión.
  @Post('products/bulk/merge')
  mergeProducts(@Body() dto: MergeProductsDto, @CurrentUser() user: any) {
    assertCanMergeProducts(user);
    return this.service.mergeProducts(dto, user);
  }

  @Post('products/bulk/import')
  @UseInterceptors(FileInterceptor('file'))
  async bulkImport(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
    @Query('companyId') companyId?: string,
  ) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    if (file.size > 5 * 1024 * 1024) throw new BadRequestException('El archivo supera el límite de 5 MB');
    if (!file.originalname.match(/\.xlsx$/i)) {
      throw new BadRequestException('Sube un archivo Excel (.xlsx)');
    }
    // La planilla cambia precio, costo y stock: exige poder modificar los tres.
    assertCanEditField(user, 'price');
    assertCanEditField(user, 'stock');
    assertCanEditField(user, 'cost');
    return this.service.bulkImportStockPrice(file.buffer, user, companyId);
  }

  @Delete('products/:id/listings/:connectionId')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  deleteListing(
    @Param('id') id: string,
    @Param('connectionId') connectionId: string,
    @CurrentUser() user: any,
    @Query('listingId') listingId?: string,
  ) {
    return this.service.deleteListing(id, connectionId, user, listingId);
  }

  @Delete('products/:id/force')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  forceDeleteProduct(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.forceDeleteProduct(id, user);
  }

  @Patch('products/:id')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto, @CurrentUser() user: any) {
    return this.service.update(id, dto, user);
  }

  @Patch('products/:id/stock')
  adjustStock(@Param('id') id: string, @Body() dto: AdjustStockDto, @CurrentUser() user: any) {
    return this.service.adjustStock(id, dto, user);
  }

  @Post('products/:id/images')
  @UseInterceptors(FileInterceptor('file', { storage: imageStorage }))
  async uploadImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
  ) {
    assertCanAddImages(user);
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    if (file.size > 5 * 1024 * 1024) throw new BadRequestException('El archivo supera el límite de 5 MB');
    if (!file.mimetype.match(/^image\/(jpeg|png|webp)$/)) {
      throw new BadRequestException('Tipo de archivo no permitido. Usa JPG, PNG o WebP');
    }
    const { filename, url } = await this.storage.persist(file);
    return this.service.addImage(id, filename, url, user);
  }

  @Delete('products/:id/images/:imageId')
  removeImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.removeImage(id, imageId, user);
  }

  @Patch('products/:id/images/:imageId/primary')
  setPrimary(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.setPrimaryImage(id, imageId, user);
  }
}

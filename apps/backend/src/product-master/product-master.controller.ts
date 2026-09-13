import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ProductMasterService } from './product-master.service';
import {
  CreateProductMasterDto, UpdateProductMasterDto, LinkProductDto, SetVariantAttributesDto,
  CreateCategoryDto, UpdateCategoryDto, SetCategoryChannelMappingDto,
  UpsertProductContentDto, UpsertChannelContentDto, AddProductMasterImageDto,
  SetChannelPriceDto,
} from './dto/product-master.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('product-masters')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
export class ProductMasterController {
  constructor(private service: ProductMasterService) {}

  // ─── Fase 5: categorías (rutas literales — deben ir antes de ':id') ──────────

  @Get('categories')
  listCategories(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.listCategories(user, companyId);
  }

  @Post('categories')
  createCategory(@Body() dto: CreateCategoryDto, @CurrentUser() user: any) {
    return this.service.createCategory(dto, user);
  }

  @Patch('categories/:categoryId')
  updateCategory(@Param('categoryId') categoryId: string, @Body() dto: UpdateCategoryDto, @CurrentUser() user: any) {
    return this.service.updateCategory(categoryId, dto, user);
  }

  @Delete('categories/:categoryId')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  removeCategory(@Param('categoryId') categoryId: string, @CurrentUser() user: any) {
    return this.service.removeCategory(categoryId, user);
  }

  @Post('categories/:categoryId/channel-mapping')
  setCategoryChannelMapping(
    @Param('categoryId') categoryId: string,
    @Body() dto: SetCategoryChannelMappingDto,
    @CurrentUser() user: any,
  ) {
    return this.service.setCategoryChannelMapping(categoryId, dto, user);
  }

  @Delete('categories/:categoryId/channel-mapping/:platform')
  removeCategoryChannelMapping(
    @Param('categoryId') categoryId: string,
    @Param('platform') platform: string,
    @CurrentUser() user: any,
  ) {
    return this.service.removeCategoryChannelMapping(categoryId, platform, user);
  }

  // ─── Fase 10: reporte de migración (solo lectura) ────────────────────────────

  @Get('migration-report')
  getMigrationReport(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.getMigrationReport(user, companyId);
  }

  // ─── Producto/variante (rutas literales "products/…", tampoco chocan con ':id') ──

  @Patch('products/:productId/attributes')
  setVariantAttributes(
    @Param('productId') productId: string,
    @Body() dto: SetVariantAttributesDto,
    @CurrentUser() user: any,
  ) {
    return this.service.setVariantAttributes(productId, dto.attributes, user);
  }

  @Post('products/:productId/channel-price')
  setChannelPrice(@Param('productId') productId: string, @Body() dto: SetChannelPriceDto, @CurrentUser() user: any) {
    return this.service.setChannelPrice(productId, dto, user);
  }

  @Delete('products/:productId/channel-price/:connectionId')
  removeChannelPrice(
    @Param('productId') productId: string,
    @Param('connectionId') connectionId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.removeChannelPrice(productId, connectionId, user);
  }

  @Post('unlink/:productId')
  unlinkProduct(@Param('productId') productId: string, @CurrentUser() user: any) {
    return this.service.unlinkProduct(productId, user);
  }

  @Delete('images/:imageId')
  removeProductMasterImage(@Param('imageId') imageId: string, @CurrentUser() user: any) {
    return this.service.removeProductMasterImage(imageId, user);
  }

  // ─── CRUD del Producto Maestro ────────────────────────────────────────────────

  @Get()
  findAll(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.findAll(user, companyId);
  }

  @Post()
  create(@Body() dto: CreateProductMasterDto, @CurrentUser() user: any) {
    return this.service.create(dto, user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.findOne(id, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProductMasterDto, @CurrentUser() user: any) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.remove(id, user);
  }

  @Post(':id/link')
  linkProduct(@Param('id') id: string, @Body() dto: LinkProductDto, @CurrentUser() user: any) {
    return this.service.linkProduct(id, dto.productId, user);
  }

  @Patch(':id/content')
  upsertProductContent(@Param('id') id: string, @Body() dto: UpsertProductContentDto, @CurrentUser() user: any) {
    return this.service.upsertProductContent(id, dto, user);
  }

  @Patch(':id/channel-content')
  upsertChannelContent(@Param('id') id: string, @Body() dto: UpsertChannelContentDto, @CurrentUser() user: any) {
    return this.service.upsertChannelContent(id, dto, user);
  }

  @Post(':id/images')
  addProductMasterImage(@Param('id') id: string, @Body() dto: AddProductMasterImageDto, @CurrentUser() user: any) {
    return this.service.addProductMasterImage(id, dto, user);
  }
}

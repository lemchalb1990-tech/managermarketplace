import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { Role } from '@prisma/client';
import { CatalogService } from './catalog.service';
import { CreateProductDto, UpdateProductDto, AdjustStockDto, BulkIdsDto, BulkSetActiveDto } from './dto/product.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
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
  constructor(private service: CatalogService) {}

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
    @Query('active') active?: string,
    @Query('companyId') companyId?: string,
    @Query('inStock') inStock?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.findAllPaginated(user, { page, search, warehouseId, category, active, companyId, inStock, pageSize });
  }

  @Get('products/categories')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR)
  listCategories(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.listCategories(user, companyId);
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

  @Post('products/bulk/delete')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  bulkDelete(@Body() dto: BulkIdsDto, @CurrentUser() user: any) {
    return this.service.bulkDelete(dto.ids, user);
  }

  @Post('products/bulk/delete-listings')
  @Roles(Role.SUPER_ADMIN)
  bulkDeleteListings(@Body() dto: BulkIdsDto, @CurrentUser() user: any) {
    return this.service.bulkDeleteListings(dto.ids, user);
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
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    if (file.size > 5 * 1024 * 1024) throw new BadRequestException('El archivo supera el límite de 5 MB');
    if (!file.mimetype.match(/^image\/(jpeg|png|webp)$/)) {
      throw new BadRequestException('Tipo de archivo no permitido. Usa JPG, PNG o WebP');
    }
    const url = `/api/uploads/${file.filename}`;
    return this.service.addImage(id, file.filename, url, user);
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

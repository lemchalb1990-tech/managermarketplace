import {
  Controller, Get, Post, Patch, Delete, Body, Param,
  UseGuards, UseInterceptors, UploadedFile, ParseFilePipe,
  MaxFileSizeValidator, FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { Role } from '@prisma/client';
import { CatalogService } from './catalog.service';
import { CreateProductDto, UpdateProductDto, AdjustStockDto } from './dto/product.dto';
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
  findAll(@CurrentUser() user: any) {
    return this.service.findAll(user);
  }

  @Get('products/:id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.findOne(id, user);
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
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /image\/(jpeg|png|webp)/ }),
        ],
      }),
    )
    file: Express.Multer.File,
    @CurrentUser() user: any,
  ) {
    const url = `/uploads/${file.filename}`;
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

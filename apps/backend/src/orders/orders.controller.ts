import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { Role } from '@prisma/client';
import { OrdersService } from './orders.service';
import {
  CreateOrderDto, UpdateOrderDto, UpdateStatusDto,
  CheckItemDto, FindOrdersDto,
} from './dto/order.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

const photoStorage = diskStorage({
  destination: process.env.UPLOAD_DIR || join(process.cwd(), 'uploads'),
  filename: (_req, file, cb) => {
    cb(null, `${crypto.randomUUID()}${extname(file.originalname)}`);
  },
});

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR)
export class OrdersController {
  constructor(private service: OrdersService) {}

  @Get()
  findAll(@CurrentUser() user: any, @Query() query: FindOrdersDto) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.findOne(id, user);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  create(@Body() dto: CreateOrderDto, @CurrentUser() user: any) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  update(@Param('id') id: string, @Body() dto: UpdateOrderDto, @CurrentUser() user: any) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/status')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  updateStatus(@Param('id') id: string, @Body() dto: UpdateStatusDto, @CurrentUser() user: any) {
    return this.service.updateStatus(id, dto, user);
  }

  @Patch(':id/items/:itemId/check')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  checkItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: CheckItemDto,
    @CurrentUser() user: any,
  ) {
    return this.service.checkItem(id, itemId, dto, user);
  }

  @Patch(':id/items/:itemId/uncheck')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  uncheckItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.uncheckItem(id, itemId, user);
  }

  @Post(':id/photos')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  @UseInterceptors(FileInterceptor('file', { storage: photoStorage }))
  async uploadPhoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
  ) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    if (file.size > 10 * 1024 * 1024) throw new BadRequestException('El archivo supera el límite de 10 MB');
    if (!file.mimetype.match(/^image\/(jpeg|png|webp)$/)) {
      throw new BadRequestException('Tipo de archivo no permitido. Usa JPG, PNG o WebP');
    }
    const url = `/api/uploads/${file.filename}`;
    return this.service.addPhoto(id, file.filename, url, user);
  }

  @Delete(':id/photos/:photoId')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  removePhoto(
    @Param('id') id: string,
    @Param('photoId') photoId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.removePhoto(id, photoId, user);
  }
}

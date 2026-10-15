import {
  Controller, Get, Post, Body, Param, Query, Res, UseGuards, UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ProductBulkLoadService, BulkLoadMode } from './product-bulk-load.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Carga masiva de productos: solo Super Admin (Administrador de plataforma), siempre sobre la
// empresa que está gestionando.
@Controller('catalog/products/bulk/import-products')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class ProductBulkLoadController {
  constructor(private service: ProductBulkLoadService) {}

  private company(companyId?: string) {
    if (!companyId) throw new BadRequestException('Elige la empresa a la que vas a cargar los productos');
    return companyId;
  }

  @Get('fields')
  fields(@Query('companyId') companyId?: string) {
    return this.service.listFields(this.company(companyId));
  }

  @Get('template')
  async template(
    @Res() res: Response,
    @Query('companyId') companyId?: string,
    @Query('fields') fields?: string,
    @Query('withProducts') withProducts?: string,
  ) {
    const keys = (fields || '').split(',').map((k) => k.trim()).filter(Boolean);
    const buffer = await this.service.buildTemplate(this.company(companyId), keys, withProducts === '1' || withProducts === 'true');
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla-carga-productos.xlsx"');
    res.send(buffer);
  }

  @Post('preview')
  @UseInterceptors(FileInterceptor('file'))
  preview(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
    @Query('companyId') companyId?: string,
  ) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    if (file.size > 10 * 1024 * 1024) throw new BadRequestException('El archivo supera el límite de 10 MB');
    if (!/\.xlsx$/i.test(file.originalname)) throw new BadRequestException('Sube un archivo Excel (.xlsx)');
    return this.service.preview(this.company(companyId), user, file.buffer, file.originalname);
  }

  @Get('preview/:id/errors')
  async errors(@Param('id') id: string, @CurrentUser() user: any, @Res() res: Response) {
    const buffer = await this.service.errorsWorkbook(id, user);
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', 'attachment; filename="carga-productos-errores.xlsx"');
    res.send(buffer);
  }

  @Post('confirm')
  confirm(@Body() body: { previewId?: string; mode?: BulkLoadMode }, @CurrentUser() user: any) {
    if (!body?.previewId) throw new BadRequestException('Falta la vista previa a confirmar');
    return this.service.confirm(body.previewId, body.mode ?? 'both', user);
  }

  @Get('jobs/:id')
  job(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.jobStatus(id, user);
  }
}

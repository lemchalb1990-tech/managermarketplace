import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { StorageService } from '../common/storage/storage.service';
import { Design, PlatformMailService, TemplateText } from './platform-mail.service';

const logoStorage = diskStorage({
  destination: process.env.UPLOAD_DIR || join(process.cwd(), 'uploads'),
  filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${extname(file.originalname)}`),
});

// Correo de la plataforma: prueba del servidor (Ajustes del sistema) y textos y diseño de los
// correos (Correos de la plataforma). Solo Super Admin.
@Controller('platform-mail')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class PlatformMailController {
  constructor(private mail: PlatformMailService, private storage: StorageService) {}

  @Post('test')
  test(@Body() body: { to: string }) {
    return this.mail.sendTest(String(body?.to || '').trim());
  }

  @Get('templates')
  templates() {
    return this.mail.listTemplates();
  }

  @Put('templates/:key')
  saveTemplate(@Param('key') key: string, @Body() body: Partial<TemplateText>) {
    return this.mail.saveTemplate(key, body || {});
  }

  @Delete('templates/:key')
  resetTemplate(@Param('key') key: string) {
    return this.mail.resetTemplate(key);
  }

  @Post('templates/:key/preview')
  preview(@Param('key') key: string, @Body() body: Partial<TemplateText> & { design?: Partial<Design> }) {
    return this.mail.previewTemplate(key, body || {});
  }

  @Post('templates/:key/test')
  testTemplate(@Param('key') key: string, @Body() body: Partial<TemplateText> & { to?: string }) {
    return this.mail.sendTemplateTest(key, String(body?.to || '').trim(), body || {});
  }

  @Get('design')
  design() {
    return this.mail.design();
  }

  @Put('design')
  saveDesign(@Body() body: { brand?: string; logoUrl?: string; color?: string; footer?: string }) {
    return this.mail.saveDesign(body || {});
  }

  // Los clientes de correo (Gmail, Outlook) no muestran SVG ni WebP de forma confiable: solo PNG o JPG.
  @Post('design/logo')
  @UseInterceptors(FileInterceptor('file', { storage: logoStorage }))
  async uploadLogo(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    if (file.size > 2 * 1024 * 1024) throw new BadRequestException('El logo supera el límite de 2 MB');
    if (!/^image\/(jpeg|png)$/.test(file.mimetype)) throw new BadRequestException('Usa un logo PNG o JPG (los correos no muestran bien SVG ni WebP)');
    const { url } = await this.storage.persist(file);
    return { url };
  }
}

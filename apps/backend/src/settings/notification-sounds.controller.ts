import {
  Controller, Get, Post, Delete, Param, UseGuards, UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { Role } from '@prisma/client';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

const soundStorage = diskStorage({
  destination: process.env.UPLOAD_DIR || join(process.cwd(), 'uploads'),
  filename: (_req, file, cb) => {
    cb(null, `${crypto.randomUUID()}${extname(file.originalname)}`);
  },
});

// Biblioteca de sonidos de notificación: solo Super Admin sube/elimina, es global para
// toda la plataforma (igual que el logo/nombre por plataforma).
@Controller('notification-sounds')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationSoundsController {
  constructor(private service: SettingsService) {}

  // Solo lectura para COMPANY_ADMIN: puede ver los nombres de los sonidos elegidos en
  // Configuración, pero no subir ni eliminar (eso sigue siendo solo de Super Admin).
  @Get()
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  list() {
    return this.service.listNotificationSounds();
  }

  @Post()
  @Roles(Role.SUPER_ADMIN)
  @UseInterceptors(FileInterceptor('file', { storage: soundStorage }))
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    if (file.size > 2 * 1024 * 1024) throw new BadRequestException('El archivo supera el límite de 2 MB');
    if (!file.mimetype.match(/^audio\/(mpeg|mp3|wav|x-wav|ogg|webm)$/)) {
      throw new BadRequestException('Tipo de archivo no permitido. Usa MP3, WAV u OGG');
    }
    const url = `/api/uploads/${file.filename}`;
    const name = file.originalname.replace(/\.[^.]+$/, '');
    return this.service.addNotificationSound(name, url);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN)
  remove(@Param('id') id: string) {
    return this.service.removeNotificationSound(id);
  }
}

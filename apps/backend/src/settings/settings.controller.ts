import { Controller, Get, Patch, Post, Body, Param, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { StorageService } from '../common/storage/storage.service';
import { IsArray, IsString, ValidateNested, IsOptional, IsInt, Min, Max, IsObject, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { Role } from '@prisma/client';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

const logoStorage = diskStorage({
  destination: process.env.UPLOAD_DIR || join(process.cwd(), 'uploads'),
  filename: (_req, file, cb) => {
    cb(null, `${crypto.randomUUID()}${extname(file.originalname)}`);
  },
});

class SettingItemDto {
  @IsString() key: string;
  @IsString() value: string;
}

class UpdateSettingsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SettingItemDto)
  settings: SettingItemDto[];
}

class PlatformSettingDto {
  @IsOptional() @IsString() displayName?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsInt() @Min(30) @Max(250) logoScale?: number;
  @IsOptional() @IsObject() logoScales?: Record<string, number>;
  @IsOptional() @IsIn(['AVAILABLE', 'SOON', 'DISABLED']) status?: string;
}

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SettingsController {
  constructor(private service: SettingsService, private readonly storage: StorageService) {}

  // Solo lectura para COMPANY_ADMIN: puede ver y copiar (p.ej. la URL de callback de ML)
  // pero no editar, porque son valores globales compartidos por todas las empresas.
  @Get()
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  getAll() {
    return this.service.getAll();
  }

  @Patch()
  @Roles(Role.SUPER_ADMIN)
  update(@Body() dto: UpdateSettingsDto) {
    return this.service.upsertMany(dto.settings);
  }

  @Get('platforms')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR)
  getPlatforms() {
    return this.service.getPlatformSettings();
  }

  // Cuántas empresas usan cada sincronizador (para avisar antes de desactivarlo).
  @Get('platforms/usage')
  @Roles(Role.SUPER_ADMIN)
  platformUsage() {
    return this.service.platformUsage();
  }

  @Patch('platforms/:platform')
  @Roles(Role.SUPER_ADMIN)
  upsertPlatform(@Param('platform') platform: string, @Body() dto: PlatformSettingDto) {
    return this.service.upsertPlatformSetting(platform, dto);
  }

  // Sube el logo ajustado (recortado en el editor) y devuelve su URL; se guarda en la
  // plataforma con el PATCH de arriba, junto con el resto de los datos del formulario.
  @Post('platforms/:platform/logo')
  @Roles(Role.SUPER_ADMIN)
  @UseInterceptors(FileInterceptor('file', { storage: logoStorage }))
  async uploadPlatformLogo(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    if (file.size > 5 * 1024 * 1024) throw new BadRequestException('El archivo supera el límite de 5 MB');
    if (!file.mimetype.match(/^image\/(jpeg|png|webp|svg\+xml)$/)) {
      throw new BadRequestException('Tipo de archivo no permitido. Usa JPG, PNG, WebP o SVG');
    }
    const { url } = await this.storage.persist(file);
    return { url };
  }
}

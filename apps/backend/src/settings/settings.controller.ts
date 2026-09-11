import { Controller, Get, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { IsArray, IsString, ValidateNested, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { Role } from '@prisma/client';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

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
}

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SettingsController {
  constructor(private service: SettingsService) {}

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

  @Patch('platforms/:platform')
  @Roles(Role.SUPER_ADMIN)
  upsertPlatform(@Param('platform') platform: string, @Body() dto: PlatformSettingDto) {
    return this.service.upsertPlatformSetting(platform, dto);
  }
}

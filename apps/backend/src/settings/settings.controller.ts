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
@Roles(Role.SUPER_ADMIN)
export class SettingsController {
  constructor(private service: SettingsService) {}

  @Get()
  getAll() {
    return this.service.getAll();
  }

  @Patch()
  update(@Body() dto: UpdateSettingsDto) {
    return this.service.upsertMany(dto.settings);
  }

  @Get('platforms')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR)
  getPlatforms() {
    return this.service.getPlatformSettings();
  }

  @Patch('platforms/:platform')
  upsertPlatform(@Param('platform') platform: string, @Body() dto: PlatformSettingDto) {
    return this.service.upsertPlatformSetting(platform, dto);
  }
}

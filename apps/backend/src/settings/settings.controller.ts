import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { IsArray, IsString, ValidateNested } from 'class-validator';
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
}

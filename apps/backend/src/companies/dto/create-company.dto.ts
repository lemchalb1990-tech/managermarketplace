import { IsString, MinLength, Matches, IsOptional, IsEmail, ValidateNested, IsInt, IsBoolean, IsArray, IsEnum, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { MarketplaceType } from '@prisma/client';

export class AdminDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;
}

export class CreateCompanyDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'El slug solo puede contener letras minúsculas, números y guiones' })
  slug: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  maxUsers?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => AdminDto)
  admin?: AdminDto;
}

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  active?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  maxUsers?: number;

  @IsOptional()
  modules?: string[] | null;

  @IsOptional()
  @IsBoolean()
  autoSyncSales?: boolean;

  // Plataformas con auto-importación de ventas activa.
  @IsOptional()
  @IsArray()
  @IsEnum(MarketplaceType, { each: true })
  autoSyncSalesPlatforms?: MarketplaceType[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  autoSyncIntervalMinutes?: number;
}

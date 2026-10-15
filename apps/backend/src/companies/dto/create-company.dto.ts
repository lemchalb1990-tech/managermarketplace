import { IsString, MinLength, Matches, IsOptional, IsEmail, ValidateNested, IsInt, IsBoolean, IsArray, IsEnum, Min, Max, IsIn, ValidateIf, MaxLength } from 'class-validator';
import { PLAN_FEATURES } from '../../subscription/subscription.service';
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

  // Adicionales sobre el plan comercial.
  @IsOptional() @IsInt() @Min(0) @Max(1000) extraChannels?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10000000) extraProducts?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10000) extraUsers?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1000) extraWarehouses?: number;
  @IsOptional() @IsArray() @IsIn(PLAN_FEATURES as unknown as string[], { each: true }) extraFeatures?: string[];
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) addonsMonthlyPrice?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(300) addonsNote?: string | null;
}

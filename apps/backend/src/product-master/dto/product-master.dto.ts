import { IsString, IsOptional, IsEnum, IsArray, ValidateNested, IsNumber, IsPositive, IsObject } from 'class-validator';
import { Type } from 'class-transformer';
import { ProductType, ProductMasterStatus, ContentMode } from '@prisma/client';

export class CreateProductMasterDto {
  @IsString() masterSku: string;
  @IsString() name: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsEnum(ProductType) type?: ProductType;
  @IsOptional() @IsEnum(ProductMasterStatus) status?: ProductMasterStatus;
  @IsOptional() @IsString() companyId?: string;
}

export class UpdateProductMasterDto {
  @IsOptional() @IsString() masterSku?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsEnum(ProductType) type?: ProductType;
  @IsOptional() @IsEnum(ProductMasterStatus) status?: ProductMasterStatus;
}

export class LinkProductDto {
  @IsString() productId: string;
}

export class VariantAttributeDto {
  @IsString() name: string;
  @IsString() value: string;
}

export class SetVariantAttributesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantAttributeDto)
  attributes: VariantAttributeDto[];
}

// ─── Fase 5: categorías ────────────────────────────────────────────────────────

export class CreateCategoryDto {
  @IsString() name: string;
  @IsOptional() @IsString() parentId?: string;
  @IsOptional() @IsString() companyId?: string;
}

export class UpdateCategoryDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() parentId?: string;
}

export class SetCategoryChannelMappingDto {
  @IsString() platform: string;
  @IsString() externalCategoryId: string;
  @IsOptional() @IsString() externalCategoryName?: string;
}

// ─── Fase 6: contenido/SEO ─────────────────────────────────────────────────────

export class UpsertProductContentDto {
  @IsOptional() @IsString() seoTitle?: string;
  @IsOptional() @IsString() h1?: string;
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsString() metaDescription?: string;
  @IsOptional() @IsString() keywords?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsObject() features?: Record<string, any>;
  @IsOptional() @IsObject() specifications?: Record<string, any>;
  @IsOptional() @IsObject() compatibility?: Record<string, any>;
  @IsOptional() @IsEnum(ContentMode) titleMode?: ContentMode;
  @IsOptional() @IsEnum(ContentMode) descriptionMode?: ContentMode;
}

export class UpsertChannelContentDto {
  @IsString() platform: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsEnum(ContentMode) mode?: ContentMode;
}

export class AddProductMasterImageDto {
  @IsString() url: string;
  @IsString() filename: string;
  @IsOptional() @IsString() alt?: string;
  @IsOptional() isPrimary?: boolean;
}

// ─── Fase 7: precio por canal ──────────────────────────────────────────────────

export class SetChannelPriceDto {
  @IsString() connectionId: string;
  @IsNumber() @IsPositive() price: number;
}

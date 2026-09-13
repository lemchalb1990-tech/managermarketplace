import { IsString, IsOptional, IsEnum, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ProductType, ProductMasterStatus } from '@prisma/client';

export class CreateProductMasterDto {
  @IsString() masterSku: string;
  @IsString() name: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() internalCategory?: string;
  @IsOptional() @IsEnum(ProductType) type?: ProductType;
  @IsOptional() @IsEnum(ProductMasterStatus) status?: ProductMasterStatus;
  @IsOptional() @IsString() companyId?: string;
}

export class UpdateProductMasterDto {
  @IsOptional() @IsString() masterSku?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() internalCategory?: string;
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

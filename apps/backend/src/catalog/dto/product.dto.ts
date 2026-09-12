import { IsString, IsNumber, IsInt, Min, MinLength, IsOptional, IsArray, IsBoolean, IsEnum, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ProductType } from '@prisma/client';

export class CreateProductDto {
  @IsString()
  @MinLength(1)
  sku: string;

  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsEnum(ProductType)
  type?: ProductType;

  @IsOptional()
  @IsString()
  description?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  mlPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost?: number;

  // Precio del proveedor dropship (solo relevante con el módulo de dropshipping activo).
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  supplierPrice?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock: number;

  // Al alcanzar este stock, las ventas de marketplaces pausan la publicación.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  criticalStock?: number;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  mlCategoryId?: string;

  @IsOptional()
  @IsString()
  mlDescription?: string;

  @IsOptional()
  @IsArray()
  mlAttributes?: { id: string; value_name: string }[];

  @IsOptional()
  @IsString()
  warehouseId?: string;

  // Dimensiones/peso del paquete de envío (opcional) — Mercado Libre las exige en algunas
  // categorías; sin valor, se manda un respaldo genérico al publicar.
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) packageHeight?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) packageWidth?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) packageLength?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) packageWeight?: number;

  // Solo lo usa Super Admin: a qué empresa pertenece el producto (la que tiene
  // seleccionada en el selector de empresa). Para el resto de los roles se ignora — el
  // producto siempre queda en la empresa del usuario.
  @IsOptional()
  @IsString()
  companyId?: string;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  sku?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsEnum(ProductType)
  type?: ProductType;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  mlPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost?: number;

  // Precio del proveedor dropship (solo relevante con el módulo de dropshipping activo).
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  supplierPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  criticalStock?: number;

  @IsOptional()
  active?: boolean;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  mlCategoryId?: string;

  @IsOptional()
  @IsString()
  mlDescription?: string;

  @IsOptional()
  @IsArray()
  mlAttributes?: { id: string; value_name: string }[];

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) packageHeight?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) packageWidth?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) packageLength?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) packageWeight?: number;
}

export class AdjustStockDto {
  @IsInt()
  quantity: number;
}

export class BulkIdsDto {
  @IsArray()
  @IsString({ each: true })
  ids: string[];
}

export class BulkSetActiveDto extends BulkIdsDto {
  @IsBoolean()
  active: boolean;
}

// Campos del producto que se pueden elegir "campo por campo" al unificar duplicados.
// El valor de cada uno es el id del producto (dentro del grupo que se está unificando)
// de donde se toma ese campo.
export class MergeFieldSourcesDto {
  @IsString() sku: string;
  @IsString() name: string;
  @IsString() type: string;
  @IsString() description: string;
  @IsString() mlDescription: string;
  @IsString() mlAttributes: string;
  @IsString() price: string;
  @IsString() mlPrice: string;
  @IsString() cost: string;
  @IsString() supplierPrice: string;
  @IsString() stock: string;
  @IsString() criticalStock: string;
  @IsString() category: string;
  @IsString() mlCategoryId: string;
  @IsString() warehouseId: string;
  @IsString() dropship: string;
}

export class MergeProductsDto {
  @IsArray()
  @IsString({ each: true })
  productIds: string[];

  // Producto cuyo registro persiste (conserva su id); el resto se elimina tras la fusión.
  @IsString()
  survivorId: string;

  @ValidateNested()
  @Type(() => MergeFieldSourcesDto)
  fieldSources: MergeFieldSourcesDto;

  // null = el producto final queda sin imágenes / sin proveedor dropship.
  @IsOptional()
  @IsString()
  imagesFromProductId?: string | null;

  @IsOptional()
  @IsString()
  dropshipFromProductId?: string | null;
}

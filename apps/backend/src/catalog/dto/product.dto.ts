import { IsString, IsNumber, IsInt, Min, MinLength, IsOptional, IsArray } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProductDto {
  @IsString()
  @MinLength(1)
  sku: string;

  @IsString()
  @MinLength(2)
  name: string;

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
  cost?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock: number;

  @IsOptional()
  @IsString()
  mlCategoryId?: string;

  @IsOptional()
  @IsString()
  mlDescription?: string;

  @IsOptional()
  @IsArray()
  mlAttributes?: { id: string; value_name: string }[];
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

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
  cost?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  active?: boolean;

  @IsOptional()
  @IsString()
  mlCategoryId?: string;

  @IsOptional()
  @IsString()
  mlDescription?: string;

  @IsOptional()
  @IsArray()
  mlAttributes?: { id: string; value_name: string }[];
}

export class AdjustStockDto {
  @IsInt()
  quantity: number;
}

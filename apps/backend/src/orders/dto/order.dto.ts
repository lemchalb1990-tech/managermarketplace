import { IsString, IsOptional, IsEnum, IsArray, IsInt, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { OrderStatus, FulfillmentType } from '@prisma/client';

export class ManualItemDto {
  @IsString()
  productId: string;

  @IsInt()
  @Min(1)
  expectedQty: number;
}

export class CreateOrderDto {
  @IsEnum(FulfillmentType)
  fulfillmentType: FulfillmentType;

  @IsOptional()
  @IsString()
  saleId?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  customerEmail?: string;

  @IsOptional()
  @IsString()
  customerPhone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  commune?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualItemDto)
  items?: ManualItemDto[];
}

export class UpdateOrderDto {
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  customerEmail?: string;

  @IsOptional()
  @IsString()
  customerPhone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  commune?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  courier?: string;

  @IsOptional()
  @IsString()
  trackingCode?: string;
}

export class UpdateStatusDto {
  @IsEnum(OrderStatus)
  status: OrderStatus;
}

export class CheckItemDto {
  @IsInt()
  @Min(0)
  checkedQty: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class FindOrdersDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  page?: string;
}

import { IsString, IsNumber, IsInt, Min, IsOptional, IsEnum, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { FulfillmentType, PaymentMethod, SaleChannel } from '@prisma/client';

export class SaleItemDto {
  @IsString()
  productId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitPrice: number;
}

export class CreateSaleDto {
  @IsEnum(SaleChannel)
  channel: SaleChannel;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  externalId?: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsEnum(FulfillmentType)
  fulfillmentType?: FulfillmentType;

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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaleItemDto)
  items: SaleItemDto[];
}

export class BulkDeleteSalesDto {
  @IsArray()
  @IsString({ each: true })
  ids: string[];
}

export class StockAdjustDto {
  @IsString()
  productId: string;

  @IsInt()
  quantity: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

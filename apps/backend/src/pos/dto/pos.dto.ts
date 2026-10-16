import { IsString, IsNumber, IsInt, Min, IsOptional, IsEnum, IsArray, ValidateNested, IsObject, IsBoolean } from 'class-validator';
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

  // Especificaciones del cliente para un producto fabricado a pedido ({ campo: valor }).
  @IsOptional()
  @IsObject()
  specs?: Record<string, string>;
}

export class SalePaymentDto {
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;
}

export class CreateSaleDto {
  @IsEnum(SaleChannel)
  channel: SaleChannel;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  // Pago con varios medios (punto de venta): la suma debe ser igual al total.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalePaymentDto)
  payments?: SalePaymentDto[];

  @IsOptional()
  @IsString()
  notes?: string;

  // Abono (venta con productos fabricados): los medios de pago pueden sumar menos que el total
  // y la diferencia queda como saldo por cobrar.
  @IsOptional()
  @IsBoolean()
  allowBalance?: boolean;

  @IsOptional()
  @IsString()
  externalId?: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsEnum(FulfillmentType)
  fulfillmentType?: FulfillmentType;

  // Bodega desde la que se vende (solo administradores; '' = la bodega de cada producto).
  // El vendedor siempre vende desde su bodega asignada.
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

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

  @IsOptional()
  @IsString()
  warehouseId?: string;
}

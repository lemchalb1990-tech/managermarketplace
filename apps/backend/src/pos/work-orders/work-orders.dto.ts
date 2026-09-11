import { IsString, IsInt, Min, IsNumber, IsOptional, IsArray, ValidateNested, IsEnum, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from '@prisma/client';

export class WorkOrderItemDto {
  // Si viene productId, es una línea de catálogo (descuenta stock al convertir). Si no,
  // es una línea libre (p.ej. "Mano de obra: diagnóstico") — nunca afecta stock.
  @IsOptional()
  @IsString()
  productId?: string;

  @IsString()
  @MinLength(1)
  productName: string;

  @IsOptional()
  @IsString()
  productSku?: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitPrice: number;
}

export class CreateWorkOrderDto {
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsString() customerName?: string;
  @IsOptional() @IsString() customerPhone?: string;
  @IsOptional() @IsString() customerEmail?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() companyId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkOrderItemDto)
  items: WorkOrderItemDto[];
}

export class UpdateWorkOrderDto {
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsString() customerName?: string;
  @IsOptional() @IsString() customerPhone?: string;
  @IsOptional() @IsString() customerEmail?: string;
  @IsOptional() @IsString() notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkOrderItemDto)
  items?: WorkOrderItemDto[];
}

export class ConvertWorkOrderDto {
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;
}

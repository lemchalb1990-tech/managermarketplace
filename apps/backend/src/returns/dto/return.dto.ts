import {
  IsString, IsOptional, IsArray, IsInt, Min, IsEnum, ValidateNested, ArrayNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ReturnCondition, SaleChannel } from '@prisma/client';

class ReturnItemDto {
  @IsOptional() @IsString() productId?: string;
  @IsString() productName: string;
  @IsString() productSku: string;
  @IsInt() @Min(1) quantity: number;
}

export class CreateReturnDto {
  @IsOptional() @IsEnum(SaleChannel) channel?: SaleChannel;
  @IsOptional() @IsString() externalId?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() trackingCode?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() saleId?: string;
  @IsOptional() @IsString() orderId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items: ReturnItemDto[];
}

export class ReceiveReturnDto {
  @IsEnum(ReturnCondition)
  condition: ReturnCondition;

  @IsOptional() @IsString() notes?: string;

  // Ítems a reponer al stock (solo si condición = GOOD).
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  restockItemIds?: string[];
}

export class ScanReturnDto {
  @IsString() code: string;
}

export class ListReturnsDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() q?: string;
}

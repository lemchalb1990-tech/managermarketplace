import { IsString, IsOptional, IsInt, Min, IsArray, ValidateNested, ArrayMinSize, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class OrderRequestItemDto {
  @IsString()
  productId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;
}

export class CreateOrderRequestDto {
  @IsString()
  clientId: string;

  @IsOptional()
  @IsDateString()
  scheduledDispatchDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderRequestItemDto)
  items: OrderRequestItemDto[];
}

export class RejectOrderRequestDto {
  @IsString()
  reason: string;
}

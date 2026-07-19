import { IsString, IsOptional, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTransferDto {
  @IsString()
  productId: string;

  @IsString()
  fromWarehouseId: string;

  @IsString()
  toWarehouseId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  companyId?: string;
}

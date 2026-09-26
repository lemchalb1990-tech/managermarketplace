import { IsString, IsOptional, IsInt, Min, IsArray, ValidateNested, ArrayMinSize, IsBoolean, MaxLength, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class TransferLineDto {
  @IsString()
  productId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;
}

export class CreateTransferDocumentDto {
  @IsOptional() @IsString()
  companyId?: string;

  @IsString()
  fromWarehouseId: string;

  @IsString()
  toWarehouseId: string;

  @IsOptional() @IsString() @MaxLength(500)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TransferLineDto)
  lines: TransferLineDto[];

  // true = crear y despachar en el mismo paso (sale de la bodega de origen de inmediato).
  @IsOptional() @IsBoolean()
  dispatch?: boolean;
}

export class UpdateTransferDocumentDto {
  @IsOptional() @IsString()
  fromWarehouseId?: string;

  @IsOptional() @IsString()
  toWarehouseId?: string;

  @IsOptional() @IsString() @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TransferLineDto)
  lines?: TransferLineDto[];
}

export class ReceiveLineDto {
  @IsString()
  lineId: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  receivedQuantity: number;
}

export class ReceiveTransferDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  lines: ReceiveLineDto[];

  @IsOptional() @IsString() @MaxLength(500)
  notes?: string;
}

export class CancelTransferDto {
  @IsString() @MaxLength(300)
  reason: string;
}

export class InventoryAdjustDto {
  @IsOptional() @IsString()
  companyId?: string;

  @IsString()
  productId: string;

  @IsString()
  warehouseId: string;

  // SET = la bodega queda con exactamente `quantity`; DELTA = suma/resta `quantity`.
  @IsIn(['SET', 'DELTA'])
  mode: 'SET' | 'DELTA';

  @Type(() => Number)
  @IsInt()
  quantity: number;

  @IsString() @MaxLength(300)
  reason: string;
}

export class ReconcileDto {
  @IsOptional() @IsString()
  companyId?: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  productIds?: string[];
}

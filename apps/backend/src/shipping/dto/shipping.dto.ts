import {
  IsString,
  IsOptional,
  IsArray,
  ArrayNotEmpty,
  IsIn,
} from 'class-validator';

export class BoardDto {
  @IsOptional()
  @IsIn(['today', 'upcoming', 'transit', 'done'])
  scope?: 'today' | 'upcoming' | 'transit' | 'done';

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  q?: string;

  // Solo la usa Super Admin para acotar a una empresa (ver baseWhere en el service).
  @IsOptional()
  @IsString()
  companyId?: string;
}

export class DispatchDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  orderIds: string[];

  @IsOptional()
  @IsString()
  courier?: string;

  @IsOptional()
  @IsString()
  trackingCode?: string;
}

import { IsString, IsOptional, IsEnum, IsArray, IsInt, Min, ValidateNested, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { OrderStatus, FulfillmentType, SaleChannel } from '@prisma/client';

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

  // Solo la usa SUPER_ADMIN (sin companyId propio) para indicar a qué empresa
  // pertenece la orden; para el resto de los roles se ignora y se usa user.companyId.
  @IsOptional()
  @IsString()
  companyId?: string;

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
  @IsString()
  companyId?: string;

  // "pending": solo órdenes pendientes de verificación.
  @IsOptional()
  @IsIn(['pending'])
  verification?: string;

  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  // Orden por columna (clic en el título). Sin sortBy: de la más reciente a la más antigua.
  @IsOptional()
  @IsIn(['order', 'customer', 'channel', 'status', 'total', 'date'])
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';

  // Marketplace de origen (canal de la venta): MERCADO_LIBRE, JUMPSELLER, RIPLEY...
  @IsOptional()
  @IsEnum(SaleChannel)
  channel?: SaleChannel;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

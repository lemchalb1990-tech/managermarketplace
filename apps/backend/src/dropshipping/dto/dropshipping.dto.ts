import { IsString, IsOptional, IsNumber, IsBoolean, IsInt, IsEnum, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { DropshipOrderStatus } from '@prisma/client';

// ─── Proveedores dropship ───────────────────────────────────────────────────

export class CreateDropshipSupplierDto {
  // Vincula un proveedor existente…
  @IsOptional() @IsString() supplierId?: string;
  // …o crea uno nuevo al vuelo con estos datos.
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(50) taxId?: string;
  @IsOptional() @IsString() @MaxLength(200) email?: string;
  @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;

  @IsOptional() @IsBoolean() autoCreateOrders?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) leadTimeDays?: number;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;

  @IsOptional() @IsString() companyId?: string;
}

export class UpdateDropshipSupplierDto {
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() autoCreateOrders?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) leadTimeDays?: number | null;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

// ─── Productos dropship ─────────────────────────────────────────────────────

export class CreateDropshipProductDto {
  @IsString() productId: string;
  @IsString() dropshipSupplierId: string;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) supplierCost: number;
  @IsOptional() @IsString() @MaxLength(100) supplierSku?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) leadTimeDays?: number;

  @IsOptional() @IsString() companyId?: string;
}

export class UpdateDropshipProductDto {
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) supplierCost?: number;
  @IsOptional() @IsString() @MaxLength(100) supplierSku?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) leadTimeDays?: number | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

// ─── Pedidos al proveedor ───────────────────────────────────────────────────

export class ListDropshipOrdersDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsEnum(DropshipOrderStatus) status?: DropshipOrderStatus;
  @IsOptional() @IsString() dropshipSupplierId?: string;
  @IsOptional() @IsString() page?: string;
}

export class UpdateDropshipOrderDto {
  @IsOptional() @IsEnum(DropshipOrderStatus) status?: DropshipOrderStatus;
  @IsOptional() @IsString() @MaxLength(120) trackingCode?: string;
  @IsOptional() @IsString() @MaxLength(120) courier?: string;
  @IsOptional() @IsString() @MaxLength(120) supplierRef?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class GenerateDropshipOrdersDto {
  @IsOptional() @IsString() companyId?: string;
  // Cuántos días hacia atrás mirar las ventas al generar (default 30).
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) sinceDays?: number;
}

export class DropshipReportQueryDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

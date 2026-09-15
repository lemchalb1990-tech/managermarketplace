import { IsString, IsOptional, IsNumber, IsBoolean, IsInt, IsEnum, Min, MaxLength, IsObject, IsArray, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { DropshipOrderStatus, DropshipConnectorType } from '@prisma/client';

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

  // Conector para traer el catálogo. FEED (por defecto) = URL pública CSV/JSON.
  // Otros conectores (ej. NORIEGA_API) requieren `credentials`.
  @IsOptional() @IsEnum(DropshipConnectorType) connectorType?: DropshipConnectorType;
  @IsOptional() @IsObject() credentials?: Record<string, string>;

  @IsOptional() @IsString() companyId?: string;
}

export class UpdateDropshipSupplierDto {
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() autoCreateOrders?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) leadTimeDays?: number | null;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsString() @MaxLength(1000) catalogUrl?: string | null;
  // { sku, name, description, imageUrl, stock, cost, price } -> nombre de la columna real
  // del feed del proveedor. null limpia el mapeo (vuelve a la detección automática).
  @IsOptional() @IsObject() fieldMapping?: Record<string, string | null> | null;

  @IsOptional() @IsEnum(DropshipConnectorType) connectorType?: DropshipConnectorType;
  // null limpia las credenciales guardadas.
  @IsOptional() @IsObject() credentials?: Record<string, string> | null;
}

export class SyncDropshipCatalogDto {
  // Si no se envía, se usa el catalogUrl guardado en el proveedor. Solo aplica a
  // proveedores con connectorType FEED.
  @IsOptional() @IsString() @MaxLength(1000) catalogUrl?: string;
}

export class PreviewDropshipFeedDto {
  @IsString() @MaxLength(1000) catalogUrl: string;
}

export class TestDropshipConnectionDto {
  @IsEnum(DropshipConnectorType) connectorType: DropshipConnectorType;
  @IsObject() credentials: Record<string, string>;
}

export class BrowseDropshipCatalogDto {
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
  @IsOptional() @IsString() refresh?: string;
  @IsOptional() @IsString() loadMore?: string;
}

export class ImportDropshipCatalogDto {
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) skus: string[];
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

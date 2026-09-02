import {
  IsString,
  IsOptional,
  IsArray,
  IsInt,
  Min,
  IsBoolean,
  ArrayNotEmpty,
} from 'class-validator';

export class AssignDto {
  // Colaboradores entre los que se reparten los pedidos (round-robin).
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  userIds: string[];

  // Si se omite, reparte todos los pedidos sin asignar de la empresa/bodega.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  orderIds?: string[];

  @IsOptional()
  @IsString()
  warehouseId?: string;
}

export class ResetAssignmentsDto {
  @IsOptional()
  @IsString()
  warehouseId?: string;
}

export class ScanDto {
  @IsString()
  code: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;
}

export class PickItemDto {
  @IsInt()
  @Min(0)
  pickedQty: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class OutOfStockDto {
  @IsBoolean()
  outOfStock: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class BoardQueryDto {
  @IsOptional()
  @IsString()
  warehouseId?: string;
}

export class FlowListDto {
  @IsOptional()
  @IsString()
  warehouseId?: string;

  // 'true' => solo mis pedidos asignados. Por defecto los gestores ven todos.
  @IsOptional()
  @IsString()
  mine?: string;
}

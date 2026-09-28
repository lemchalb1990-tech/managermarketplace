import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString,
  Max, Min, ValidateNested,
} from 'class-validator';
import { FinanceAccountType, PaymentMethod } from '@prisma/client';

export class CreateFinanceAccountDto {
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() parentId?: string;
  // Solo para cuentas raíz; una subcuenta hereda el tipo de su cuenta madre.
  @IsOptional() @IsEnum(FinanceAccountType) type?: FinanceAccountType;
  @IsOptional() @IsString() companyId?: string;
}

export class UpdateFinanceAccountDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() parentId?: string | null;
  @IsOptional() @IsBoolean() archived?: boolean;
}

export class FinanceMovementDto {
  @IsString() @IsNotEmpty() accountId: string;
  @IsDateString() date: string;
  @Type(() => Number) @IsNumber() @Min(0.01) amount: number;
  @IsString() @IsNotEmpty() description: string;
  @IsOptional() @IsString() counterparty?: string;
  @IsOptional() @IsEnum(PaymentMethod) paymentMethod?: PaymentMethod;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() companyId?: string;
}

export class BudgetEntryDto {
  @IsString() accountId: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(12) month: number;
  // null o 0 = sin presupuesto para ese mes.
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) amount?: number | null;
}

export class SaveBudgetsDto {
  @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year: number;
  @IsArray() @ValidateNested({ each: true }) @Type(() => BudgetEntryDto) entries: BudgetEntryDto[];
  @IsOptional() @IsString() companyId?: string;
}

export class CopyBudgetDto {
  @Type(() => Number) @IsInt() @Min(2000) @Max(2100) fromYear: number;
  @Type(() => Number) @IsInt() @Min(2000) @Max(2100) toYear: number;
  // budget = copia el presupuesto; actual = usa lo real de ese año como base.
  @IsIn(['budget', 'actual']) source: 'budget' | 'actual';
  // Ajuste porcentual sobre la base (p. ej. 10 = +10 %).
  @IsOptional() @Type(() => Number) @IsNumber() percent?: number;
  // Solo cuentas de este tipo; si no viene, todas.
  @IsOptional() @IsEnum(FinanceAccountType) type?: FinanceAccountType;
  @IsOptional() @IsString() companyId?: string;
}

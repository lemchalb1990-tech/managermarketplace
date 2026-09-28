import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString,
  Max, Min, ValidateNested,
} from 'class-validator';
import { FinanceAccountType, FinanceBankAccountType, PaymentMethod } from '@prisma/client';

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
  // IVA de la compra/venta (crédito o débito): amount + tax = lo que movió la caja.
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) tax?: number;
  @IsOptional() @IsString() bankAccountId?: string | null;
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

export class BankAccountDto {
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsEnum(FinanceBankAccountType) type?: FinanceBankAccountType;
  @IsOptional() @IsString() bankName?: string;
  @IsOptional() @IsString() accountNumber?: string;
  @IsOptional() @Type(() => Number) @IsNumber() initialBalance?: number;
  @IsOptional() @IsDateString() initialDate?: string;
  @IsOptional() @IsBoolean() archived?: boolean;
  @IsOptional() @IsString() companyId?: string;
}

export class TransferDto {
  @IsString() fromAccountId: string;
  @IsString() toAccountId: string;
  @Type(() => Number) @IsNumber() @Min(0.01) amount: number;
  @IsDateString() date: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() companyId?: string;
}

export class StatementLineDto {
  @IsDateString() date: string;
  @IsString() description: string;
  // + abono / − cargo.
  @Type(() => Number) @IsNumber() amount: number;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @Type(() => Number) @IsNumber() balance?: number;
}

export class ImportStatementDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => StatementLineDto) lines: StatementLineDto[];
}

export class ReconcileDto {
  @IsIn(['match', 'ignore', 'create', 'unmatch']) action: 'match' | 'ignore' | 'create' | 'unmatch';
  // match: movimiento o traspaso existente con el que se concilia.
  @IsOptional() @IsString() movementId?: string;
  @IsOptional() @IsString() transferId?: string;
  // ignore: motivo (p. ej. "Liquidación de Mercado Libre, ya contada en ventas").
  @IsOptional() @IsString() note?: string;
  // create: cuenta del movimiento nuevo y si el monto incluye IVA (se separa neto + IVA).
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsBoolean() withIva?: boolean;
  @IsOptional() @IsString() description?: string;
}

export class RecurringDto {
  @IsString() @IsNotEmpty() accountId: string;
  @IsString() @IsNotEmpty() description: string;
  @Type(() => Number) @IsNumber() @Min(0.01) amount: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) tax?: number;
  @IsOptional() @IsString() counterparty?: string;
  @IsOptional() @IsEnum(PaymentMethod) paymentMethod?: PaymentMethod;
  @IsOptional() @IsString() bankAccountId?: string | null;
  @Type(() => Number) @IsInt() @Min(1) @Max(31) dayOfMonth: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) intervalMonths?: number;
  @IsDateString() startDate: string;
  @IsOptional() @IsDateString() endDate?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() companyId?: string;
}

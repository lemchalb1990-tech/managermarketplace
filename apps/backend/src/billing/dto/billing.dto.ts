import {
  IsString, IsEnum, IsOptional, IsEmail, IsArray,
  ValidateNested, IsNumber, Min, IsPositive, IsDateString, IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BillingProvider, DteType, PaymentMethod, PaymentCondition } from '@prisma/client';

export class CreateBillingConnectionDto {
  @IsString() name: string;
  @IsEnum(BillingProvider) provider: BillingProvider;
  @IsOptional() credentials?: Record<string, string>;
  @IsOptional() @IsString() companyId?: string;
}

export class InvoiceItemDto {
  @IsString() name: string;
  @IsNumber() @IsPositive() quantity: number;
  @IsNumber() @IsPositive() unitPrice: number;
  @IsOptional() @IsNumber() @Min(0) discount?: number;
}

export class IssueInvoiceDto {
  @IsString() connectionId: string;
  @IsEnum(DteType) dteType: DteType;
  @IsString() rut: string;
  @IsString() razonSocial: string;
  @IsOptional() @IsString() giro?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() commune?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => InvoiceItemDto) items: InvoiceItemDto[];
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() saleId?: string;
  @IsOptional() @IsString() clientId?: string;
  // Condición de pago del DTE (se transmite al proveedor como forma de pago SII).
  @IsOptional() @IsEnum(PaymentCondition) paymentCondition?: PaymentCondition;
  // Fecha de vencimiento cuando la condición es CREDITO.
  @IsOptional() @IsDateString() dueDate?: string;
  // Al emitir de contado: registrar el pago de una vez.
  @IsOptional() @IsBoolean() markPaid?: boolean;
  @IsOptional() @IsEnum(PaymentMethod) paymentMethod?: PaymentMethod;
  @IsOptional() @IsString() paymentReference?: string;
}

export class MarkInvoicePaidDto {
  @IsEnum(PaymentMethod) paymentMethod: PaymentMethod;
  @IsOptional() @IsString() paymentReference?: string;
  @IsOptional() @IsDateString() paidAt?: string;
}

export class IssueDraftDto {
  @IsOptional() @IsBoolean() markPaid?: boolean;
  @IsOptional() @IsEnum(PaymentMethod) paymentMethod?: PaymentMethod;
  @IsOptional() @IsString() paymentReference?: string;
}

export class ListInvoicesDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsEnum(DteType) dteType?: DteType;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() connectionId?: string;
  @IsOptional() @IsString() page?: string;
}

export class UpsertBillingProfileDto {
  @IsOptional() @IsString() razonSocial?: string;
  @IsOptional() @IsString() rut?: string;
  @IsOptional() @IsString() giro?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() commune?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() resolutionNumber?: string;
  @IsOptional() @IsDateString() resolutionDate?: string;
  @IsOptional() @IsString() footerText?: string;
  @IsOptional() @IsString() companyId?: string;
}

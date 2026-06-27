import {
  IsString, IsEnum, IsOptional, IsEmail, IsArray,
  ValidateNested, IsNumber, Min, IsPositive,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BillingProvider, DteType } from '@prisma/client';

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

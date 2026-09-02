import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  Min,
  IsBoolean,
  IsArray,
  ArrayNotEmpty,
  IsDateString,
} from 'class-validator';
import { DriverPayModel, StopOutcome } from '@prisma/client';

export class UpsertDriverProfileDto {
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() zone?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsEnum(DriverPayModel) payModel?: DriverPayModel;
  @IsOptional() @IsNumber() @Min(0) flatRate?: number;
  @IsOptional() @IsNumber() @Min(0) perPackageRate?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class SetOutcomeDto {
  @IsEnum(StopOutcome)
  outcome: StopOutcome;

  @IsOptional() @IsString() notes?: string;
}

export class RangeDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() driverId?: string;
}

export class CreatePaymentBatchDto {
  @IsString() driverId: string;

  // IDs de los RouteStop entregados y aún no pagados a incluir en el lote.
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  stopIds: string[];

  @IsOptional() @IsString() notes?: string;
}

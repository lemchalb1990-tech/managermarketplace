import { IsString, IsOptional, IsNumber, IsEnum, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ProfitabilityStatus } from '@prisma/client';

export class CreateProfitabilityItemDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  competitorName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  competitorPrice?: number;

  @IsOptional()
  @IsString()
  competitorUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  myDimensions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  competitorDimensions?: string;

  @IsOptional()
  @IsEnum(ProfitabilityStatus)
  status?: ProfitabilityStatus;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  companyId?: string;
}

export class UpdateProfitabilityItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  competitorName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  competitorPrice?: number;

  @IsOptional()
  @IsString()
  competitorUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  myDimensions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  competitorDimensions?: string;

  @IsOptional()
  @IsEnum(ProfitabilityStatus)
  status?: ProfitabilityStatus;

  @IsOptional()
  @IsString()
  note?: string;

  // Precio propio fijado a mano. Si viene un número, el service marca manualPrice
  // = true; si se envía explícitamente null, vuelve a seguir la sugerencia
  // automática (competitorPrice - 1000). Sin @Type(Number): el body JSON ya trae
  // el tipo correcto y Number(null) rompería el reset a null.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  myPrice?: number | null;
}

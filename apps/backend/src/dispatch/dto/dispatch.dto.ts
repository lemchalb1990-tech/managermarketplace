import {
  IsString, IsOptional, IsNumber, IsDateString, IsEnum, IsArray, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RouteStatus } from '@prisma/client';

export class CreateRouteDto {
  @IsString()
  name: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  dispatcherId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateRouteDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  dispatcherId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(RouteStatus)
  status?: RouteStatus;
}

export class AddStopDto {
  @IsString()
  orderId: string;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

class StopPosition {
  @IsString()
  stopId: string;

  @IsNumber()
  position: number;
}

export class ReorderStopsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StopPosition)
  positions: StopPosition[];
}

export class DeliverStopDto {
  @IsOptional()
  @IsString()
  notes?: string;
}

export class FindRoutesDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  dispatcherId?: string;

  @IsOptional()
  @IsString()
  companyId?: string;
}

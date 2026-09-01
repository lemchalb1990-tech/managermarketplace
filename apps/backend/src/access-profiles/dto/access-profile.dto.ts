import { IsString, MinLength, IsArray, IsOptional } from 'class-validator';

export class CreateAccessProfileDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsArray()
  @IsString({ each: true })
  permissions: string[];

  // Solo lo respeta SUPER_ADMIN; un COMPANY_ADMIN siempre crea en su empresa.
  @IsOptional()
  @IsString()
  companyId?: string;
}

export class UpdateAccessProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];
}

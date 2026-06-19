import { IsString, MinLength, Matches, IsOptional, IsEmail, ValidateNested, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class AdminDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;
}

export class CreateCompanyDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'El slug solo puede contener letras minúsculas, números y guiones' })
  slug: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  maxUsers?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => AdminDto)
  admin?: AdminDto;
}

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  active?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  maxUsers?: number;
}

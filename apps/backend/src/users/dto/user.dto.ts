import { IsEmail, IsString, MinLength, IsEnum, IsOptional, IsArray } from 'class-validator';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  @MinLength(2)
  name: string;

  // Solo para crear Super Admin. Para usuarios de empresa el nivel sale del perfil de acceso.
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  accessProfileId?: string | null;

  @IsOptional()
  @IsString()
  posWarehouseId?: string | null;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  active?: boolean;

  @IsOptional()
  @IsArray()
  modules?: string[] | null;

  @IsOptional()
  @IsString()
  accessProfileId?: string | null;

  // Bodega desde la que vende en el punto de venta (null = la bodega de cada producto).
  @IsOptional()
  @IsString()
  posWarehouseId?: string | null;
}

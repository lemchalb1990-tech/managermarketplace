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

  // Tiendas/bodegas desde las que vende en el punto de venta (vacío = la bodega de cada producto).
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  posWarehouseIds?: string[];
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

  // Tiendas/bodegas desde las que vende en el punto de venta (vacío = la bodega de cada producto).
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  posWarehouseIds?: string[];
}

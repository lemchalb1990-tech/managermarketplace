import { IsString, IsOptional, IsBoolean, IsNumber, IsEmail, IsEnum, Min, Max, IsArray, IsObject } from 'class-validator';
import { EmailType } from '@prisma/client';

export class UpsertEmailConfigDto {
  @IsString() host: string;
  @IsNumber() @Min(1) @Max(65535) port: number;
  @IsBoolean() secure: boolean;
  @IsString() user: string;
  @IsString() @IsOptional() pass?: string;
  @IsString() fromName: string;
  @IsEmail() fromEmail: string;
  @IsBoolean() @IsOptional() active?: boolean;
}

export class UpsertEmailTemplateDto {
  @IsString() subject: string;
  // Plantillas HTML antiguas. Las nuevas se guardan como bloques.
  @IsString() @IsOptional() bodyHtml?: string;
  // Bloques del editor (el servicio los valida uno a uno).
  @IsArray() @IsOptional() blocks?: unknown[];
  @IsBoolean() @IsOptional() active?: boolean;
}

export class PreviewEmailTemplateDto {
  @IsString() subject: string;
  @IsArray() @IsOptional() blocks?: unknown[];
  @IsString() @IsOptional() bodyHtml?: string;
  // Identidad sin guardar, para ver los cambios en vivo.
  @IsObject() @IsOptional() brand?: { color?: string; showLogo?: boolean; footerText?: string | null; contact?: string | null };
}

export class TestEmailTemplateDto extends PreviewEmailTemplateDto {
  @IsEmail() to: string;
}

export class UpsertEmailBrandDto {
  @IsString() @IsOptional() color?: string;
  @IsBoolean() @IsOptional() showLogo?: boolean;
  @IsString() @IsOptional() footerText?: string | null;
  @IsString() @IsOptional() contact?: string | null;
}

export class TestEmailDto {
  @IsEmail() to: string;
}

export class FindEmailDto {
  @IsString() @IsOptional() companyId?: string;
}

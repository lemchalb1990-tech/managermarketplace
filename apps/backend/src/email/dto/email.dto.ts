import { IsString, IsOptional, IsBoolean, IsNumber, IsEmail, IsEnum, Min, Max } from 'class-validator';
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
  @IsString() bodyHtml: string;
  @IsBoolean() @IsOptional() active?: boolean;
}

export class TestEmailDto {
  @IsEmail() to: string;
}

export class FindEmailDto {
  @IsString() @IsOptional() companyId?: string;
}

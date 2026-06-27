import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';

export class CreateConnectionDto {
  @IsString() @IsNotEmpty()
  marketplace: string;

  @IsString() @IsNotEmpty()
  name: string;

  @IsObject()
  credentials: Record<string, string>;

  @IsOptional() @IsString()
  companyId?: string;
}

export class LinkProductDto {
  @IsString() @IsNotEmpty()
  externalId: string;

  @IsOptional() @IsString()
  externalUrl?: string;
}

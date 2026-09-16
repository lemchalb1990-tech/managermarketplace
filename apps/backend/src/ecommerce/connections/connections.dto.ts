import { IsString, IsNotEmpty, IsOptional, IsObject, IsArray } from 'class-validator';

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

export class UpdateConnectionDto {
  @IsOptional() @IsString()
  name?: string;

  // Solo las claves incluidas se sobreescriben; el resto de las credenciales existentes
  // se mantiene (ver ConnectionsService.updateConnection).
  @IsOptional() @IsObject()
  credentials?: Record<string, string>;
}

export class LinkProductDto {
  @IsString() @IsNotEmpty()
  externalId: string;

  @IsOptional() @IsString()
  externalUrl?: string;
}

export class UpsertListingFieldsDto {
  @IsOptional() @IsString()
  title?: string;

  @IsOptional() @IsString()
  description?: string;

  // Forma libre a propósito: cada plataforma guarda algo distinto acá (Paris:
  // familyId/categoryId/attributes[]; Ripley: categoryCode/brand) — el propio adapter
  // (ParisAdapter/RipleyAdapter) es quien conoce e interpreta su forma esperada.
  @IsOptional() @IsObject()
  channelAttributes?: Record<string, any>;
}

export class ConfirmImportDto {
  @IsArray() @IsString({ each: true })
  externalIds: string[];

  @IsOptional() @IsArray() @IsString({ each: true })
  unlinkIds?: string[];
}

import { IsString, IsNotEmpty, IsOptional, IsObject, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

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

class ParisAttributeValueDto {
  @IsString() @IsNotEmpty()
  attributeId: string;

  @IsString() @IsNotEmpty()
  name: string;

  @IsOptional() @IsString()
  value?: string;

  @IsOptional() @IsString()
  optionId?: string;

  @IsOptional() @IsString()
  optionName?: string;
}

class ParisChannelAttributesDto {
  @IsString() @IsNotEmpty()
  familyId: string;

  @IsOptional() @IsString()
  familyName?: string;

  @IsString() @IsNotEmpty()
  categoryId: string;

  @IsOptional() @IsString()
  categoryPath?: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => ParisAttributeValueDto)
  attributes: ParisAttributeValueDto[];
}

export class UpsertListingFieldsDto {
  @IsOptional() @IsString()
  title?: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @ValidateNested() @Type(() => ParisChannelAttributesDto)
  channelAttributes?: ParisChannelAttributesDto;
}

export class ConfirmImportDto {
  @IsArray() @IsString({ each: true })
  externalIds: string[];

  @IsOptional() @IsArray() @IsString({ each: true })
  unlinkIds?: string[];
}

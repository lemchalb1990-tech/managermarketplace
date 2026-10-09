import { BadRequestException, Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Logger } from '@nestjs/common';
import { IsString } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '@prisma/client';
import { CompaniesService } from './companies.service';
import { CompanyClosureService } from './company-closure.service';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/create-company.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

class PurgeCompanyDto {
  @IsString() confirmName: string;
}

@Controller('companies')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class CompaniesController {
  private readonly logger = new Logger(CompaniesController.name);

  constructor(private service: CompaniesService, private closure: CompanyClosureService) {}

  @Post()
  create(@Body() dto: CreateCompanyDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCompanyDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  // Eliminación definitiva por el Super Admin: borra la empresa y TODA su información
  // (productos, ventas, órdenes, usuarios, documentos, conexiones, finanzas y archivos), con el
  // mismo borrado que la baja de cuenta. Exige escribir el nombre de la empresa.
  @Post(':id/purge')
  async purge(@Param('id') id: string, @Body() dto: PurgeCompanyDto, @CurrentUser() user: any) {
    const company: any = await this.service.findOne(id);
    if (user.companyId === id) throw new BadRequestException('No puedes eliminar la empresa a la que perteneces.');
    if ((dto.confirmName || '').trim().toLowerCase() !== String(company.name).trim().toLowerCase()) {
      throw new BadRequestException('El nombre escrito no coincide con el de la empresa.');
    }
    const res = await this.closure.purgeCompany(id);
    this.logger.warn(`Empresa ${id} (${company.name}) eliminada por el super admin ${user.email}: ${res.rows} filas, ${res.files} archivos`);
    return res;
  }

  // Revierte una baja pedida por el administrador de la empresa (dentro de los 30 días).
  @Post(':id/closure/cancel')
  cancelClosure(@Param('id') id: string) {
    return this.closure.cancelClosure(id);
  }

  @Post(':id/delete-listings')
  deleteAllListings(@Param('id') id: string) {
    return this.service.deleteAllListings(id);
  }
}

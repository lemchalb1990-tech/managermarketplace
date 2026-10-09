import { BadRequestException, Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
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

// Eliminaciones en curso (en memoria): el panel consulta su avance hasta que terminan.
interface PurgeJob {
  companyId: string;
  companyName: string;
  percent: number;
  step: string;
  done: boolean;
  error: string | null;
  result: { rows: number; files: number } | null;
  finishedAt?: number;
}
const purgeJobs = new Map<string, PurgeJob>();

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
    if ([...purgeJobs.values()].some((j) => j.companyId === id && !j.done)) {
      throw new BadRequestException('Esta empresa ya se está eliminando.');
    }
    // Se elimina en segundo plano; el panel consulta el avance con GET purge-jobs/:jobId.
    const jobId = randomUUID();
    const job: PurgeJob = { companyId: id, companyName: company.name, percent: 0, step: 'En cola', done: false, error: null, result: null };
    purgeJobs.set(jobId, job);
    this.closure.purgeCompany(id, (percent, step) => { job.percent = percent; job.step = step; })
      .then((res) => {
        job.result = res;
        this.logger.warn(`Empresa ${id} (${company.name}) eliminada por el super admin ${user.email}: ${res.rows} filas, ${res.files} archivos`);
      })
      .catch((err) => {
        job.error = err?.message || 'No se pudo eliminar la empresa.';
        this.logger.error(`No se pudo eliminar la empresa ${id}: ${job.error}`);
      })
      .finally(() => {
        job.done = true;
        job.finishedAt = Date.now();
        // Se limpian las eliminaciones terminadas hace más de una hora.
        for (const [k, j] of purgeJobs) if (j.finishedAt && Date.now() - j.finishedAt > 3600_000) purgeJobs.delete(k);
      });
    return { jobId };
  }

  @Get('purge-jobs/:jobId')
  purgeStatus(@Param('jobId') jobId: string) {
    const job = purgeJobs.get(jobId);
    if (!job) throw new NotFoundException('Eliminación no encontrada');
    return job;
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

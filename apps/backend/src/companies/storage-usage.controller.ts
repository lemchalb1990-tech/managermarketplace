import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { StorageUsageService } from './storage-usage.service';

// Medición del espacio que ya ocupaban las empresas antes del registro por archivo (Super Admin).
@Controller('storage-usage')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class StorageUsageController {
  constructor(private service: StorageUsageService, private prisma: PrismaService) {}

  @Get('status')
  async status() {
    const marker = await this.prisma.setting.findUnique({ where: { key: '_STORAGE_MEASURED_AT' } });
    return { measuredAt: marker?.value ?? null, running: this.service.isRunning };
  }

  // Corre en segundo plano: puede tardar con muchos archivos.
  @Post('measure')
  measure() {
    void this.service.measureAll().catch(() => {});
    return { started: true };
  }
}

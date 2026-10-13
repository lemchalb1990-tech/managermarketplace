import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { EmailLogService } from './email-log.service';

// Registro de correos enviados (Correos de la plataforma → Enviados). Solo Super Admin.
@Controller('email-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class EmailLogController {
  constructor(private logs: EmailLogService) {}

  @Get()
  list(@Query() q: Record<string, string>) {
    return this.logs.list(q);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.logs.get(id);
  }
}

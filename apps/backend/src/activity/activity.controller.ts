import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ActivityService } from './activity.service';

// Historial de actividad de la empresa (solo lectura). Super Admin: cualquier empresa;
// administrador: la suya; otros perfiles con el permiso "Historial de actividad".
@Controller('activity')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR, Role.ORDER_MANAGER, Role.DESPACHADOR)
@RequirePermissions('activity')
export class ActivityController {
  constructor(private service: ActivityService) {}

  @Get()
  list(@CurrentUser() user: any, @Query() q: any) {
    return this.service.list(user, q);
  }

  @Get('filters')
  filters(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.filters(user, companyId);
  }

  @Get('export')
  async export(@CurrentUser() user: any, @Query() q: any, @Res() res: Response) {
    const buffer = await this.service.export(user, q);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="historial-actividad.xlsx"');
    res.send(buffer);
  }
}

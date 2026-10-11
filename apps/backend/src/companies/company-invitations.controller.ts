import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CompanyInvitationsService } from './company-invitations.service';

// Invitaciones para crear empresas nuevas (solo Super Admin).
@Controller('company-invitations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class CompanyInvitationsController {
  constructor(private service: CompanyInvitationsService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(@CurrentUser() user: any, @Body() body: any) {
    return this.service.create(user, body || {});
  }

  @Post(':id/resend')
  resend(@Param('id') id: string) {
    return this.service.resend(id);
  }

  @Post(':id/link')
  link(@Param('id') id: string) {
    return this.service.link(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }
}

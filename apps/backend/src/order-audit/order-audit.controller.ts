import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrderAuditService } from './order-audit.service';

// Verificador de órdenes: vista exclusiva del Super Admin.
@Controller('order-audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class OrderAuditController {
  constructor(private service: OrderAuditService) {}

  @Get('summary')
  summary() {
    return this.service.summary();
  }

  @Get('issues')
  issues(@Query() q: any) {
    return this.service.issues(q || {});
  }

  @Get('runs')
  runs() {
    return this.service.runs();
  }

  @Post('run')
  run(@CurrentUser() user: any, @Body() body: { full?: boolean }) {
    return this.service.startManual(user, !!body?.full);
  }

  @Patch('issues/:id')
  setStatus(@CurrentUser() user: any, @Param('id') id: string, @Body() body: { status: string }) {
    return this.service.setIssueStatus(user, id, body?.status);
  }
}

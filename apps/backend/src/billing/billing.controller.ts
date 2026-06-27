import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { BillingService } from './billing.service';
import { CreateBillingConnectionDto, IssueInvoiceDto, ListInvoicesDto } from './dto/billing.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('billing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
export class BillingController {
  constructor(private service: BillingService) {}

  // ── Connections ──────────────────────────────────────────────────

  @Get('connections')
  getConnections(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.getConnections(user, companyId);
  }

  @Post('connections')
  createConnection(@Body() dto: CreateBillingConnectionDto, @CurrentUser() user: any) {
    return this.service.createConnection(dto, user);
  }

  @Delete('connections/:id')
  deleteConnection(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.deleteConnection(id, user);
  }

  @Post('connections/:id/test')
  testConnection(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.testConnection(id, user);
  }

  // ── Invoices ──────────────────────────────────────────────────────

  @Get('invoices')
  getInvoices(@CurrentUser() user: any, @Query() query: ListInvoicesDto) {
    return this.service.getInvoices(user, query);
  }

  @Post('invoices')
  issueInvoice(@Body() dto: IssueInvoiceDto, @CurrentUser() user: any) {
    return this.service.issueInvoice(dto, user);
  }

  @Get('invoices/:id')
  getInvoice(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.getInvoice(id, user);
  }

  @Post('invoices/:id/cancel')
  cancelInvoice(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.cancelInvoice(id, user);
  }
}

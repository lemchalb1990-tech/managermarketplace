import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CouriersService } from './couriers.service';

// Couriers: conexiones por empresa (admin) y envíos de las órdenes (bodega y despacho).
@Controller('couriers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.DESPACHADOR)
export class CouriersController {
  constructor(private service: CouriersService) {}

  @Get('connections')
  list(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.list(user, companyId);
  }

  @Put('connections/:provider')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  upsert(@CurrentUser() user: any, @Param('provider') provider: string, @Body() body: any) {
    return this.service.upsert(user, provider, body || {});
  }

  @Delete('connections/:provider')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  remove(@CurrentUser() user: any, @Param('provider') provider: string, @Query('companyId') companyId?: string) {
    return this.service.remove(user, provider, companyId);
  }

  @Post('connections/:provider/test')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  test(@CurrentUser() user: any, @Param('provider') provider: string, @Query('companyId') companyId?: string) {
    return this.service.test(user, provider, companyId);
  }

  @Get('shipments')
  shipments(@CurrentUser() user: any, @Query('status') status?: string, @Query('companyId') companyId?: string) {
    return this.service.list_(user, { status, companyId });
  }

  @Post('shipments/:id/refresh')
  refresh(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.refresh(user, id);
  }

  @Get('orders/:orderId/shipments')
  forOrder(@CurrentUser() user: any, @Param('orderId') orderId: string) {
    return this.service.listForOrder(user, orderId);
  }

  @Post('orders/:orderId/quote')
  quote(@CurrentUser() user: any, @Param('orderId') orderId: string, @Body() body: any) {
    return this.service.quote(user, orderId, body || {});
  }

  @Post('orders/:orderId/shipments')
  create(@CurrentUser() user: any, @Param('orderId') orderId: string, @Body() body: any) {
    return this.service.create(user, orderId, body || {});
  }
}

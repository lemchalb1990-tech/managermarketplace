import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { OrderRequestsService } from './order-requests.service';
import { CreateOrderRequestDto, RejectOrderRequestDto } from './dto/order-request.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

const REQUESTER_ROLES = [Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR, Role.ORDER_MANAGER];
const APPROVER_ROLES = [Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.ORDER_MANAGER];

@Controller('order-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...REQUESTER_ROLES)
export class OrderRequestsController {
  constructor(private service: OrderRequestsService) {}

  @Post()
  create(@Body() dto: CreateOrderRequestDto, @CurrentUser() user: any) {
    return this.service.create(dto, user);
  }

  @Get('mine')
  findMine(@CurrentUser() user: any, @Query('page') page?: string) {
    return this.service.findMine(user, page);
  }

  @Get('pending')
  @Roles(...APPROVER_ROLES)
  findPending(@CurrentUser() user: any, @Query('companyId') companyId?: string, @Query('page') page?: string) {
    return this.service.findPending(user, { companyId, page });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.findOne(id, user);
  }

  @Patch(':id/approve')
  @Roles(...APPROVER_ROLES)
  approve(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.approve(id, user);
  }

  @Patch(':id/reject')
  @Roles(...APPROVER_ROLES)
  reject(@Param('id') id: string, @Body() dto: RejectOrderRequestDto, @CurrentUser() user: any) {
    return this.service.reject(id, dto, user);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.cancel(id, user);
  }
}

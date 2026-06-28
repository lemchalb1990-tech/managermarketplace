import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { DispatchService } from './dispatch.service';
import {
  CreateRouteDto, UpdateRouteDto, AddStopDto,
  ReorderStopsDto, DeliverStopDto, FindRoutesDto,
} from './dto/dispatch.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('dispatch')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.DESPACHADOR)
export class DispatchController {
  constructor(private service: DispatchService) {}

  @Get('routes')
  findAll(@CurrentUser() user: any, @Query() query: FindRoutesDto) {
    return this.service.findAll(user, query);
  }

  @Get('routes/available-orders')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  getAvailableOrders(@CurrentUser() user: any) {
    return this.service.getAvailableOrders(user);
  }

  @Post('routes')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  create(@Body() dto: CreateRouteDto, @CurrentUser() user: any) {
    return this.service.create(dto, user);
  }

  @Get('routes/:id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.findOne(id, user);
  }

  @Patch('routes/:id')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  update(@Param('id') id: string, @Body() dto: UpdateRouteDto, @CurrentUser() user: any) {
    return this.service.update(id, dto, user);
  }

  @Delete('routes/:id')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.remove(id, user);
  }

  @Patch('routes/:id/start')
  startRoute(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.startRoute(id, user);
  }

  @Patch('routes/:id/cancel')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  cancelRoute(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.cancelRoute(id, user);
  }

  @Patch('routes/:id/optimize')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  optimizeRoute(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.optimizeRoute(id, user);
  }

  @Post('routes/:id/stops')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  addStop(@Param('id') id: string, @Body() dto: AddStopDto, @CurrentUser() user: any) {
    return this.service.addStop(id, dto, user);
  }

  @Patch('routes/:id/stops/reorder')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  reorderStops(@Param('id') id: string, @Body() dto: ReorderStopsDto, @CurrentUser() user: any) {
    return this.service.reorderStops(id, dto, user);
  }

  @Patch('routes/:id/stops/:stopId/deliver')
  deliverStop(
    @Param('id') id: string,
    @Param('stopId') stopId: string,
    @Body() dto: DeliverStopDto,
    @CurrentUser() user: any,
  ) {
    return this.service.deliverStop(id, stopId, dto, user);
  }

  @Delete('routes/:id/stops/:stopId')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  removeStop(
    @Param('id') id: string,
    @Param('stopId') stopId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.removeStop(id, stopId, user);
  }
}

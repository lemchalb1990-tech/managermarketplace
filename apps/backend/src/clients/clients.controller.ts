import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ClientsService } from './clients.service';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('clients')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR, Role.ORDER_MANAGER)
export class ClientsController {
  constructor(private service: ClientsService) {}

  @Get()
  findAll(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.findAll(user, companyId);
  }

  @Get(':id/debt')
  getDebt(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.getDebt(id, user);
  }

  @Get(':id/history')
  getHistory(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.getHistory(id, user);
  }

  @Post()
  create(@Body() dto: CreateClientDto, @CurrentUser() user: any) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.ORDER_MANAGER)
  update(@Param('id') id: string, @Body() dto: UpdateClientDto, @CurrentUser() user: any) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.remove(id, user);
  }
}

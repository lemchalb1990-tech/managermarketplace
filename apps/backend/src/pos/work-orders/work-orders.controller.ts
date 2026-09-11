import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { WorkOrdersService } from './work-orders.service';
import { CreateWorkOrderDto, UpdateWorkOrderDto, ConvertWorkOrderDto } from './work-orders.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('pos/work-orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR)
export class WorkOrdersController {
  constructor(private service: WorkOrdersService) {}

  @Post()
  create(@Body() dto: CreateWorkOrderDto, @CurrentUser() user: any) {
    return this.service.create(dto, user);
  }

  @Get()
  list(
    @CurrentUser() user: any,
    @Query('companyId') companyId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('search') search?: string,
  ) {
    return this.service.findAllPaginated(user, { companyId, status, page, search });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.findOne(id, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateWorkOrderDto, @CurrentUser() user: any) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.reject(id, user);
  }

  @Delete(':id')
  cancel(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.cancel(id, user);
  }

  @Post(':id/convert')
  convert(@Param('id') id: string, @Body() dto: ConvertWorkOrderDto, @CurrentUser() user: any) {
    return this.service.convertToSale(id, dto, user);
  }
}

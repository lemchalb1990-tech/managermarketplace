import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PurchasesService } from './purchases.service';
import { CreatePurchaseDto } from './dto/purchase.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('purchases')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
export class PurchasesController {
  constructor(private service: PurchasesService) {}

  @Get()
  findAll(@CurrentUser() user: any, @Query('companyId') companyId?: string, @Query('page') page?: string) {
    return this.service.findAllPaginated(user, { companyId, page });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.findOne(id, user);
  }

  @Post()
  create(@Body() dto: CreatePurchaseDto, @CurrentUser() user: any) {
    return this.service.create(dto, user);
  }
}

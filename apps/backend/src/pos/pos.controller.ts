import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { Role, SaleChannel } from '@prisma/client';
import { PosService } from './pos.service';
import { CreateSaleDto, StockAdjustDto } from './dto/pos.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('pos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PosController {
  constructor(private service: PosService) {}

  @Post('sales')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  createSale(@Body() dto: CreateSaleDto, @CurrentUser() user: any) {
    return this.service.createSale(dto, user);
  }

  @Get('sales')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  listSales(
    @CurrentUser() user: any,
    @Query('companyId') companyId?: string,
    @Query('channel') channel?: SaleChannel,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
  ) {
    return this.service.listSales(user, { companyId, channel, from, to, page });
  }

  @Get('sales/summary')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  getDailySummary(
    @CurrentUser() user: any,
    @Query('companyId') companyId?: string,
    @Query('date') date?: string,
  ) {
    return this.service.getDailySummary(user, companyId, date);
  }

  @Get('stock/movements/:productId')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  getMovements(@Param('productId') productId: string, @CurrentUser() user: any) {
    return this.service.getStockMovements(productId, user);
  }

  @Post('stock/adjust')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  adjustStock(@Body() dto: StockAdjustDto, @CurrentUser() user: any) {
    return this.service.adjustStock(dto, user);
  }
}

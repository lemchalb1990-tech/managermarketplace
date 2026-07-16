import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, Res } from '@nestjs/common';
import type { Response } from 'express';
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
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR)
  createSale(@Body() dto: CreateSaleDto, @CurrentUser() user: any) {
    return this.service.createSale(dto, user);
  }

  @Get('sales')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR)
  listSales(
    @CurrentUser() user: any,
    @Query('companyId') companyId?: string,
    @Query('channel') channel?: SaleChannel,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('search') search?: string,
  ) {
    return this.service.listSales(user, { companyId, channel, from, to, page, search });
  }

  @Delete('sales/:id')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  deleteSale(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.deleteSale(id, user);
  }

  @Get('sales/export')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR)
  async exportSales(
    @CurrentUser() user: any,
    @Res() res: Response,
    @Query('companyId') companyId?: string,
    @Query('channel') channel?: SaleChannel,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const csv = await this.service.exportSalesCsv(user, { companyId, channel, from, to });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ventas.csv"');
    res.send(Buffer.from('﻿' + csv, 'utf8'));
  }

  @Get('sales/summary')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR)
  getDailySummary(
    @CurrentUser() user: any,
    @Query('companyId') companyId?: string,
    @Query('date') date?: string,
  ) {
    return this.service.getDailySummary(user, companyId, date);
  }

  @Get('sales/weekly')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR)
  getWeeklySales(
    @CurrentUser() user: any,
    @Query('companyId') companyId?: string,
    @Query('days') days?: string,
  ) {
    return this.service.getWeeklySales(user, companyId, Number(days) || 7);
  }

  @Get('stock/movements/:productId')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR)
  getMovements(@Param('productId') productId: string, @CurrentUser() user: any) {
    return this.service.getStockMovements(productId, user);
  }

  @Post('stock/adjust')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  adjustStock(@Body() dto: StockAdjustDto, @CurrentUser() user: any) {
    return this.service.adjustStock(dto, user);
  }
}

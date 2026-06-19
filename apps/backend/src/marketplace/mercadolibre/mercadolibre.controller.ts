import { Controller, Get, Post, Query, Body, Param, UseGuards, Res } from '@nestjs/common';
import { Response } from 'express';
import { Role } from '@prisma/client';
import { MercadolibreService } from './mercadolibre.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('marketplace/ml')
export class MercadolibreController {
  constructor(private service: MercadolibreService) {}

  @Get('connect')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  getAuthUrl(@Query('companyId') companyId: string, @Res() res: Response) {
    const url = this.service.getAuthUrl(companyId);
    return res.redirect(url);
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('name') name: string,
    @Res() res: Response,
  ) {
    await this.service.handleCallback(code, state, name || 'Conexión ML');
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/marketplace/connected`);
  }

  @Post('webhook')
  webhook(@Body() body: any) {
    return this.service.handleWebhook(body);
  }

  @Post('products/:productId/publish/:connectionId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  publish(
    @Param('productId') productId: string,
    @Param('connectionId') connectionId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.publishProduct(productId, connectionId, user);
  }

  @Post('products/:productId/sync/:connectionId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  syncStock(
    @Param('productId') productId: string,
    @Param('connectionId') connectionId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.syncStock(productId, connectionId, user);
  }
}

import {
  Controller, Get, Post, Delete, Query, Body, Param,
  UseGuards, Res, BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { MercadolibreService } from './mercadolibre.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('marketplace/ml')
export class MercadolibreController {
  constructor(private service: MercadolibreService) {}

  @Get('auth-url')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  getAuthUrl(
    @Query('name') name: string,
    @Query('companyId') companyId: string,
    @CurrentUser() user: any,
  ) {
    const cid = user.role === Role.COMPANY_ADMIN ? user.companyId : companyId;
    if (!cid) throw new BadRequestException('companyId requerido');
    return { authUrl: this.service.getAuthUrl(cid, name || 'Conexión ML') };
  }

  @Get('connections')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  getConnections(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.getConnections(user, companyId);
  }

  @Delete('connections/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  removeConnection(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.removeConnection(id, user);
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('name') name: string,
    @Res() res: Response,
  ) {
    try {
      await this.service.handleCallback(code, state, name || 'Conexión ML');
      return res.redirect(
        `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/marketplace/connected`,
      );
    } catch {
      return res.redirect(
        `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/marketplace?error=1`,
      );
    }
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

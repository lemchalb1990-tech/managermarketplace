import {
  Controller, Get, Post, Patch, Delete, Query, Body, Param,
  UseGuards, Res, BadRequestException, Logger,
} from '@nestjs/common';
import { IsString, IsOptional, IsArray } from 'class-validator';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { MercadolibreService } from './mercadolibre.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

class SaveCredentialsDto {
  @IsString() mlClientId: string;
  @IsString() mlClientSecret: string;
  @IsOptional() @IsString() companyId?: string;
}

class ConfirmImportDto {
  @IsArray() @IsString({ each: true }) externalIds: string[];
}

@Controller('ecommerce/ml')
export class MercadolibreController {
  private readonly logger = new Logger(MercadolibreController.name);

  constructor(private service: MercadolibreService) {}

  // ─── Credenciales ─────────────────────────────────────────────────────────

  @Get('settings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  getMlSettings(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.getMlSettings(user, companyId);
  }

  @Patch('credentials')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  saveCredentials(@Body() dto: SaveCredentialsDto, @CurrentUser() user: any) {
    return this.service.saveCredentials(user, dto.mlClientId, dto.mlClientSecret, dto.companyId);
  }

  // ─── OAuth ─────────────────────────────────────────────────────────────────

  @Post('auth-url')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  async getAuthUrl(
    @Body() body: { name?: string; mlClientId: string; mlClientSecret: string; companyId?: string },
    @CurrentUser() user: any,
  ) {
    const cid = user.role === Role.COMPANY_ADMIN ? user.companyId : body.companyId;
    if (!cid) throw new BadRequestException('companyId requerido');
    const authUrl = await this.service.getAuthUrl(cid, body.name || 'Conexión ML', body.mlClientId, body.mlClientSecret);
    return { authUrl };
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
        `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/ecommerce/mercadolibre/connected`,
      );
    } catch (err: any) {
      this.logger.error(`ML callback error: ${err?.message || err}`, err?.stack);
      return res.redirect(
        `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/ecommerce/mercadolibre?error=1`,
      );
    }
  }

  // ─── Categorías ────────────────────────────────────────────────────────────

  @Get('categories/search')
  @UseGuards(JwtAuthGuard)
  searchCategories(@Query('q') q: string) {
    return this.service.searchCategories(q);
  }

  @Get('categories/:id/attributes')
  @UseGuards(JwtAuthGuard)
  getCategoryAttributes(@Param('id') id: string) {
    return this.service.getCategoryAttributes(id);
  }

  // ─── Connections ───────────────────────────────────────────────────────────

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

  @Post('connections/:id/refresh')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  refreshConnection(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.refreshConnectionToken(id, user);
  }

  // ─── Importación de publicaciones existentes ────────────────────────────────

  @Get('connections/:id/import/preview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  previewImport(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.previewImport(id, user);
  }

  @Post('connections/:id/import/confirm')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  confirmImport(@Param('id') id: string, @Body() dto: ConfirmImportDto, @CurrentUser() user: any) {
    return this.service.confirmImport(id, dto.externalIds, user);
  }

  // ─── Webhook ───────────────────────────────────────────────────────────────

  @Post('webhook')
  webhook(@Body() body: any) {
    return this.service.handleWebhook(body);
  }

  // ─── Publicaciones ─────────────────────────────────────────────────────────

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

  @Patch('products/:productId/toggle/:connectionId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  toggleListing(
    @Param('productId') productId: string,
    @Param('connectionId') connectionId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.toggleListingStatus(productId, connectionId, user);
  }
}

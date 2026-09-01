import {
  Controller, Get, Post, Patch, Delete, Query, Body, Param,
  UseGuards, Res, Logger,
} from '@nestjs/common';
import { IsString, IsOptional, IsArray } from 'class-validator';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { MercadolibreService } from './mercadolibre.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { primaryFrontendUrl } from '../../common/frontend-url.util';

class SaveCredentialsDto {
  @IsString() mlClientId: string;
  @IsString() mlClientSecret: string;
  @IsOptional() @IsString() companyId?: string;
}

class CreateMlConnectionDto {
  @IsString() name: string;
  @IsString() mlClientId: string;
  @IsString() mlClientSecret: string;
  @IsOptional() @IsString() companyId?: string;
}

class ConfirmImportDto {
  @IsArray() @IsString({ each: true }) externalIds: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) unlinkIds?: string[];
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

  @Post('connections')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  createConnection(@Body() dto: CreateMlConnectionDto, @CurrentUser() user: any) {
    return this.service.createCredentialConnection(user, dto.name || 'Conexión ML', dto.mlClientId, dto.mlClientSecret, dto.companyId);
  }

  @Post('connections/:id/authorize')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  async authorize(@Param('id') id: string, @CurrentUser() user: any) {
    const authUrl = await this.service.getAuthUrlForConnection(id, user);
    return { authUrl };
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('name') name: string,
    @Res() res: Response,
  ) {
    let ok = false;
    let detail = '';
    try {
      await this.service.handleCallback(code, state, name || 'Conexión ML');
      ok = true;
    } catch (err: any) {
      this.logger.error(`ML callback error: ${err?.message || err}`, err?.stack);
      detail = err?.message || 'No se pudo completar la conexión con Mercado Libre.';
    }
    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.status(ok ? 200 : 400).send(this.renderCallbackPage(ok, detail));
  }

  private renderCallbackPage(ok: boolean, detail: string): string {
    const panelUrl = `${primaryFrontendUrl()}/dashboard/ecommerce/mercadolibre${ok ? '' : '?error=1'}`;
    const title = ok ? 'Cuenta conectada' : 'No se pudo conectar';
    const heading = ok ? '¡Cuenta conectada!' : 'No se pudo conectar';
    const message = ok
      ? 'Tu cuenta de Mercado Libre quedó vinculada correctamente. Ya puedes cerrar esta pestaña.'
      : (detail || 'Ocurrió un error al conectar con Mercado Libre. Vuelve a intentarlo desde el panel.');
    const color = ok ? '#16a34a' : '#dc2626';
    const icon = ok ? '&#10003;' : '&#33;';
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · Mercado Libre</title>
<style>
  body { margin:0; font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; background:#f8fafc; color:#0f172a; }
  .wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
  .card { background:#fff; border:1px solid #e2e8f0; border-radius:16px; padding:40px 32px; max-width:420px; width:100%; text-align:center; box-shadow:0 10px 30px rgba(15,23,42,.06); }
  .badge { width:64px; height:64px; border-radius:9999px; display:flex; align-items:center; justify-content:center; margin:0 auto 16px; font-size:32px; font-weight:700; color:#fff; background:${color}; }
  h1 { font-size:20px; margin:0 0 8px; }
  p { color:#475569; font-size:14px; line-height:1.5; margin:0 0 20px; }
  a.btn { display:inline-block; background:#2563eb; color:#fff; text-decoration:none; font-weight:600; font-size:14px; padding:10px 18px; border-radius:10px; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="badge">${icon}</div>
      <h1>${heading}</h1>
      <p>${esc(message)}</p>
      <a class="btn" href="${esc(panelUrl)}">Ir al panel de Mercado Libre</a>
    </div>
  </div>
  <script>
    // Si se abrió como popup desde el panel, avisamos y cerramos.
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ source: 'ml-oauth', ok: ${ok} }, '*');
        setTimeout(function () { window.close(); }, 1500);
      } else {
        setTimeout(function () { window.location.href = ${JSON.stringify(panelUrl)}; }, 4000);
      }
    } catch (e) {
      setTimeout(function () { window.location.href = ${JSON.stringify(panelUrl)}; }, 4000);
    }
  </script>
</body>
</html>`;
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

  // TEMPORAL: diagnóstico directo de una orden puntual (ver mercadolibre.service.ts).
  @Get('connections/:id/debug-order/:orderId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  debugOrder(@Param('id') id: string, @Param('orderId') orderId: string, @CurrentUser() user: any) {
    return this.service.debugOrder(id, orderId, user);
  }

  // ─── Importación de publicaciones existentes ────────────────────────────────

  @Get('connections/:id/import/preview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  previewImport(@Param('id') id: string, @Query('scrollId') scrollId: string, @CurrentUser() user: any) {
    return this.service.previewImport(id, user, scrollId || undefined);
  }

  @Post('connections/:id/import/confirm')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  confirmImport(@Param('id') id: string, @Body() dto: ConfirmImportDto, @CurrentUser() user: any) {
    return this.service.confirmImport(id, dto.externalIds, user, dto.unlinkIds);
  }

  // ─── Importación de ventas históricas ───────────────────────────────────────

  @Get('connections/:id/sales-import/preview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  previewSalesImport(
    @Param('id') id: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentUser() user: any,
  ) {
    return this.service.previewSalesImport(id, user, from, to);
  }

  @Post('connections/:id/sales-import/confirm')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  confirmSalesImport(@Param('id') id: string, @Body() dto: ConfirmImportDto, @CurrentUser() user: any) {
    return this.service.confirmSalesImport(id, dto.externalIds, user);
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

  @Post('products/:productId/sync-all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  syncAll(@Param('productId') productId: string, @CurrentUser() user: any) {
    return this.service.syncAllListings(productId, user);
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

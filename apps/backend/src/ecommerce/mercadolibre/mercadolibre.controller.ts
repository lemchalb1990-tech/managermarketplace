import {
  Controller, Get, Post, Patch, Delete, Query, Body, Param,
  UseGuards, Res, Logger,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, IsOptional, IsArray, IsBoolean, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { MercadolibreService, MlAuthResult } from './mercadolibre.service';
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

class PrintLabelsBulkDto {
  @IsArray() @IsString({ each: true }) orderIds: string[];
  // true = "etiqueta con detalle": cada etiqueta seguida de una página con los productos.
  @IsOptional() @IsBoolean() withDetail?: boolean;
}

class MergeDuplicateSalesDto {
  @IsString() primarySaleId: string;
  @IsString() duplicateSaleId: string;
}

class CreateMlConnectionDto {
  @IsString() name: string;
  @IsString() mlClientId: string;
  @IsString() mlClientSecret: string;
  @IsOptional() @IsString() companyId?: string;
}

class UpdateMlConnectionDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() mlClientId?: string;
  // Vacío/omitido = mantener el Client Secret actual sin cambios.
  @IsOptional() @IsString() mlClientSecret?: string;
}

class ConfirmImportDto {
  @IsArray() @IsString({ each: true }) externalIds: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) unlinkIds?: string[];
  // Solo lo usa confirmSalesImport: si viene en true, además de registrar la venta crea
  // la Orden de despacho real (aparece en bodega, admite etiqueta de ML) — pensado para
  // recuperar una venta real que el webhook no alcanzó a procesar en su momento, no para
  // reimportar historial ya despachado. Nunca descuenta stock, sin importar este valor.
  @IsOptional() createDispatchOrder?: boolean;
}

class SaleTermDto {
  @IsString() id: string;
  @IsOptional() @IsString() value_id?: string;
  @IsOptional() @IsString() value_name?: string;
}

class PublishOptionsDto {
  // Garantía u otras condiciones de venta que exija la categoría (ver getSaleTerms).
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaleTermDto)
  saleTerms?: SaleTermDto[];
}

class AnswerQuestionDto {
  @IsString() text: string;
}

class ClaimMessageDto {
  @IsString() text: string;
}

class ClaimActionDto {
  @IsString() action: string;
  @IsOptional() extra?: Record<string, any>;
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
    @Query('error') oauthError: string,
    @Query('error_description') oauthErrorDescription: string,
    @Res() res: Response,
  ) {
    let ok = false;
    let detail = '';
    let result: MlAuthResult | null = null;
    try {
      if (oauthError) {
        throw new Error(
          oauthError === 'access_denied'
            ? 'La autorización se canceló en Mercado Libre (no se aceptaron los permisos). Vuelve a presionar "Autorizar" en el panel y acepta los permisos.'
            : `Mercado Libre devolvió un error al autorizar: ${oauthErrorDescription || oauthError}. Vuelve a presionar "Autorizar" en el panel.`,
        );
      }
      result = await this.service.handleCallback(code, state, name || 'Conexión ML');
      ok = true;
    } catch (err: any) {
      this.logger.error(`ML callback error: ${err?.message || err}`, err?.stack);
      detail = err?.message || 'No se pudo completar la conexión con Mercado Libre.';
    }
    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.status(ok ? 200 : 400).send(this.renderCallbackPage(ok, detail, result));
  }

  // ─── Etiqueta de envío ───────────────────────────────────────────────────────

  @Post('orders/:orderId/refresh')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  refreshOrderFromMl(@Param('orderId') orderId: string, @CurrentUser() user: any) {
    return this.service.refreshOrderFromMl(orderId, user);
  }

  @Get('orders/:orderId/label')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  async printShippingLabel(
    @Param('orderId') orderId: string,
    @Query('detail') detail: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const buffer = await this.service.printShippingLabel(orderId, user, detail === '1' || detail === 'true');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="etiqueta-envio.pdf"');
    res.send(buffer);
  }

  // Impresión masiva desde la lista de Órdenes. Devuelve JSON (no un solo binario) porque
  // puede haber más de un PDF cuando las órdenes seleccionadas son de distintas conexiones
  // de Mercado Libre — el frontend abre uno por conexión.
  @Post('orders/print-labels-bulk')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  async printShippingLabelsBulk(@Body() dto: PrintLabelsBulkDto, @CurrentUser() user: any) {
    const { pdfs, printed, errors } = await this.service.printShippingLabelsBulk(dto.orderIds, user, !!dto.withDetail);
    return {
      pdfs: pdfs.map((p) => ({ connectionName: p.connectionName, base64: p.buffer.toString('base64') })),
      printed,
      errors,
    };
  }

  // Recuperación manual: fusiona dos ventas de ML que ML dividió en dos "orders" para un
  // mismo carrito/envío sin informar pack_id (se detectan comparando shipping.id). Ver
  // MercadolibreService.mergeDuplicateSales.
  @Post('sales/merge-duplicate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  mergeDuplicateSales(@Body() dto: MergeDuplicateSalesDto, @CurrentUser() user: any) {
    return this.service.mergeDuplicateSales(dto.primarySaleId, dto.duplicateSaleId, user);
  }

  private renderCallbackPage(ok: boolean, detail: string, result: MlAuthResult | null = null): string {
    // El resultado viaja al panel en la URL para mostrarlo allí (la ventana de autorización se
    // abre sin vínculo con el panel, así que no puede avisarle directamente).
    const params = new URLSearchParams(ok
      ? {
          mlConnected: result?.connectionName || '',
          mlAccount: result?.nickname || '',
          mlClientId: result?.clientId || '',
          mlVerified: result?.clientIdVerified ? '1' : '0',
        }
      : { mlError: detail || 'No se pudo completar la conexión con Mercado Libre.' });
    const panelUrl = `${primaryFrontendUrl()}/dashboard/ecommerce/mercadolibre?${params}`;
    const title = ok ? 'Cuenta conectada' : 'No se pudo conectar';
    const heading = ok ? '¡Cuenta conectada!' : 'No se pudo conectar';
    const message = ok
      ? `La tienda "${result?.connectionName || ''}" quedó vinculada con la cuenta de Mercado Libre ` +
        `${result?.nickname ? `"${result.nickname}"` : ''}` +
        `${result?.clientId ? ` (Client ID ${result.clientId}${result.clientIdVerified ? ', verificado' : ''})` : ''}.`
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
      <a class="btn" href="${esc(panelUrl)}">${ok ? 'Ir al panel de Mercado Libre' : 'Volver al panel para reintentar'}</a>
    </div>
  </div>
  <script>
    // Éxito: vuelve solo al panel. Error: la página queda abierta para poder leer el detalle;
    // el botón lleva al panel con el mismo mensaje para reintentar desde ahí.
    if (${ok}) setTimeout(function () { window.location.href = ${JSON.stringify(panelUrl)}; }, 4000);
  </script>
</body>
</html>`;
  }

  // ─── Categorías ────────────────────────────────────────────────────────────

  @Get('categories/search')
  @UseGuards(JwtAuthGuard)
  searchCategories(@Query('q') q: string, @Query('type') type?: string) {
    return this.service.searchCategories(q, type);
  }

  // Navegar el árbol de categorías paso a paso (sin id = raíces).
  @Get('categories/browse')
  @UseGuards(JwtAuthGuard)
  browseCategories(@Query('id') id?: string) {
    return this.service.browseCategories(id);
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

  // Editar credenciales de una conexión ya creada: solo Super Admin (son credenciales
  // sensibles compartidas con la cuenta real de Mercado Libre de la empresa).
  @Patch('connections/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  updateConnection(@Param('id') id: string, @Body() dto: UpdateMlConnectionDto, @CurrentUser() user: any) {
    return this.service.updateCredentialConnection(id, dto, user);
  }

  @Post('connections/:id/refresh')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  refreshConnection(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.refreshConnectionToken(id, user);
  }

  // TEMPORAL: diagnóstico directo de una orden puntual (ver mercadolibre.service.ts).
  // Tiendas de ML de la empresa (incluidas las desconectadas) para reasignar datos entre ellas.
  @Get('connections-for-transfer')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  listConnectionsForTransfer(@Query('companyId') companyId: string, @CurrentUser() user: any) {
    return this.service.listMlConnectionsForTransfer(user, companyId || undefined);
  }

  // Pasa a la tienda correcta lo que se sincronizó con la cuenta equivocada (sin apply: solo informa).
  @Post('connections/:fromId/transfer-to/:toId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  transferConnectionData(
    @Param('fromId') fromId: string, @Param('toId') toId: string,
    @Body() body: { apply?: boolean }, @CurrentUser() user: any,
  ) {
    return this.service.transferConnectionData(fromId, toId, user, body?.apply === true);
  }

  // Vuelve a leer la venta en Mercado Libre y sobrescribe sus datos y los de su orden.
  @Post('sales/:saleId/reimport')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  reimportSale(@Param('saleId') saleId: string, @CurrentUser() user: any) {
    return this.service.reimportSaleFromMl(saleId, user);
  }

  // Revisa (y con apply=true corrige) montos de ventas de carrito (envío restado una vez por
  // orden del pack) y completa la comisión por producto. Sin apply solo informa.
  @Post('sales/recalculate-pack-amounts')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  recalculatePackAmounts(@Body() body: { companyId?: string; apply?: boolean }, @CurrentUser() user: any) {
    return this.service.recalculatePackAmounts(user, { companyId: body?.companyId, apply: body?.apply === true });
  }

  // Revisa (y con apply=true corrige) ventas de pack con productos duplicados por el bug de
  // fusión repetida. Sin apply solo informa qué cambiaría.
  @Post('sales/repair-pack-duplicates')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  repairPackDuplicates(
    @Body() body: { companyId?: string; apply?: boolean; saleIds?: string[] },
    @CurrentUser() user: any,
  ) {
    return this.service.repairPackDuplicates(user, {
      companyId: body?.companyId, apply: body?.apply === true, saleIds: Array.isArray(body?.saleIds) ? body.saleIds : undefined,
    });
  }

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

  // El modal de importación manda una orden por request (para mostrar el % de avance real,
  // ver SalesImportModal.tsx) — con lotes grandes eso supera fácil el límite global de
  // ThrottlerModule (100 requests/min) y el import se corta a mitad de camino con
  // "ThrottlerException: Too Many Requests". Este endpoint necesita su propio límite, más alto.
  @Post('connections/:id/sales-import/confirm')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  @Throttle({ default: { limit: 1000, ttl: 60000 } })
  confirmSalesImport(@Param('id') id: string, @Body() dto: ConfirmImportDto, @CurrentUser() user: any) {
    return this.service.confirmSalesImport(id, dto.externalIds, user, dto.createDispatchOrder);
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
    @Body() dto?: PublishOptionsDto,
  ) {
    return this.service.publishProduct(productId, connectionId, user, dto?.saleTerms);
  }

  // Condiciones de venta (p.ej. garantía) que exige la categoría, para pedirlas antes de
  // publicar en vez de que Mercado Libre las rechace con un error críptico.
  @Get('connections/:connectionId/categories/:categoryId/sale-terms')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  getSaleTerms(
    @Param('connectionId') connectionId: string,
    @Param('categoryId') categoryId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.getSaleTerms(categoryId, connectionId, user);
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

  @Post('products/:productId/pull/:connectionId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  pullProductFromMl(
    @Param('productId') productId: string,
    @Param('connectionId') connectionId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.pullProductFromMl(productId, connectionId, user);
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

  // ─── Preguntas ─────────────────────────────────────────────────────────────

  @Get('questions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR)
  listQuestions(@CurrentUser() user: any, @Query('status') status?: string, @Query('companyId') companyId?: string) {
    return this.service.listQuestions(user, status, companyId);
  }

  @Post('questions/:externalId/answer')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR)
  answerQuestion(@Param('externalId') externalId: string, @Body() dto: AnswerQuestionDto, @CurrentUser() user: any) {
    return this.service.answerQuestion(externalId, dto.text, user);
  }

  @Post('connections/:id/questions/sync')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  syncQuestions(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.syncQuestions(id, user);
  }

  // ─── Reclamos y devoluciones ─────────────────────────────────────────────────

  @Get('claims')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR)
  listClaims(@CurrentUser() user: any, @Query('status') status?: string, @Query('companyId') companyId?: string) {
    return this.service.listClaims(user, status, companyId);
  }

  @Get('claims/:externalId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR)
  getClaimDetail(@Param('externalId') externalId: string, @CurrentUser() user: any) {
    return this.service.getClaimDetail(externalId, user);
  }

  @Post('claims/:externalId/messages')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR)
  sendClaimMessage(@Param('externalId') externalId: string, @Body() dto: ClaimMessageDto, @CurrentUser() user: any) {
    return this.service.sendClaimMessage(externalId, dto.text, user);
  }

  @Post('claims/:externalId/actions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR)
  takeClaimAction(@Param('externalId') externalId: string, @Body() dto: ClaimActionDto, @CurrentUser() user: any) {
    return this.service.takeClaimAction(externalId, dto.action, user, dto.extra);
  }

  @Post('connections/:id/claims/sync')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  syncClaims(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.syncClaims(id, user);
  }

  // ─── Órdenes ───────────────────────────────────────────────────────────────────

  @Post('connections/:id/orders/sync')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  syncOrderStatuses(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.syncActiveOrderStatuses(id, user);
  }

  // ─── Calificaciones ──────────────────────────────────────────────────────────

  @Get('connections/:id/reputation')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR)
  getSellerReputation(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.getSellerReputation(id, user);
  }

  @Get('feedback')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR)
  listFeedback(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.listFeedback(user, companyId);
  }

  // ─── Notificaciones ──────────────────────────────────────────────────────────

  @Get('notifications')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR)
  getRecentActivity(@CurrentUser() user: any, @Query('since') since: string, @Query('companyId') companyId?: string) {
    return this.service.getRecentActivity(user, since, companyId);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { PaymentProvider, Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateSaleDto } from '../pos/dto/pos.dto';
import { primaryFrontendUrl } from '../common/frontend-url.util';
import { PaymentsService } from './payments.service';

class CreatePaymentRequestBody extends CreateSaleDto {
  @IsEnum(PaymentProvider) provider: PaymentProvider;
  @IsOptional() @IsBoolean() remote?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(168) expiresInHours?: number;
}

class WorkOrderLinkBody {
  @IsEnum(PaymentProvider) provider: PaymentProvider;
  @IsOptional() @IsInt() @Min(1) @Max(168) expiresInHours?: number;
}

class SendEmailBody {
  @IsString() to: string;
}

const POS_ROLES = [Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER, Role.VENDEDOR];
const ADMIN_ROLES = [Role.SUPER_ADMIN, Role.COMPANY_ADMIN];

// Cobros en línea de la venta directa (Flow, Mercado Pago): conexiones de la empresa (admin),
// cobros con link/QR desde el punto de venta y avisos públicos de las pasarelas.
@Controller('payments')
export class PaymentsController {
  constructor(private service: PaymentsService) {}

  // ── Conexiones ──

  @Get('connections')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_ROLES)
  connections(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.listConnections(user, companyId);
  }

  @Put('connections/:provider')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_ROLES)
  upsert(@CurrentUser() user: any, @Param('provider') provider: string, @Body() body: any) {
    return this.service.upsertConnection(user, provider, body || {});
  }

  @Delete('connections/:provider')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_ROLES)
  remove(@CurrentUser() user: any, @Param('provider') provider: string, @Query('companyId') companyId?: string) {
    return this.service.removeConnection(user, provider, companyId);
  }

  @Post('connections/:provider/test')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_ROLES)
  test(@CurrentUser() user: any, @Param('provider') provider: string, @Query('companyId') companyId?: string) {
    return this.service.testConnection(user, provider, companyId);
  }

  @Get('available')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...POS_ROLES)
  available(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.available(user, companyId);
  }

  // ── Cobros ──

  @Post('requests')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...POS_ROLES)
  create(@CurrentUser() user: any, @Body() body: CreatePaymentRequestBody) {
    return this.service.createRequest(user, body);
  }

  // Link de pago de una orden de trabajo (se convierte en venta al pagarse).
  @Post('work-orders/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...POS_ROLES)
  createForWorkOrder(@CurrentUser() user: any, @Param('id') id: string, @Body() body: WorkOrderLinkBody) {
    return this.service.createForWorkOrder(user, id, body);
  }

  // Link para cobrar el saldo de una venta con abono (fabricación).
  @Post('sales/:saleId/balance')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...POS_ROLES)
  createForSaleBalance(@CurrentUser() user: any, @Param('saleId') saleId: string, @Body() body: WorkOrderLinkBody) {
    return this.service.createForSaleBalance(user, saleId, body);
  }

  @Get('requests')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...POS_ROLES)
  list(@CurrentUser() user: any, @Query('companyId') companyId?: string, @Query('status') status?: string, @Query('page') page?: string, @Query('workOrderId') workOrderId?: string) {
    return this.service.listRequests(user, { companyId, status, page, workOrderId });
  }

  @Get('requests/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...POS_ROLES)
  get(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.getRequest(user, id);
  }

  @Post('requests/:id/cancel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...POS_ROLES)
  cancel(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.cancelRequest(user, id);
  }

  @Post('requests/:id/send-email')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...POS_ROLES)
  sendEmail(@CurrentUser() user: any, @Param('id') id: string, @Body() body: SendEmailBody) {
    return this.service.sendEmail(user, id, body.to);
  }

  @Post('requests/:id/retry-sale')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  retrySale(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.retrySale(user, id);
  }

  @Post('requests/:id/dismiss')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
  dismiss(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.dismiss(user, id);
  }

  // ── Públicos: página de vuelta del cliente y avisos de las pasarelas ──
  // Los avisos no se creen tal cual: solo disparan una consulta a la API con las credenciales
  // de la empresa, que es la que confirma el pago.

  @Get('public/:id')
  publicStatus(@Param('id') id: string) {
    return this.service.publicStatus(id);
  }

  @Post('webhook/flow/:id')
  @HttpCode(200)
  flowWebhook(@Param('id') id: string) {
    return this.service.webhook(PaymentProvider.FLOW, id);
  }

  // Flow devuelve al cliente con un POST del navegador: se revisa el pago y se redirige a la página.
  @Post('flow/return/:id')
  async flowReturn(@Param('id') id: string, @Res() res: Response) {
    await this.service.webhook(PaymentProvider.FLOW, id);
    res.redirect(303, `${primaryFrontendUrl().replace(/\/+$/, '')}/pago/${encodeURIComponent(id)}`);
  }

  @Post('webhook/mercadopago/:id')
  @HttpCode(200)
  mpWebhook(@Param('id') id: string) {
    return this.service.webhook(PaymentProvider.MERCADO_PAGO, id);
  }

  @Get('webhook/mercadopago/:id')
  mpWebhookGet(@Param('id') id: string) {
    return this.service.webhook(PaymentProvider.MERCADO_PAGO, id);
  }
}

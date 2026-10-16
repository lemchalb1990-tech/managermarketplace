import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RecurringService } from './recurring.service';

// Cobranza recurrente (módulo «cobranza»): suscripciones por cliente, cuotas, pagos y avisos.
// El acceso lo valida el servicio (módulo de la empresa + permisos cobranza / cobranza.manage).
@Controller('recurring')
@UseGuards(JwtAuthGuard)
export class RecurringController {
  constructor(private service: RecurringService) {}

  @Get('summary')
  summary(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.summary(user, companyId);
  }

  @Get('subscriptions')
  subscriptions(@CurrentUser() user: any, @Query() q: any) {
    return this.service.listSubscriptions(user, q || {});
  }

  @Get('subscriptions/:id')
  subscription(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.getSubscription(user, id);
  }

  @Post('subscriptions')
  create(@CurrentUser() user: any, @Body() body: any) {
    return this.service.createSubscription(user, body || {});
  }

  @Patch('subscriptions/:id')
  update(@CurrentUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.service.updateSubscription(user, id, body || {});
  }

  @Post('subscriptions/:id/status')
  setStatus(@CurrentUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.service.setStatus(user, id, body?.status);
  }

  @Post('subscriptions/:id/generate')
  generate(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.generateNext(user, id);
  }

  @Get('charges')
  charges(@CurrentUser() user: any, @Query() q: any) {
    return this.service.listCharges(user, q || {});
  }

  @Post('charges/:id/pay')
  pay(@CurrentUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.service.payCharge(user, id, body || {});
  }

  @Post('charges/:id/cancel')
  cancel(@CurrentUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.service.cancelCharge(user, id, body?.reason);
  }

  @Post('charges/:id/remind')
  remind(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.sendReminder(user, id);
  }

  @Post('charges/:id/link')
  link(@CurrentUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.service.paymentLink(user, id, body?.provider);
  }

  @Post('charges/:id/retry')
  retry(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.retryDocuments(user, id);
  }

  @Get('clients/:clientId/statement')
  statement(@CurrentUser() user: any, @Param('clientId') clientId: string, @Query('companyId') companyId?: string) {
    return this.service.clientStatement(user, clientId, companyId);
  }
}

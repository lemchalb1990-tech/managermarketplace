import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { MlPromotionsService } from './ml-promotions.service';

// Promociones de Mercado Libre (permiso ml.promociones). El webhook de ML entra por
// MercadolibreController y se deriva a MlPromotionsService.handleWebhook.
@Controller('ecommerce/ml/promotions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('ml.promociones')
export class MlPromotionsController {
  constructor(private service: MlPromotionsService) {}

  @Get('summary')
  summary(@CurrentUser() user: any, @Query() q: any) {
    return this.service.summary(user, q || {});
  }

  @Post('sync')
  sync(@CurrentUser() user: any, @Body() body: { connectionId?: string; companyId?: string }) {
    return this.service.syncNow(user, body?.connectionId, body?.companyId);
  }

  @Get('campaigns')
  campaigns(@CurrentUser() user: any, @Query() q: any) {
    return this.service.campaigns(user, q || {});
  }

  @Post('campaigns')
  createCampaign(@CurrentUser() user: any, @Body() body: any) {
    return this.service.createCampaign(user, body || {});
  }

  @Delete('campaigns/:id')
  deleteCampaign(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.deleteCampaign(user, id);
  }

  @Get('items')
  items(@CurrentUser() user: any, @Query() q: any) {
    return this.service.items(user, q || {});
  }

  @Get('active')
  active(@CurrentUser() user: any, @Query() q: any) {
    return this.service.active(user, q || {});
  }

  @Get('products/:productId')
  forProduct(@CurrentUser() user: any, @Param('productId') productId: string) {
    return this.service.forProduct(user, productId);
  }

  @Post('products/active')
  activeByProducts(@CurrentUser() user: any, @Body() body: { productIds: string[] }) {
    return this.service.activeByProducts(user, Array.isArray(body?.productIds) ? body.productIds.map(String) : []);
  }

  @Post('preview')
  preview(@CurrentUser() user: any, @Body() body: any) {
    return this.service.preview(user, body || {});
  }

  @Post('apply')
  apply(@CurrentUser() user: any, @Body() body: any) {
    return this.service.applyMany(user, body || {});
  }

  @Post('remove')
  remove(@CurrentUser() user: any, @Body() body: any) {
    return this.service.remove(user, body || {});
  }

  @Get('jobs')
  jobs(@CurrentUser() user: any, @Query() q: any) {
    return this.service.jobs(user, q || {});
  }

  @Get('jobs/:id')
  job(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.job(user, id);
  }

  @Get('rules')
  rules(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.listRules(user, companyId);
  }

  @Post('rules')
  createRule(@CurrentUser() user: any, @Body() body: any) {
    return this.service.createRule(user, body || {});
  }

  @Patch('rules/:id')
  updateRule(@CurrentUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.service.updateRule(user, id, body || {});
  }

  @Delete('rules/:id')
  deleteRule(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.deleteRule(user, id);
  }

  @Get('suggestions')
  suggestions(@CurrentUser() user: any, @Query() q: any) {
    return this.service.suggestions(user, q || {});
  }

  @Post('suggestions/apply')
  applySuggestions(@CurrentUser() user: any, @Body() body: { ids: string[] }) {
    return this.service.applySuggestions(user, body?.ids || []);
  }

  @Post('suggestions/dismiss')
  dismissSuggestions(@CurrentUser() user: any, @Body() body: { ids: string[] }) {
    return this.service.dismissSuggestions(user, body?.ids || []);
  }
}

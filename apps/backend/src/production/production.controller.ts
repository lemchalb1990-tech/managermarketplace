import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ProductionConfigService } from './production-config.service';
import { PRODUCTION_ROLES, ProductionService } from './production.service';

const CONFIG_ROLES = [Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER];

// Fabricación (módulo «produccion»): órdenes de fabricación, procesos, áreas y materiales.
@Controller('production')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...PRODUCTION_ROLES)
export class ProductionController {
  constructor(private service: ProductionService, private config: ProductionConfigService) {}

  // ── Configuración ──

  @Get('settings')
  settings(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.config.getSettings(user, companyId);
  }

  @Patch('settings')
  @Roles(...CONFIG_ROLES)
  updateSettings(@CurrentUser() user: any, @Body() body: any) {
    return this.config.updateSettings(user, body || {});
  }

  @Get('areas')
  areas(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.config.listAreas(user, companyId);
  }

  @Post('areas')
  @Roles(...CONFIG_ROLES)
  saveArea(@CurrentUser() user: any, @Body() body: any) {
    return this.config.saveArea(user, body || {});
  }

  @Delete('areas/:id')
  @Roles(...CONFIG_ROLES)
  deleteArea(@CurrentUser() user: any, @Param('id') id: string) {
    return this.config.deleteArea(user, id);
  }

  @Get('processes')
  processes(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.config.listProcesses(user, companyId);
  }

  @Post('processes')
  @Roles(...CONFIG_ROLES)
  saveProcess(@CurrentUser() user: any, @Body() body: any) {
    return this.config.saveProcess(user, body || {});
  }

  @Delete('processes/:id')
  @Roles(...CONFIG_ROLES)
  deleteProcess(@CurrentUser() user: any, @Param('id') id: string) {
    return this.config.deleteProcess(user, id);
  }

  @Get('products/:productId/materials')
  materials(@CurrentUser() user: any, @Param('productId') productId: string) {
    return this.config.getMaterials(user, productId);
  }

  @Put('products/:productId/materials')
  @Roles(...CONFIG_ROLES)
  setMaterials(@CurrentUser() user: any, @Param('productId') productId: string, @Body() body: any) {
    return this.config.setMaterials(user, productId, body?.items || []);
  }

  // ── Órdenes ──

  @Get('orders')
  list(@CurrentUser() user: any, @Query() q: any) {
    return this.service.list(user, q || {});
  }

  @Get('board')
  board(@CurrentUser() user: any, @Query() q: any) {
    return this.service.board(user, q || {});
  }

  @Get('tasks')
  tasks(@CurrentUser() user: any, @Query() q: any) {
    return this.service.myTasks(user, q || {});
  }

  @Get('calendar')
  calendar(@CurrentUser() user: any, @Query() q: any) {
    return this.service.calendar(user, q || {});
  }

  @Get('shortages')
  shortages(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.shortages(user, companyId);
  }

  @Get('sales/:saleId')
  forSale(@CurrentUser() user: any, @Param('saleId') saleId: string) {
    return this.service.forSale(user, saleId);
  }

  @Post('orders')
  create(@CurrentUser() user: any, @Body() body: any) {
    return this.service.create(user, body || {});
  }

  @Get('orders/:id')
  get(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.get(user, id);
  }

  @Patch('orders/:id')
  update(@CurrentUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.service.update(user, id, body || {});
  }

  @Post('orders/:id/complete')
  complete(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.complete(user, id);
  }

  @Post('orders/:id/cancel')
  cancel(@CurrentUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.service.cancel(user, id, body?.reason);
  }

  @Post('orders/:id/hold')
  hold(@CurrentUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.service.hold(user, id, body?.reason);
  }

  @Post('orders/:id/resume')
  resume(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.resume(user, id);
  }

  @Post('orders/:id/warranty')
  warranty(@CurrentUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.service.reopenWarranty(user, id, body?.reason);
  }

  @Post('orders/:id/notes')
  note(@CurrentUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.service.addNote(user, id, body?.message, !!body?.customerVisible);
  }

  @Post('orders/:id/stages/:stageId/start')
  startStage(@CurrentUser() user: any, @Param('id') id: string, @Param('stageId') stageId: string) {
    return this.service.startStage(user, id, stageId);
  }

  @Post('orders/:id/stages/:stageId/complete')
  completeStage(@CurrentUser() user: any, @Param('id') id: string, @Param('stageId') stageId: string) {
    return this.service.completeStage(user, id, stageId);
  }

  @Post('orders/:id/stages/:stageId/skip')
  skipStage(@CurrentUser() user: any, @Param('id') id: string, @Param('stageId') stageId: string) {
    return this.service.skipStage(user, id, stageId);
  }

  @Post('orders/:id/stages/:stageId/reopen')
  reopenStage(@CurrentUser() user: any, @Param('id') id: string, @Param('stageId') stageId: string) {
    return this.service.reopenStage(user, id, stageId);
  }

  @Post('orders/:id/stages/:stageId/assign')
  assignStage(@CurrentUser() user: any, @Param('id') id: string, @Param('stageId') stageId: string, @Body() body: any) {
    return this.service.assignStage(user, id, stageId, body?.userId || null);
  }

  @Patch('orders/:id/stages/:stageId')
  updateStage(@CurrentUser() user: any, @Param('id') id: string, @Param('stageId') stageId: string, @Body() body: any) {
    return this.service.updateStage(user, id, stageId, body || {});
  }

  @Post('orders/:id/stages/:stageId/approval')
  approval(@CurrentUser() user: any, @Param('id') id: string, @Param('stageId') stageId: string, @Body() body: any) {
    return this.service.recordApproval(user, id, stageId, !!body?.approved, body?.note);
  }

  @Post('orders/:id/materials/reserve')
  reserve(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.reserveMaterials(user, id);
  }

  @Post('orders/:id/materials/consume')
  consume(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.consumeMaterialsNow(user, id);
  }

  @Post('orders/:id/materials')
  setMaterial(@CurrentUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.service.setMaterial(user, id, body || {});
  }

  @Delete('orders/:id/materials/:useId')
  removeMaterial(@CurrentUser() user: any, @Param('id') id: string, @Param('useId') useId: string) {
    return this.service.removeMaterial(user, id, useId);
  }

  @Post('orders/:id/time')
  addTime(@CurrentUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.service.addTime(user, id, body || {});
  }

  @Delete('orders/:id/time/:entryId')
  removeTime(@CurrentUser() user: any, @Param('id') id: string, @Param('entryId') entryId: string) {
    return this.service.removeTime(user, id, entryId);
  }

  @Post('orders/:id/attachments')
  @UseInterceptors(FileInterceptor('file'))
  addAttachment(@CurrentUser() user: any, @Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Body() body: any) {
    return this.service.addAttachment(user, id, file, body || {});
  }

  @Patch('orders/:id/attachments/:attId')
  updateAttachment(@CurrentUser() user: any, @Param('id') id: string, @Param('attId') attId: string, @Body() body: any) {
    return this.service.updateAttachment(user, id, attId, !!body?.customerVisible);
  }

  @Delete('orders/:id/attachments/:attId')
  removeAttachment(@CurrentUser() user: any, @Param('id') id: string, @Param('attId') attId: string) {
    return this.service.removeAttachment(user, id, attId);
  }

  @Post('orders/:id/payments')
  payBalance(@CurrentUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.service.registerBalancePayment(user, id, body || {});
  }
}

// Seguimiento público del cliente (sin sesión): el token del link es la llave.
@Controller('public/production')
export class PublicProductionController {
  constructor(private service: ProductionService) {}

  @Get(':token')
  view(@Param('token') token: string) {
    return this.service.publicView(token);
  }

  @Post(':token/stages/:stageId/approval')
  approval(@Param('token') token: string, @Param('stageId') stageId: string, @Body() body: any) {
    return this.service.publicApproval(token, stageId, !!body?.approved, body?.note);
  }
}

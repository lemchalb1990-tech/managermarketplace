import { Controller, Get, Post, Patch, Body, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TransferDocumentsService } from './transfer-documents.service';
import { InventoryReportsService, AvailabilityQuery, MovementsQuery } from './inventory-reports.service';
import {
  CreateTransferDocumentDto, UpdateTransferDocumentDto, ReceiveTransferDto, CancelTransferDto, InventoryAdjustDto, ReconcileDto,
} from './dto/inventory.dto';

// 'warehouses' se acepta en los reportes para que los perfiles que ya veían Bodegas sigan
// viendo el inventario sin reconfigurarlos.
@Controller('inventory')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventoryController {
  constructor(private transfers: TransferDocumentsService, private reports: InventoryReportsService) {}

  // ─── Reportes ───────────────────────────────────────────────────────────────
  @Get('availability')
  @RequirePermissions('inventory', 'warehouses')
  availability(@CurrentUser() user: any, @Query() q: AvailabilityQuery) {
    return this.reports.availability(user, q);
  }

  @Get('availability/export')
  @RequirePermissions('inventory', 'warehouses')
  async availabilityExport(@CurrentUser() user: any, @Query() q: AvailabilityQuery, @Res() res: Response) {
    const csv = await this.reports.availabilityCsv(user, q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="disponibilidad-por-bodega.csv"`);
    res.send(csv);
  }

  @Get('movements')
  @RequirePermissions('inventory', 'warehouses')
  movements(@CurrentUser() user: any, @Query() q: MovementsQuery) {
    return this.reports.movements(user, q);
  }

  @Get('movements/export')
  @RequirePermissions('inventory', 'warehouses')
  async movementsExport(@CurrentUser() user: any, @Query() q: MovementsQuery, @Res() res: Response) {
    const csv = await this.reports.movementsCsv(user, q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="historial-inventario.csv"`);
    res.send(csv);
  }

  @Post('adjust')
  @RequirePermissions('inventory.adjust')
  adjust(@CurrentUser() user: any, @Body() dto: InventoryAdjustDto) {
    return this.reports.adjust(user, dto);
  }

  @Get('reconciliation')
  @RequirePermissions('inventory.adjust')
  reconciliation(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.reports.reconciliation(user, companyId);
  }

  @Post('reconcile')
  @RequirePermissions('inventory.adjust')
  reconcile(@CurrentUser() user: any, @Body() dto: ReconcileDto) {
    return this.reports.reconcile(user, dto);
  }

  // ─── Traspasos ──────────────────────────────────────────────────────────────
  @Get('transfers')
  @RequirePermissions('transfers', 'transfers.receive', 'inventory', 'warehouses')
  listTransfers(@CurrentUser() user: any, @Query() q: { companyId?: string; status?: string; warehouseId?: string; search?: string; page?: string }) {
    return this.transfers.list(user, q);
  }

  @Get('transfers/:id')
  @RequirePermissions('transfers', 'transfers.receive', 'inventory', 'warehouses')
  getTransfer(@CurrentUser() user: any, @Param('id') id: string) {
    return this.transfers.get(user, id);
  }

  @Post('transfers')
  @RequirePermissions('transfers')
  createTransfer(@CurrentUser() user: any, @Body() dto: CreateTransferDocumentDto) {
    return this.transfers.create(user, dto);
  }

  @Patch('transfers/:id')
  @RequirePermissions('transfers')
  updateTransfer(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdateTransferDocumentDto) {
    return this.transfers.update(user, id, dto);
  }

  @Post('transfers/:id/dispatch')
  @RequirePermissions('transfers')
  dispatch(@CurrentUser() user: any, @Param('id') id: string) {
    return this.transfers.dispatch(user, id);
  }

  @Post('transfers/:id/receive')
  @RequirePermissions('transfers.receive', 'transfers')
  receive(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: ReceiveTransferDto) {
    return this.transfers.receive(user, id, dto);
  }

  @Post('transfers/:id/cancel')
  @RequirePermissions('transfers')
  cancel(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: CancelTransferDto) {
    return this.transfers.cancel(user, id, dto);
  }
}

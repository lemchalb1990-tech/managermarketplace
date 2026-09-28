import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { FinanceService } from './finance.service';
import {
  CopyBudgetDto, CreateFinanceAccountDto, FinanceMovementDto, SaveBudgetsDto, UpdateFinanceAccountDto,
} from './dto/finance.dto';

@Controller('finance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('finance')
export class FinanceController {
  constructor(private service: FinanceService) {}

  // ── Plan de cuentas ──
  @Get('accounts')
  listAccounts(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.listAccounts(user, companyId);
  }

  @Post('accounts')
  createAccount(@CurrentUser() user: any, @Body() dto: CreateFinanceAccountDto) {
    return this.service.createAccount(user, dto);
  }

  @Patch('accounts/:id')
  updateAccount(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdateFinanceAccountDto) {
    return this.service.updateAccount(user, id, dto);
  }

  @Delete('accounts/:id')
  deleteAccount(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.deleteAccount(user, id);
  }

  // ── Movimientos ──
  @Get('movements')
  listMovements(
    @CurrentUser() user: any,
    @Query() q: { companyId?: string; from?: string; to?: string; accountId?: string; search?: string; page?: string },
  ) {
    return this.service.listMovements(user, q);
  }

  @Post('movements')
  createMovement(@CurrentUser() user: any, @Body() dto: FinanceMovementDto) {
    return this.service.createMovement(user, dto);
  }

  @Put('movements/:id')
  updateMovement(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: FinanceMovementDto) {
    return this.service.updateMovement(user, id, dto);
  }

  @Delete('movements/:id')
  deleteMovement(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.deleteMovement(user, id);
  }

  @Get('automatic')
  automaticSummary(@CurrentUser() user: any, @Query() q: { companyId?: string; from: string; to: string }) {
    return this.service.automaticSummary(user, q);
  }

  // ── Presupuesto ──
  @Get('report')
  report(@CurrentUser() user: any, @Query('year') year: string, @Query('companyId') companyId?: string) {
    return this.service.report(user, companyId, Number(year) || new Date().getFullYear());
  }

  @Put('budgets')
  saveBudgets(@CurrentUser() user: any, @Body() dto: SaveBudgetsDto) {
    return this.service.saveBudgets(user, dto);
  }

  @Post('budgets/copy')
  copyBudget(@CurrentUser() user: any, @Body() dto: CopyBudgetDto) {
    return this.service.copyBudget(user, dto);
  }
}

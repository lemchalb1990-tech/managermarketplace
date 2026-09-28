import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { FinanceService } from './finance.service';
import { FinanceBanksService } from './finance-banks.service';
import { FinanceRecurringService } from './finance-recurring.service';
import { FinanceInsightsService } from './finance-insights.service';
import {
  BankAccountDto, CopyBudgetDto, CreateFinanceAccountDto, FinanceMovementDto, ImportStatementDto, ReconcileDto,
  RecurringDto, SaveBudgetsDto, TransferDto, UpdateFinanceAccountDto,
} from './dto/finance.dto';

@Controller('finance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('finance')
export class FinanceController {
  constructor(
    private service: FinanceService,
    private banks: FinanceBanksService,
    private recurring: FinanceRecurringService,
    private insights: FinanceInsightsService,
  ) {}

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

  @Post('movements/:id/attachment')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadAttachment(@CurrentUser() user: any, @Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    return this.service.setAttachment(user, id, file);
  }

  @Delete('movements/:id/attachment')
  removeAttachment(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.removeAttachment(user, id);
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

  // ── Resumen, alertas y flujo de caja ──
  @Get('summary')
  summary(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.insights.summary(user, companyId);
  }

  @Get('cashflow')
  cashflow(@CurrentUser() user: any, @Query('months') months?: string, @Query('companyId') companyId?: string) {
    return this.insights.cashflow(user, companyId, Math.min(24, Math.max(1, Number(months) || 6)));
  }

  // ── Bancos y caja ──
  @Get('bank-accounts')
  listBankAccounts(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.banks.listBankAccounts(user, companyId);
  }

  @Post('bank-accounts')
  createBankAccount(@CurrentUser() user: any, @Body() dto: BankAccountDto) {
    return this.banks.createBankAccount(user, dto);
  }

  @Patch('bank-accounts/:id')
  updateBankAccount(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: BankAccountDto) {
    return this.banks.updateBankAccount(user, id, dto);
  }

  @Delete('bank-accounts/:id')
  deleteBankAccount(@CurrentUser() user: any, @Param('id') id: string) {
    return this.banks.deleteBankAccount(user, id);
  }

  @Post('bank-accounts/:id/statement/parse')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  parseStatement(@CurrentUser() user: any, @Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    return this.banks.parseStatement(user, id, file);
  }

  @Post('bank-accounts/:id/statement/import')
  importStatement(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: ImportStatementDto) {
    return this.banks.importStatement(user, id, dto);
  }

  @Get('bank-accounts/:id/transactions')
  listTransactions(@CurrentUser() user: any, @Param('id') id: string, @Query() q: { status?: string; from?: string; to?: string; page?: string }) {
    return this.banks.listTransactions(user, id, q);
  }

  @Post('bank-accounts/:id/auto-match')
  autoMatch(@CurrentUser() user: any, @Param('id') id: string) {
    return this.banks.autoMatchForUser(user, id);
  }

  @Get('bank-transactions/:id/candidates')
  candidates(@CurrentUser() user: any, @Param('id') id: string) {
    return this.banks.candidates(user, id);
  }

  @Post('bank-transactions/:id/reconcile')
  reconcile(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: ReconcileDto) {
    return this.banks.reconcile(user, id, dto);
  }

  @Get('transfers')
  listTransfers(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.banks.listTransfers(user, companyId);
  }

  @Post('transfers')
  createTransfer(@CurrentUser() user: any, @Body() dto: TransferDto) {
    return this.banks.createTransfer(user, dto);
  }

  @Delete('transfers/:id')
  deleteTransfer(@CurrentUser() user: any, @Param('id') id: string) {
    return this.banks.deleteTransfer(user, id);
  }

  // ── Recurrentes ──
  @Get('recurrings')
  listRecurrings(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.recurring.list(user, companyId);
  }

  @Post('recurrings')
  createRecurring(@CurrentUser() user: any, @Body() dto: RecurringDto) {
    return this.recurring.create(user, dto);
  }

  @Put('recurrings/:id')
  updateRecurring(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: RecurringDto) {
    return this.recurring.update(user, id, dto);
  }

  @Delete('recurrings/:id')
  deleteRecurring(@CurrentUser() user: any, @Param('id') id: string) {
    return this.recurring.remove(user, id);
  }
}

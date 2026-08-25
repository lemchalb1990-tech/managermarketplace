import {
  Controller, Get, Post, Put, Patch, Delete, Body, Param, Query,
  UseGuards, UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { Role } from '@prisma/client';
import { BillingService } from './billing.service';
import {
  CreateBillingConnectionDto, IssueInvoiceDto, ListInvoicesDto,
  MarkInvoicePaidDto, UpsertBillingProfileDto,
} from './dto/billing.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

const logoStorage = diskStorage({
  destination: process.env.UPLOAD_DIR || join(process.cwd(), 'uploads'),
  filename: (_req, file, cb) => {
    cb(null, `${crypto.randomUUID()}${extname(file.originalname)}`);
  },
});

@Controller('billing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN, Role.CATALOG_MANAGER)
export class BillingController {
  constructor(private service: BillingService) {}

  // ── Connections ──────────────────────────────────────────────────

  @Get('connections')
  getConnections(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.getConnections(user, companyId);
  }

  @Post('connections')
  createConnection(@Body() dto: CreateBillingConnectionDto, @CurrentUser() user: any) {
    return this.service.createConnection(dto, user);
  }

  @Delete('connections/:id')
  deleteConnection(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.deleteConnection(id, user);
  }

  @Post('connections/:id/test')
  testConnection(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.testConnection(id, user);
  }

  // ── Invoices ──────────────────────────────────────────────────────

  @Get('invoices')
  getInvoices(@CurrentUser() user: any, @Query() query: ListInvoicesDto) {
    return this.service.getInvoices(user, query);
  }

  @Post('invoices')
  issueInvoice(@Body() dto: IssueInvoiceDto, @CurrentUser() user: any) {
    return this.service.issueInvoice(dto, user);
  }

  @Post('invoices/draft')
  saveDraft(@Body() dto: IssueInvoiceDto, @CurrentUser() user: any) {
    return this.service.saveDraft(dto, user);
  }

  @Post('invoices/:id/issue')
  issueDraft(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.issueDraft(id, user);
  }

  @Patch('invoices/:id')
  updateDraft(@Param('id') id: string, @Body() dto: IssueInvoiceDto, @CurrentUser() user: any) {
    return this.service.updateDraft(id, dto, user);
  }

  @Get('invoices/:id')
  getInvoice(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.getInvoice(id, user);
  }

  @Post('invoices/:id/cancel')
  cancelInvoice(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.cancelInvoice(id, user);
  }

  @Post('invoices/:id/pay')
  markInvoicePaid(@Param('id') id: string, @Body() dto: MarkInvoicePaidDto, @CurrentUser() user: any) {
    return this.service.markInvoicePaid(id, dto, user);
  }

  @Post('invoices/:id/unpay')
  unmarkInvoicePaid(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.unmarkInvoicePaid(id, user);
  }

  // ── Perfil de facturación (solo administradores) ────────────────────

  @Get('profile')
  getProfile(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.service.getProfile(user, companyId);
  }

  @Put('profile')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  upsertProfile(@Body() dto: UpsertBillingProfileDto, @CurrentUser() user: any) {
    return this.service.upsertProfile(dto, user);
  }

  @Post('profile/logo')
  @Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
  @UseInterceptors(FileInterceptor('file', { storage: logoStorage }))
  async uploadLogo(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
    @Query('companyId') companyId?: string,
  ) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    if (file.size > 5 * 1024 * 1024) throw new BadRequestException('El archivo supera el límite de 5 MB');
    if (!file.mimetype.match(/^image\/(jpeg|png|webp|svg\+xml)$/)) {
      throw new BadRequestException('Tipo de archivo no permitido. Usa JPG, PNG, WebP o SVG');
    }
    const url = `/api/uploads/${file.filename}`;
    return this.service.saveProfileLogo(url, user, companyId);
  }
}

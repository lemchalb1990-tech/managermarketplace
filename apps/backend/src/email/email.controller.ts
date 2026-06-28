import {
  Controller, Get, Put, Post, Delete, Body, Param, Query,
  UseGuards, Request,
} from '@nestjs/common';
import { EmailType, Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { EmailService } from './email.service';
import { UpsertEmailConfigDto, UpsertEmailTemplateDto, TestEmailDto, FindEmailDto } from './dto/email.dto';

@Controller('email')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.COMPANY_ADMIN)
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  private resolveCompanyId(user: any, query?: FindEmailDto): string | null {
    if (user.role === Role.SUPER_ADMIN) return query?.companyId ?? null;
    return user.companyId;
  }

  // ─── SMTP Config ───────────────────────────────────────────────────────────

  @Get('config')
  getConfig(@Request() req: any, @Query() q: FindEmailDto) {
    const companyId = this.resolveCompanyId(req.user, q);
    if (!companyId) return null;
    return this.emailService.getConfig(companyId);
  }

  @Put('config')
  upsertConfig(@Request() req: any, @Query() q: FindEmailDto, @Body() dto: UpsertEmailConfigDto) {
    const companyId = this.resolveCompanyId(req.user, q);
    if (!companyId) throw new Error('companyId requerido');
    return this.emailService.upsertConfig(companyId, dto);
  }

  @Post('test')
  async testEmail(@Request() req: any, @Query() q: FindEmailDto, @Body() dto: TestEmailDto) {
    const companyId = this.resolveCompanyId(req.user, q);
    if (!companyId) throw new Error('companyId requerido');
    await this.emailService.sendTestEmail(companyId, dto.to);
    return { sent: true };
  }

  // ─── Templates ─────────────────────────────────────────────────────────────

  @Get('templates')
  getTemplates(@Request() req: any, @Query() q: FindEmailDto) {
    const companyId = this.resolveCompanyId(req.user, q);
    return this.emailService.getTemplates(companyId);
  }

  @Put('templates/:type')
  upsertTemplate(
    @Request() req: any,
    @Param('type') type: EmailType,
    @Query() q: FindEmailDto,
    @Body() dto: UpsertEmailTemplateDto,
  ) {
    const companyId = this.resolveCompanyId(req.user, q);
    return this.emailService.upsertTemplate(companyId, type, dto);
  }

  @Delete('templates/:type')
  resetTemplate(
    @Request() req: any,
    @Param('type') type: EmailType,
    @Query() q: FindEmailDto,
  ) {
    const companyId = this.resolveCompanyId(req.user, q);
    return this.emailService.resetTemplate(companyId, type);
  }
}

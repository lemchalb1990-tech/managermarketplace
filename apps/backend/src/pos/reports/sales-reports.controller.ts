import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesReportsService } from './sales-reports.service';

// Reportes de ventas: cualquier rol con el permiso «Reportes de ventas».
@Controller('reports/sales')
@UseGuards(JwtAuthGuard)
export class SalesReportsController {
  constructor(private service: SalesReportsService, private prisma: PrismaService) {}

  @Get()
  report(@CurrentUser() user: any, @Query() q: { type?: string; from?: string; to?: string; companyId?: string }) {
    return this.service.forUser(user, q);
  }

  @Get('excel')
  async excel(@CurrentUser() user: any, @Query() q: { type?: string; from?: string; to?: string; companyId?: string }, @Res() res: Response) {
    const report = await this.service.forUser(user, q);
    const company = await this.prisma.company.findUnique({ where: { id: this.service.resolveCompanyId(user, q.companyId) }, select: { name: true } });
    const buffer = await this.service.excel(report, company?.name ?? '');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="reporte-${report.type}-${report.from}-al-${report.to}.xlsx"`);
    res.send(buffer);
  }
}

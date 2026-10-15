import { Body, Controller, Delete, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesReportsService } from './sales-reports.service';
import { SalesReportSchedulesService } from './sales-report-schedules.service';

// Reportes de ventas: cualquier rol con el permiso «Reportes de ventas».
@Controller('reports/sales')
@UseGuards(JwtAuthGuard)
export class SalesReportsController {
  constructor(private service: SalesReportsService, private schedules: SalesReportSchedulesService, private prisma: PrismaService) {}

  @Get()
  report(@CurrentUser() user: any, @Query() q: { type?: string; from?: string; to?: string; companyId?: string; page?: string }) {
    return this.service.forUser(user, q);
  }

  // Envíos programados por correo (semanal).
  @Get('schedules')
  listSchedules(@CurrentUser() user: any, @Query('companyId') companyId?: string) {
    return this.schedules.list(user, companyId);
  }

  @Post('schedules')
  createSchedule(@CurrentUser() user: any, @Body() body: { type?: string; email?: string; weekday?: number; hour?: number }, @Query('companyId') companyId?: string) {
    return this.schedules.create(user, body, companyId);
  }

  @Delete('schedules/:id')
  removeSchedule(@CurrentUser() user: any, @Param('id') id: string, @Query('companyId') companyId?: string) {
    return this.schedules.remove(user, id, companyId);
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

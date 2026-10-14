import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { PlatformMailService } from '../../email/platform-mail.service';
import { dateKeyStringInTz, shiftDateKey } from '../../common/timezone';
import { canProductField } from '../../common/permissions';
import { REPORT_TITLE, REPORT_TYPES, SalesReportsService } from './sales-reports.service';

// Reportes de ventas programados: cada semana, el día y la hora elegidos, se envía por correo el
// reporte de los últimos 7 días (hasta el día anterior) con el Excel adjunto.
@Injectable()
export class SalesReportSchedulesService {
  private readonly logger = new Logger(SalesReportSchedulesService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private mail: PlatformMailService,
    private reports: SalesReportsService,
  ) {}

  async list(user: any, companyId?: string) {
    this.reports.assertAccess(user);
    const cId = this.reports.resolveCompanyId(user, companyId);
    return this.prisma.reportSchedule.findMany({ where: { companyId: cId }, orderBy: { createdAt: 'asc' } });
  }

  async create(user: any, dto: { type?: string; email?: string; weekday?: number; hour?: number }, companyId?: string) {
    this.reports.assertAccess(user);
    const cId = this.reports.resolveCompanyId(user, companyId);
    const email = String(dto.email ?? '').trim().toLowerCase();
    if (!REPORT_TYPES.includes(dto.type as never)) throw new BadRequestException('Reporte no válido');
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new BadRequestException('Indica un correo válido');
    const weekday = Math.trunc(Number(dto.weekday));
    const hour = Math.trunc(Number(dto.hour));
    if (!(weekday >= 1 && weekday <= 7) || !(hour >= 0 && hour <= 23)) throw new BadRequestException('Día u hora no válidos');
    const count = await this.prisma.reportSchedule.count({ where: { companyId: cId } });
    if (count >= 20) throw new BadRequestException('Máximo 20 envíos programados por empresa');
    return this.prisma.reportSchedule.create({
      data: {
        companyId: cId, type: dto.type as string, email, weekday, hour,
        showCost: canProductField(user, 'cost', 'view'),
        createdByName: user.name || user.email || null,
      },
    });
  }

  async remove(user: any, id: string, companyId?: string) {
    this.reports.assertAccess(user);
    const cId = this.reports.resolveCompanyId(user, companyId);
    const row = await this.prisma.reportSchedule.findUnique({ where: { id } });
    if (!row || row.companyId !== cId) throw new NotFoundException('Envío programado no encontrado');
    await this.prisma.reportSchedule.delete({ where: { id } });
    return { deleted: true };
  }

  // Cada hora (minuto 5): envía los programados para este día y hora de la zona de la plataforma.
  @Cron('5 * * * *')
  async sendDue() {
    const tz = await this.settings.getTimezone();
    const now = new Date();
    const todayKey = dateKeyStringInTz(now, tz);
    const weekday = ((new Date(`${todayKey}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now));
    const due = await this.prisma.reportSchedule.findMany({
      where: { weekday, hour, OR: [{ lastSentAt: null }, { lastSentAt: { lt: new Date(now.getTime() - 2 * 3600_000) } }] },
      include: { company: { select: { name: true, active: true } } },
    });
    if (!due.length) return;
    const to = shiftDateKey(todayKey, -1);
    const from = shiftDateKey(to, -6);
    const base = await this.mail.frontendUrl();
    for (const s of due) {
      if (s.company && s.company.active === false) continue;
      try {
        const report = await this.reports.build(s.companyId, s.type, from, to, { showCost: s.showCost });
        const excel = await this.reports.excel(report, s.company?.name ?? '');
        const ventas = report.type === 'libro' ? report.rows.length : Number(report.totals.ventas ?? 0);
        const total = Number(report.type === 'libro' ? report.totals.total : report.type === 'pago' ? report.totals.monto : report.totals.bruto) || 0;
        const dmy = (k: string) => k.split('-').reverse().join('-');
        const sent = await this.mail.sendTemplate('SALES_REPORT', s.email, {
          reporte: REPORT_TITLE[report.type], empresa: s.company?.name ?? '', desde: dmy(from), hasta: dmy(to),
          cantidad: ventas.toLocaleString('es-CL'), total: `$${Math.round(total).toLocaleString('es-CL')}`,
          enlace: `${base}/dashboard/reportes`,
        }, { companyId: s.companyId, attachments: [{ filename: `reporte-${report.type}-${from}-al-${to}.xlsx`, content: excel }] });
        if (sent) await this.prisma.reportSchedule.update({ where: { id: s.id }, data: { lastSentAt: now } });
      } catch (e: any) {
        this.logger.error(`No se pudo enviar el reporte programado ${s.id}: ${e.message}`);
      }
    }
  }
}

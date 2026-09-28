import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { dateKeyStringInTz } from '../common/timezone';
import { FinanceService } from './finance.service';
import { RecurringDto } from './dto/finance.dto';

// "YYYY-MM" → número de meses desde el año 0, para avanzar de a intervalMonths.
const toIndex = (period: string) => { const [y, m] = period.split('-').map(Number); return y * 12 + (m - 1); };
const fromIndex = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;

// Día de vencimiento dentro del período: si el mes es más corto (p. ej. día 31 en febrero), el último día.
function dueDateKey(period: string, dayOfMonth: number): string {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(Math.min(dayOfMonth, last)).padStart(2, '0')}`;
}

// Gastos (o ingresos) que se repiten: arriendo, sueldos, suscripciones. Cada día se generan
// los movimientos que ya vencieron; el índice único (recurringId, period) impide duplicarlos.
@Injectable()
export class FinanceRecurringService {
  private readonly logger = new Logger(FinanceRecurringService.name);

  constructor(private prisma: PrismaService, private finance: FinanceService, private settings: SettingsService) {}

  private async getOwned(user: any, id: string) {
    const r = await this.prisma.financeRecurring.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Recurrente no encontrado');
    if (user.role !== Role.SUPER_ADMIN && r.companyId !== user.companyId) throw new ForbiddenException();
    return r;
  }

  async list(user: any, companyIdParam?: string) {
    const companyId = this.finance.resolveCompanyId(user, companyIdParam);
    await this.generateDue(companyId);
    const items = await this.prisma.financeRecurring.findMany({
      where: { companyId },
      include: {
        account: { select: { id: true, name: true, type: true } },
        bankAccount: { select: { id: true, name: true } },
        _count: { select: { movements: true } },
      },
      orderBy: [{ active: 'desc' }, { dayOfMonth: 'asc' }],
    });
    return items.map((r) => ({ ...r, nextDate: this.nextDue(r) }));
  }

  private async validate(companyId: string, dto: RecurringDto) {
    const account = await this.finance.validateMovementAccount(companyId, dto.accountId);
    if (account.systemKey) throw new BadRequestException('Esa cuenta se calcula sola desde ventas o compras');
    await this.finance.validateBankAccount(companyId, dto.bankAccountId);
    if (dto.endDate && dto.endDate.slice(0, 10) < dto.startDate.slice(0, 10)) throw new BadRequestException('La fecha de término es anterior al inicio');
  }

  private data(dto: RecurringDto) {
    return {
      accountId: dto.accountId, description: dto.description.trim(), amount: dto.amount, tax: dto.tax ?? 0,
      counterparty: dto.counterparty?.trim() || null, paymentMethod: dto.paymentMethod ?? null,
      bankAccountId: dto.bankAccountId || null, dayOfMonth: dto.dayOfMonth, intervalMonths: dto.intervalMonths ?? 1,
      startDate: this.finance.toStoredDate(dto.startDate), endDate: dto.endDate ? this.finance.toStoredDate(dto.endDate) : null,
      active: dto.active ?? true,
    };
  }

  async create(user: any, dto: RecurringDto) {
    const companyId = this.finance.resolveCompanyId(user, dto.companyId);
    await this.validate(companyId, dto);
    const created = await this.prisma.financeRecurring.create({ data: { companyId, ...this.data(dto) } });
    await this.generateDue(companyId);
    return created;
  }

  async update(user: any, id: string, dto: RecurringDto) {
    const current = await this.getOwned(user, id);
    await this.validate(current.companyId, dto);
    // Si cambia el inicio o la frecuencia, se recalcula desde el último período ya generado.
    const updated = await this.prisma.financeRecurring.update({ where: { id }, data: this.data(dto) });
    await this.generateDue(current.companyId);
    return updated;
  }

  // Los movimientos ya generados se conservan (quedan como movimientos normales).
  async remove(user: any, id: string) {
    await this.getOwned(user, id);
    await this.prisma.financeRecurring.delete({ where: { id } });
    return { deleted: true };
  }

  private nextPeriodIndex(r: { startDate: Date; lastPeriod: string | null; intervalMonths: number }) {
    const start = toIndex(r.startDate.toISOString().slice(0, 7));
    return r.lastPeriod ? Math.max(toIndex(r.lastPeriod) + r.intervalMonths, start) : start;
  }

  // Próxima fecha pendiente de generar (YYYY-MM-DD), o null si terminó o está pausado.
  private nextDue(r: { active: boolean; startDate: Date; endDate: Date | null; lastPeriod: string | null; intervalMonths: number; dayOfMonth: number }): string | null {
    if (!r.active) return null;
    const start = r.startDate.toISOString().slice(0, 10);
    for (let i = this.nextPeriodIndex(r), n = 0; n < 24; i += r.intervalMonths, n++) {
      const due = dueDateKey(fromIndex(i), r.dayOfMonth);
      if (due < start) continue;
      if (r.endDate && due > r.endDate.toISOString().slice(0, 10)) return null;
      return due;
    }
    return null;
  }

  // Genera los movimientos vencidos (hasta hoy) de los recurrentes activos.
  async generateDue(companyId?: string): Promise<number> {
    const today = dateKeyStringInTz(new Date(), await this.settings.getTimezone());
    const items = await this.prisma.financeRecurring.findMany({ where: { active: true, ...(companyId ? { companyId } : {}) } });
    let created = 0;
    for (const r of items) {
      const start = r.startDate.toISOString().slice(0, 10);
      const end = r.endDate?.toISOString().slice(0, 10);
      let last = r.lastPeriod;
      for (let i = this.nextPeriodIndex(r), n = 0; n < 120; i += r.intervalMonths, n++) {
        const period = fromIndex(i);
        const due = dueDateKey(period, r.dayOfMonth);
        if (due > today || (end && due > end)) break;
        if (due >= start) {
          try {
            await this.prisma.financeMovement.create({
              data: {
                companyId: r.companyId, accountId: r.accountId, date: this.finance.toStoredDate(due), amount: r.amount, tax: r.tax,
                description: r.description, counterparty: r.counterparty, paymentMethod: r.paymentMethod,
                bankAccountId: r.bankAccountId, recurringId: r.id, period,
              },
            });
            created++;
          } catch (err: any) {
            if (err?.code !== 'P2002') throw err; // ya generado por otra corrida
          }
        }
        last = period;
      }
      if (last !== r.lastPeriod) await this.prisma.financeRecurring.update({ where: { id: r.id }, data: { lastPeriod: last } });
    }
    return created;
  }

  // Próximos vencimientos dentro de `days` días (para alertas y el resumen del inicio).
  async upcoming(companyId: string, days: number) {
    const tz = await this.settings.getTimezone();
    const today = dateKeyStringInTz(new Date(), tz);
    const limit = dateKeyStringInTz(new Date(Date.now() + days * 24 * 60 * 60 * 1000), tz);
    const items = await this.prisma.financeRecurring.findMany({
      where: { companyId, active: true },
      include: { account: { select: { name: true, type: true } } },
    });
    return items
      .map((r) => ({ id: r.id, description: r.description, account: r.account.name, type: r.account.type, amount: Number(r.amount) + Number(r.tax), date: this.nextDue(r) }))
      .filter((r) => r.date && r.date >= today && r.date <= limit)
      .sort((a, b) => a.date!.localeCompare(b.date!));
  }

  @Cron('0 10 * * *') // 10:00 UTC ≈ 6-7 AM en Chile
  async generateAll() {
    try {
      const created = await this.generateDue();
      if (created) this.logger.log(`Finanzas: ${created} movimiento(s) recurrente(s) generado(s)`);
    } catch (err: any) {
      this.logger.error(`Finanzas: error generando recurrentes: ${err?.message || err}`);
    }
  }
}

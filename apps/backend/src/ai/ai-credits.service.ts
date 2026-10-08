import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { dateKeyStringInTz, startOfDayInTz } from '../common/timezone';
import { AiProvidersService } from './ai-providers.service';

export type AiUsageKind = 'PHOTO_CHECK' | 'PHOTO_FIX';

const COST_KEYS: Record<AiUsageKind, { key: string; fallback: number }> = {
  PHOTO_CHECK: { key: 'AI_CREDITS_PHOTO_CHECK', fallback: 1 },
  PHOTO_FIX: { key: 'AI_CREDITS_PHOTO_FIX', fallback: 5 },
};

// Créditos de IA por empresa según su plan (límite diario y mensual, en la zona horaria del
// panel). Se descuentan antes de llamar a OpenAI y se devuelven si la llamada falla.
@Injectable()
export class AiCreditsService {
  constructor(private prisma: PrismaService, private settings: SettingsService, private providers: AiProvidersService) {}

  async cost(kind: AiUsageKind): Promise<number> {
    const { key, fallback } = COST_KEYS[kind];
    const n = parseInt(await this.settings.get(key), 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  async status(companyId: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, include: { aiPlan: true } });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    const tz = await this.settings.getTimezone();
    const dayStart = startOfDayInTz(tz);
    const monthStart = startOfDayInTz(tz, `${dateKeyStringInTz(new Date(), tz).slice(0, 7)}-01`);
    const sum = async (from: Date) => (await this.prisma.aiUsage.aggregate({
      where: { companyId, createdAt: { gte: from } },
      _sum: { credits: true },
    }))._sum.credits ?? 0;
    const [usedToday, usedMonth, checkCost, fixCost, ready] = await Promise.all([
      sum(dayStart), sum(monthStart), this.cost('PHOTO_CHECK'), this.cost('PHOTO_FIX'), this.providers.readyTasks(),
    ]);
    const plan = company.aiPlan;
    const remaining = (limit: number | null | undefined, used: number) => (limit == null ? null : Math.max(0, limit - used));
    return {
      plan: plan ? { id: plan.id, name: plan.name, dailyCredits: plan.dailyCredits, monthlyCredits: plan.monthlyCredits } : null,
      usedToday,
      usedMonth,
      remainingToday: plan ? remaining(plan.dailyCredits, usedToday) : 0,
      remainingMonth: plan ? remaining(plan.monthlyCredits, usedMonth) : 0,
      costs: { PHOTO_CHECK: checkCost, PHOTO_FIX: fixCost },
      // Tareas con una IA asignada y configurada (si no, no se ofrecen).
      ready,
    };
  }

  /** Descuenta los créditos (o rechaza si no alcanzan). Devuelve el id del uso para poder devolverlo. */
  async consume(companyId: string, user: any, kind: AiUsageKind, productId?: string): Promise<string> {
    const credits = await this.cost(kind);
    // El Super Admin no queda limitado, pero su uso igual se registra en la empresa.
    if (user.role !== Role.SUPER_ADMIN) {
      const st = await this.status(companyId);
      if (!st.plan) {
        throw new ForbiddenException('Tu empresa no tiene un plan de IA. Pide al administrador de la plataforma que te asigne uno.');
      }
      if (st.remainingToday !== null && st.remainingToday < credits) {
        throw new BadRequestException(`Se acabaron los créditos de IA de hoy (${st.usedToday} de ${st.plan.dailyCredits}). Vuelven mañana.`);
      }
      if (st.remainingMonth !== null && st.remainingMonth < credits) {
        throw new BadRequestException(`Se acabaron los créditos de IA del mes (${st.usedMonth} de ${st.plan.monthlyCredits}).`);
      }
    }
    const usage = await this.prisma.aiUsage.create({
      data: { companyId, userId: user.id ?? null, kind, credits, productId: productId ?? null },
    });
    return usage.id;
  }

  async updateCosts(costs: Partial<Record<AiUsageKind, number>>) {
    const items = (Object.keys(COST_KEYS) as AiUsageKind[])
      .filter((k) => costs[k] != null && Number.isFinite(Number(costs[k])))
      .map((k) => ({ key: COST_KEYS[k].key, value: String(Math.max(0, Math.floor(Number(costs[k])))) }));
    if (items.length) await this.settings.upsertMany(items);
    return { PHOTO_CHECK: await this.cost('PHOTO_CHECK'), PHOTO_FIX: await this.cost('PHOTO_FIX') };
  }

  async refund(usageId: string) {
    await this.prisma.aiUsage.delete({ where: { id: usageId } }).catch(() => {});
  }

  // ── Planes (Super Admin) ──────────────────────────────────────────────────

  listPlans() {
    return this.prisma.aiPlan.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { companies: true } } } });
  }

  createPlan(data: { name: string; dailyCredits?: number | null; monthlyCredits?: number | null }) {
    return this.prisma.aiPlan.create({ data: this.planData(data) as any });
  }

  updatePlan(id: string, data: { name?: string; dailyCredits?: number | null; monthlyCredits?: number | null }) {
    return this.prisma.aiPlan.update({ where: { id }, data: this.planData(data) });
  }

  // Las empresas con este plan quedan sin plan (onDelete: SetNull).
  deletePlan(id: string) {
    return this.prisma.aiPlan.delete({ where: { id } });
  }

  async assignPlan(companyId: string, aiPlanId: string | null) {
    await this.prisma.company.update({ where: { id: companyId }, data: { aiPlanId } });
    return this.status(companyId);
  }

  // Empresas con su plan y consumo del mes, para la página de Planes de IA.
  async companiesOverview() {
    const companies = await this.prisma.company.findMany({
      where: { closureRequestedAt: null },
      select: { id: true, name: true, aiPlanId: true },
      orderBy: { name: 'asc' },
    });
    const tz = await this.settings.getTimezone();
    const monthStart = startOfDayInTz(tz, `${dateKeyStringInTz(new Date(), tz).slice(0, 7)}-01`);
    const dayStart = startOfDayInTz(tz);
    const [month, day] = await Promise.all([
      this.prisma.aiUsage.groupBy({ by: ['companyId'], where: { createdAt: { gte: monthStart } }, _sum: { credits: true } }),
      this.prisma.aiUsage.groupBy({ by: ['companyId'], where: { createdAt: { gte: dayStart } }, _sum: { credits: true } }),
    ]);
    const m = new Map(month.map((r) => [r.companyId, r._sum.credits ?? 0]));
    const d = new Map(day.map((r) => [r.companyId, r._sum.credits ?? 0]));
    return companies.map((c) => ({ ...c, usedToday: d.get(c.id) ?? 0, usedMonth: m.get(c.id) ?? 0 }));
  }

  private planData(data: { name?: string; dailyCredits?: number | null; monthlyCredits?: number | null }) {
    const limit = (v: number | null | undefined) => (v === undefined ? undefined : v === null ? null : Math.max(0, Math.floor(v)));
    const name = data.name?.trim();
    if (data.name !== undefined && !name) throw new BadRequestException('El plan necesita un nombre');
    return { name, dailyCredits: limit(data.dailyCredits), monthlyCredits: limit(data.monthlyCredits) };
  }
}

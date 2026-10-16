import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const PLAN_FEATURES = ['POS', 'PURCHASES', 'PICKING', 'MULTICOMPANY', 'ML_PROMOTIONS', 'ONLINE_PAYMENTS'] as const;
export type PlanResource = 'channels' | 'products' | 'users' | 'warehouses';

const RESOURCE: Record<PlanResource, { field: 'maxChannels' | 'maxProducts' | 'maxUsers' | 'maxWarehouses'; extra: 'extraChannels' | 'extraProducts' | 'extraUsers' | 'extraWarehouses'; label: string }> = {
  channels: { field: 'maxChannels', extra: 'extraChannels', label: 'canales o cuentas conectadas' },
  products: { field: 'maxProducts', extra: 'extraProducts', label: 'productos' },
  users: { field: 'maxUsers', extra: 'extraUsers', label: 'usuarios' },
  warehouses: { field: 'maxWarehouses', extra: 'extraWarehouses', label: 'bodegas' },
};

type LimitCompany = {
  extraChannels: number; extraProducts: number; extraUsers: number; extraWarehouses: number;
  subscriptionPlan: { maxChannels: number | null; maxProducts: number | null; maxUsers: number | null; maxWarehouses: number | null } | null;
};
const LIMIT_SELECT = { extraChannels: true, extraProducts: true, extraUsers: true, extraWarehouses: true } as const;

// Límite de un recurso: el del plan más los adicionales de la empresa. Sin plan no hay
// límites; un plan sin límite en ese recurso sigue sin límite (los adicionales no aplican).
// (Company.maxUsers quedó sin uso: el máximo de usuarios lo define siempre el plan.)
function limitFor(company: LimitCompany, resource: PlanResource): { limit: number | null; planLimit: number | null; extra: number } {
  const plan = company.subscriptionPlan;
  if (!plan) return { limit: null, planLimit: null, extra: 0 };
  const planLimit = plan[RESOURCE[resource].field];
  const extra = company[RESOURCE[resource].extra] ?? 0;
  return { limit: planLimit == null ? null : planLimit + extra, planLimit, extra: planLimit == null ? 0 : extra };
}

/** Funciones del plan más las adicionales de la empresa. null = sin plan (todo incluido). */
export function companyPlanFeatures(company: { extraFeatures?: string[] | null; subscriptionPlan?: { features: string[] } | null } | null | undefined): string[] | null {
  const plan = company?.subscriptionPlan;
  if (!plan) return null;
  return Array.from(new Set([...(plan.features ?? []), ...(company?.extraFeatures ?? [])]));
}

export interface PlanInput {
  name?: string;
  description?: string | null;
  monthlyPrice?: number | null;
  annualPrice?: number | null;
  priceFrom?: boolean;
  implementationPrice?: number | null;
  implementationFreeAnnual?: boolean;
  maxChannels?: number | null;
  maxProducts?: number | null;
  maxUsers?: number | null;
  maxWarehouses?: number | null;
  features?: string[];
  addons?: string | null;
  isTrial?: boolean;
  trialDays?: number | null;
  sortOrder?: number;
  active?: boolean;
}

// Planes comerciales: catálogo editable por el Super Admin, plan de cada empresa y límites
// (canales, productos, usuarios, bodegas) que se cuentan y bloquean al crear de más.
@Injectable()
export class SubscriptionService {
  constructor(private prisma: PrismaService) {}

  // ── Consumo y límites ──────────────────────────────────────────────────

  private async counts(companyId: string): Promise<Record<PlanResource, number>> {
    const [channels, products, users, warehouses] = await Promise.all([
      this.prisma.marketplaceConnection.count({ where: { companyId, active: true } }),
      this.prisma.product.count({ where: { companyId, active: true } }),
      this.prisma.user.count({ where: { companyId, active: true } }),
      this.prisma.warehouse.count({ where: { companyId, active: true } }),
    ]);
    return { channels, products, users, warehouses };
  }

  /** Plan de la empresa, consumo frente a cada límite y estado de la prueba. */
  async usage(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { ...LIMIT_SELECT, extraFeatures: true, addonsMonthlyPrice: true, subscriptionBilling: true, trialEndsAt: true, subscriptionPlan: true },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    const plan = company.subscriptionPlan;
    const used = await this.counts(companyId);
    const usage = Object.fromEntries((Object.keys(RESOURCE) as PlanResource[]).map((r) => {
      return [r, { used: used[r], ...limitFor(company, r) }];
    })) as Record<PlanResource, { used: number; limit: number | null; planLimit: number | null; extra: number }>;
    const trialExpired = !!(plan?.isTrial && company.trialEndsAt && company.trialEndsAt < new Date());
    return {
      plan, billing: company.subscriptionBilling, trialEndsAt: company.trialEndsAt, trialExpired, usage,
      features: companyPlanFeatures(company),
      extraFeatures: plan ? company.extraFeatures : [],
      addonsMonthlyPrice: company.addonsMonthlyPrice,
    };
  }

  /** Rechaza si agregar `adding` del recurso supera el límite del plan de la empresa. */
  async assertCanAdd(companyId: string | null | undefined, resource: PlanResource, adding = 1) {
    if (!companyId) return;
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { ...LIMIT_SELECT, subscriptionPlan: { select: { name: true, maxChannels: true, maxProducts: true, maxUsers: true, maxWarehouses: true } } },
    });
    if (!company) return;
    const plan = company.subscriptionPlan;
    const { limit, extra } = limitFor(company, resource);
    if (limit == null) return;
    const used = (await this.counts(companyId))[resource];
    if (used + adding > limit) {
      const left = Math.max(0, limit - used);
      throw new ForbiddenException(
        plan
          ? `Tu plan ${plan.name}${extra > 0 ? ' con sus adicionales' : ''} permite hasta ${limit.toLocaleString('es-CL')} ${RESOURCE[resource].label} y ya tienes ${used.toLocaleString('es-CL')}${adding > 1 ? ` (puedes agregar ${left.toLocaleString('es-CL')} más)` : ''}. Mejora tu plan para agregar más.`
          : `Límite de ${RESOURCE[resource].label} alcanzado (${limit}). Contacta al administrador del sistema.`,
      );
    }
  }

  // ── Catálogo de planes (Super Admin) ───────────────────────────────────

  listPlans() {
    return this.prisma.subscriptionPlan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { companies: true } } },
    });
  }

  // Planes activos para la landing pública: solo lo que se muestra en la tabla de precios.
  publicPlans() {
    return this.prisma.subscriptionPlan.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true, name: true, description: true, monthlyPrice: true, annualPrice: true, priceFrom: true,
        implementationPrice: true, implementationFreeAnnual: true, maxChannels: true, maxProducts: true,
        maxUsers: true, maxWarehouses: true, features: true, addons: true, isTrial: true, trialDays: true,
      },
    });
  }

  createPlan(input: PlanInput) {
    const data = this.planData(input);
    if (!data.name) throw new BadRequestException('El plan necesita un nombre');
    return this.prisma.subscriptionPlan.create({ data: data as any });
  }

  async updatePlan(id: string, input: PlanInput) {
    await this.prisma.subscriptionPlan.findUniqueOrThrow({ where: { id } }).catch(() => { throw new NotFoundException('Plan no encontrado'); });
    return this.prisma.subscriptionPlan.update({ where: { id }, data: this.planData(input) });
  }

  // Las empresas con este plan quedan sin plan (onDelete: SetNull).
  deletePlan(id: string) {
    return this.prisma.subscriptionPlan.delete({ where: { id } });
  }

  /** Asigna el plan a una empresa. Un plan de prueba fija el fin de la prueba. */
  async assignPlan(companyId: string, planId: string | null, billing?: string | null) {
    const plan = planId ? await this.prisma.subscriptionPlan.findUnique({ where: { id: planId } }) : null;
    if (planId && !plan) throw new NotFoundException('Plan no encontrado');
    const current = await this.prisma.company.findUnique({ where: { id: companyId }, select: { subscriptionPlanId: true, trialEndsAt: true } });
    if (!current) throw new NotFoundException('Empresa no encontrada');
    let trialEndsAt: Date | null = null;
    if (plan?.isTrial) {
      // Mantener el fin de prueba si se vuelve a guardar el mismo plan de prueba.
      trialEndsAt = current.subscriptionPlanId === plan.id && current.trialEndsAt
        ? current.trialEndsAt
        : new Date(Date.now() + (plan.trialDays ?? 15) * 86400000);
    }
    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        subscriptionPlanId: plan?.id ?? null,
        subscriptionBilling: plan && !plan.isTrial ? (billing === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY') : null,
        trialEndsAt,
      },
    });
    return this.usage(companyId);
  }

  private planData(input: PlanInput) {
    const int = (v: number | null | undefined) => (v === undefined ? undefined : v === null ? null : Math.max(0, Math.floor(Number(v))));
    const str = (v: string | null | undefined) => (v === undefined ? undefined : (v ?? '').trim() || null);
    const name = input.name === undefined ? undefined : input.name.trim();
    if (input.name !== undefined && !name) throw new BadRequestException('El plan necesita un nombre');
    return {
      name,
      description: str(input.description),
      monthlyPrice: int(input.monthlyPrice),
      annualPrice: int(input.annualPrice),
      priceFrom: input.priceFrom,
      implementationPrice: int(input.implementationPrice),
      implementationFreeAnnual: input.implementationFreeAnnual,
      maxChannels: int(input.maxChannels),
      maxProducts: int(input.maxProducts),
      maxUsers: int(input.maxUsers),
      maxWarehouses: int(input.maxWarehouses),
      features: input.features === undefined ? undefined : PLAN_FEATURES.filter((f) => input.features!.includes(f)),
      addons: str(input.addons),
      isTrial: input.isTrial,
      trialDays: int(input.trialDays),
      sortOrder: int(input.sortOrder) ?? undefined,
      active: input.active,
    };
  }
}

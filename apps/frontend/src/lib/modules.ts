// Gating por módulos licenciados: Company.modules (null = todos licenciados) y
// User.modules (null = todos los licenciados habilitados para ese usuario).
// moduleKey admite prefijos, ej. 'ecommerce' matchea 'ecommerce_ml', 'ecommerce_shopify', etc.

export function matchesModule(modules: any, moduleKey: string): boolean {
  if (!modules || !Array.isArray(modules)) return true;
  return modules.some((m: string) => m === moduleKey || m.startsWith(moduleKey + '_'));
}

// Funciones del plan comercial (Company.planFeatures, null = sin plan = todo).
export type PlanFeature = 'POS' | 'PURCHASES' | 'PICKING' | 'MULTICOMPANY';

export function planAllows(user: any, feature: PlanFeature | undefined | null): boolean {
  if (!feature) return true;
  if (!user || user.role === 'SUPER_ADMIN') return true;
  const features = user.company?.planFeatures;
  if (!Array.isArray(features)) return true;
  return features.includes(feature);
}

// Módulos que dependen de una función del plan: si el plan no la incluye, se ocultan.
const MODULE_PLAN_FEATURE: Record<string, PlanFeature> = { pos: 'POS', purchases: 'PURCHASES' };

export function hasModule(user: any, moduleKey: string | null): boolean {
  if (moduleKey === null) return true;
  if (!user) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  if (!planAllows(user, MODULE_PLAN_FEATURE[moduleKey])) return false;
  // company-level check (null = todos licenciados)
  if (!matchesModule(user.company?.modules, moduleKey)) return false;
  // user-level check (null = todos los licenciados habilitados)
  return matchesModule(user.modules, moduleKey);
}

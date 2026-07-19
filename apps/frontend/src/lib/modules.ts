// Gating por módulos licenciados: Company.modules (null = todos licenciados) y
// User.modules (null = todos los licenciados habilitados para ese usuario).
// moduleKey admite prefijos, ej. 'ecommerce' matchea 'ecommerce_ml', 'ecommerce_shopify', etc.

export function matchesModule(modules: any, moduleKey: string): boolean {
  if (!modules || !Array.isArray(modules)) return true;
  return modules.some((m: string) => m === moduleKey || m.startsWith(moduleKey + '_'));
}

export function hasModule(user: any, moduleKey: string | null): boolean {
  if (moduleKey === null) return true;
  if (!user) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  // company-level check (null = todos licenciados)
  if (!matchesModule(user.company?.modules, moduleKey)) return false;
  // user-level check (null = todos los licenciados habilitados)
  return matchesModule(user.modules, moduleKey);
}

// Gating por módulos licenciados (Company.modules): null = todos licenciados.
// Espejo de apps/frontend/src/lib/modules.ts — mismo criterio en ambos lados.
// moduleKey admite prefijos, ej. 'ecommerce' matchea 'ecommerce_ml', 'ecommerce_shopify', etc.
export function matchesModule(modules: any, moduleKey: string): boolean {
  if (!modules || !Array.isArray(modules)) return true;
  return modules.some((m: string) => m === moduleKey || m.startsWith(moduleKey + '_'));
}

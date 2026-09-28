// Utilidades compartidas del módulo de Finanzas. Todos los montos son SIN IVA.

export const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export const TYPE_LABEL: Record<string, string> = { INCOME: 'Ingresos', EXPENSE: 'Gastos' };

export const PAYMENT_LABEL: Record<string, string> = { CASH: 'Efectivo', CARD: 'Tarjeta', TRANSFER: 'Transferencia', OTHER: 'Otro' };

export function clp(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—';
  return `$${Math.round(n).toLocaleString('es-CL')}`;
}

export type AccountNode<T> = T & { depth: number; hasChildren: boolean };

// Ordena las cuentas como árbol (madre seguida de sus subcuentas) y agrega la profundidad.
export function flattenTree<T extends { id: string; parentId: string | null; code?: string | null; name: string }>(accounts: T[]): AccountNode<T>[] {
  const byParent = new Map<string | null, T[]>();
  const ids = new Set(accounts.map((a) => a.id));
  for (const a of accounts) {
    const key = a.parentId && ids.has(a.parentId) ? a.parentId : null;
    byParent.set(key, [...(byParent.get(key) || []), a]);
  }
  const sortFn = (a: T, b: T) => (a.code || '').localeCompare(b.code || '', 'es', { numeric: true }) || a.name.localeCompare(b.name, 'es');
  const out: AccountNode<T>[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const a of (byParent.get(parentId) || []).slice().sort(sortFn)) {
      const children = byParent.get(a.id) || [];
      out.push({ ...a, depth, hasChildren: children.length > 0 });
      walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function sum(values: number[], from = 0, to = values.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += values[i] || 0;
  return s;
}

// Semáforo del avance de una cuenta: en gastos, pasarse es malo; en ingresos, quedarse corto.
export function trafficLight(type: string, budget: number, actual: number): { cls: string; label: string } | null {
  if (!budget) return null;
  const pct = (actual / budget) * 100;
  if (type === 'EXPENSE') {
    if (pct > 100) return { cls: 'bg-red-100 text-red-700', label: 'Sobre presupuesto' };
    if (pct >= 90) return { cls: 'bg-amber-100 text-amber-700', label: 'Cerca del límite' };
    return { cls: 'bg-emerald-100 text-emerald-700', label: 'Dentro del presupuesto' };
  }
  if (pct >= 100) return { cls: 'bg-emerald-100 text-emerald-700', label: 'Meta cumplida' };
  if (pct >= 90) return { cls: 'bg-amber-100 text-amber-700', label: 'Cerca de la meta' };
  return { cls: 'bg-red-100 text-red-700', label: 'Bajo la meta' };
}

export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function monthRange(year: number, month: number): { from: string; to: string } {
  const last = new Date(year, month, 0).getDate();
  const m = String(month).padStart(2, '0');
  return { from: `${year}-${m}-01`, to: `${year}-${m}-${String(last).padStart(2, '0')}` };
}

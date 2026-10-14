'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { useAdminCompany } from '@/app/dashboard/AdminCompanyContext';

// Pantallas vacías del panel (propuesta "Guiada"):
// - SetupSteps: la vista aún no tiene datos → pasos para dejarla funcionando, con lo ya
//   hecho tachado y el siguiente paso destacado.
// - EmptyFiltered: los filtros no encontraron nada → cada filtro activo con su ✕.

export type CompanySetup = {
  companyCreatedAt: string | null;
  connections: number;
  products: number;
  sales: number;
  channelSales: number;
  orders: number;
};

// Estado de puesta en marcha de la empresa; solo se pide cuando `enabled` (vista vacía).
export function useCompanySetup(enabled: boolean): CompanySetup | null {
  const { isSuperAdmin, selectedCompanyId } = useAdminCompany();
  const [setup, setSetup] = useState<CompanySetup | null>(null);
  useEffect(() => {
    const token = getToken();
    if (!enabled || !token || (isSuperAdmin && !selectedCompanyId)) return;
    let alive = true;
    api.companyAccount.setup(token, isSuperAdmin ? selectedCompanyId || undefined : undefined)
      .then((s) => { if (alive) setSetup(s); })
      .catch(() => {});
    return () => { alive = false; };
  }, [enabled, isSuperAdmin, selectedCompanyId]);
  return setup;
}

export type SetupStep = {
  title: string;
  hint?: ReactNode;
  done: boolean;
  optional?: boolean;
  action?: { label: string; href?: string; onClick?: () => void };
};

export function SetupSteps({ title, description, steps, loading = false }: { title: string; description: string; steps: SetupStep[]; loading?: boolean }) {
  const done = steps.filter((s) => s.done).length;
  const current = steps.findIndex((s) => !s.done);
  return (
    <div className="px-4 py-8 sm:py-10 flex justify-center">
      <div className="w-full max-w-[540px] flex flex-col gap-4">
        <div>
          <h3 className="text-lg font-bold text-gray-900 text-balance">{title}</h3>
          <p className="text-sm text-gray-500 mt-1">{description}</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full bg-green-600 transition-[width] duration-500" style={{ width: `${loading ? 0 : (done / steps.length) * 100}%` }} />
          </div>
          <span className="shrink-0 tabular-nums">{loading ? 'Revisando…' : `${done} de ${steps.length} listo${done === 1 ? '' : 's'}`}</span>
        </div>
        <ol className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100 bg-white">
          {steps.map((s, i) => {
            const isCurrent = !loading && i === current;
            return (
              <li key={s.title} className={`flex flex-wrap sm:flex-nowrap items-center gap-3 px-4 py-3 ${isCurrent ? 'bg-blue-50/70' : ''}`}>
                <span className={`grid place-items-center w-6 h-6 shrink-0 rounded-full text-xs font-bold border-2 ${
                  s.done ? 'bg-green-600 border-green-600 text-white' : isCurrent ? 'border-blue-600 text-blue-700' : 'border-gray-200 text-gray-400'}`}>
                  {s.done ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                  ) : i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${s.done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                    {s.title}{s.optional && !s.done && <span className="ml-1.5 text-[11px] font-normal text-gray-400 no-underline">(opcional)</span>}
                  </p>
                  {s.hint && <p className="text-xs text-gray-500 mt-0.5">{s.hint}</p>}
                </div>
                {!s.done && s.action && (
                  s.action.href ? (
                    <Link href={s.action.href}
                      className={`ml-9 sm:ml-0 shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium ${isCurrent ? 'bg-blue-600 text-white hover:bg-blue-700' : 'text-blue-600 hover:bg-blue-50'}`}>
                      {s.action.label}
                    </Link>
                  ) : (
                    <button type="button" onClick={s.action.onClick}
                      className={`ml-9 sm:ml-0 shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium ${isCurrent ? 'bg-blue-600 text-white hover:bg-blue-700' : 'text-blue-600 hover:bg-blue-50'}`}>
                      {s.action.label}
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

export type ActiveFilter = { label: string; onRemove: () => void };

export function EmptyFiltered({ title, filters, onClearAll }: { title: string; filters: ActiveFilter[]; onClearAll: () => void }) {
  return (
    <div className="px-4 py-10 flex justify-center">
      <div className="w-full max-w-[540px] flex flex-col items-center text-center gap-3">
        <span className="grid place-items-center w-12 h-12 rounded-2xl bg-blue-50 text-blue-600">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        </span>
        <div>
          <h3 className="text-base font-bold text-gray-900">{title}</h3>
          <p className="text-sm text-gray-500 mt-1">Quita alguno de estos filtros para ampliar la búsqueda.</p>
        </div>
        {filters.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1.5">
            {filters.map((f) => (
              <span key={f.label} className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 pl-3 pr-1 py-1 text-[13px] font-medium text-gray-700 max-w-full">
                <span className="truncate">{f.label}</span>
                <button type="button" onClick={f.onRemove} aria-label={`Quitar filtro ${f.label}`}
                  className="grid place-items-center w-5 h-5 shrink-0 rounded-full bg-white text-gray-500 hover:text-red-600">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              </span>
            ))}
          </div>
        )}
        <button type="button" onClick={onClearAll} className="mt-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
          Limpiar todos los filtros
        </button>
      </div>
    </div>
  );
}

// Pasos comunes de las vistas de ventas/órdenes.
export function salesSetupSteps(setup: CompanySetup | null, opts: { canConnect: boolean; canPos: boolean; firstSaleTitle: string; firstSaleHint: string }): SetupStep[] {
  const created = setup?.companyCreatedAt ? new Date(setup.companyCreatedAt).toLocaleDateString('es-CL', { day: 'numeric', month: 'long' }) : '';
  return [
    { title: 'Crear tu empresa', hint: created ? `Hecho el ${created}` : undefined, done: true },
    {
      title: 'Conectar tu primer canal de venta',
      hint: opts.canConnect ? 'Mercado Libre, Falabella, Paris, Ripley, Walmart o tu tienda web.' : 'Pídele al administrador de la empresa que conecte un canal.',
      done: (setup?.connections ?? 0) > 0,
      action: opts.canConnect ? { label: 'Conectar', href: '/dashboard/ecommerce' } : undefined,
    },
    { title: opts.firstSaleTitle, hint: opts.firstSaleHint, done: false, action: opts.canPos ? { label: 'Punto de venta', href: '/dashboard/pos' } : undefined },
  ];
}

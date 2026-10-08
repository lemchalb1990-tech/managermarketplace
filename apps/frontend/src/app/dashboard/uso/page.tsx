'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { getToken } from '@/lib/auth';
import { api, type AiUsageReport, type PlanFeature } from '@/lib/api';
import { SectionCard } from '@/components/ui';
import { Skeleton, SkeletonCards, SkeletonTable } from '@/components/Skeleton';
import { useAdminCompany } from '../AdminCompanyContext';
import { useDashboardTimezone } from '@/lib/dashboardTimezone';

const icon = (path: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{path}</svg>
);

// Cada tipo de uso con su color de referencia: se repite en el plan, los contadores, el
// costo por uso y la tabla de últimos usos.
const TYPES: {
  kind: string;
  feature: PlanFeature;
  label: string;
  short: string;
  text: string;
  soft: string;
  border: string;
  icon: ReactNode;
}[] = [
  {
    kind: 'ML_DIAGNOSTIC', feature: 'ML_DIAGNOSTIC', label: 'Diagnóstico preliminar', short: 'Diagnóstico preliminar',
    text: 'text-emerald-700', soft: 'bg-emerald-50', border: 'border-l-emerald-500',
    icon: icon(<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></>),
  },
  {
    kind: 'PHOTO_CHECK', feature: 'AI_CHECK', label: 'Fotos revisadas', short: 'Revisión',
    text: 'text-sky-700', soft: 'bg-sky-50', border: 'border-l-sky-500',
    icon: icon(<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>),
  },
  {
    kind: 'PHOTO_FIX', feature: 'AI_FIX', label: 'Fotos corregidas', short: 'Corrección',
    text: 'text-violet-700', soft: 'bg-violet-50', border: 'border-l-violet-500',
    icon: icon(<><path d="m15 4 5 5" /><path d="M3 21l3.5-1L19 7.5 16.5 5 4 17.5z" /></>),
  },
  {
    kind: 'PHOTO_GENERATE', feature: 'AI_GENERATE', label: 'Fotos generadas', short: 'Foto generada',
    text: 'text-amber-700', soft: 'bg-amber-50', border: 'border-l-amber-500',
    icon: icon(<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></>),
  },
];
const byKind = Object.fromEntries(TYPES.map((t) => [t.kind, t]));

function TypeBadge({ kind }: { kind: string }) {
  const t = byKind[kind];
  if (!t) return <span className="text-xs text-[var(--text-muted)]">{kind}</span>;
  return <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${t.soft} ${t.text}`}>{t.short}</span>;
}

// Uso de la empresa: su plan, los créditos de IA que le quedan y lo que ha usado.
export default function UsagePage() {
  const { isSuperAdmin, selectedCompanyId, companyId } = useAdminCompany();
  const tz = useDashboardTimezone();
  const [data, setData] = useState<AiUsageReport | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token || (isSuperAdmin && !selectedCompanyId)) return;
    setData(null);
    setError('');
    api.ai.usage(token, companyId).then(setData).catch((e) => setError(e.message || 'No se pudo cargar el uso.'));
  }, [isSuperAdmin, selectedCompanyId, companyId]);

  const plan = data?.plan;
  const usesAi = !!plan?.features.some((f) => f !== 'ML_DIAGNOSTIC');
  const pct = (used: number, max: number | null | undefined) => (max ? Math.min(100, Math.round((used / max) * 100)) : 0);
  const costOf = (kind: string) => (kind === 'PHOTO_CHECK' ? data?.costs.PHOTO_CHECK : kind === 'PHOTO_FIX' ? data?.costs.PHOTO_FIX : data?.costs.PHOTO_GENERATE);

  return (
    <div className="space-y-4 max-w-5xl">

      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      {!data && !error && (
        // Mismo esqueleto de carga que las demás vistas.
        <div className="space-y-4">
          <SkeletonCards count={3} className="grid grid-cols-1 md:grid-cols-3 gap-3" height={120} />
          <div className="ui-card p-3 sm:p-5"><SkeletonCards count={4} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" height={130} /></div>
          <div className="ui-card p-3 sm:p-5 flex flex-wrap gap-2">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-7 w-40 rounded-full" />)}
          </div>
          <div className="ui-card"><SkeletonTable rows={6} cols={5} /></div>
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="ui-card p-4 sm:p-5">
              <p className="ui-stat-label">Plan</p>
              <p className="ui-stat-value text-[var(--text)]">{plan?.name ?? 'Sin plan'}</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {plan
                  ? TYPES.filter((t) => plan.features.includes(t.feature)).map((t) => <TypeBadge key={t.kind} kind={t.kind} />)
                  : <span className="text-xs text-[var(--text-muted)]">Pide al administrador de la plataforma que te asigne uno.</span>}
              </div>
            </div>
            {usesAi ? (
              ([
                { label: 'Créditos de hoy', used: data.usedToday, max: plan?.dailyCredits },
                { label: 'Créditos del mes', used: data.usedMonth, max: plan?.monthlyCredits },
              ]).map((c) => {
                const p = pct(c.used, c.max);
                return (
                  <div key={c.label} className="ui-card p-4 sm:p-5">
                    <p className="ui-stat-label">{c.label}</p>
                    <p className="ui-stat-value text-[var(--text)]">
                      {c.used}<span className="text-sm font-normal text-[var(--text-muted)]"> {c.max == null ? 'usados' : `de ${c.max}`}</span>
                    </p>
                    {c.max != null ? (
                      <>
                        <div className="h-1.5 bg-[var(--border-soft)] rounded-full mt-2 overflow-hidden">
                          <div className={`h-full rounded-full ${p >= 90 ? 'bg-[var(--danger)]' : p >= 70 ? 'bg-[var(--warn)]' : 'bg-[var(--ok)]'}`} style={{ width: `${p}%` }} />
                        </div>
                        <p className="text-xs text-[var(--text-muted)] mt-1">Quedan {Math.max(0, c.max - c.used)}</p>
                      </>
                    ) : (
                      <p className="text-xs font-semibold text-[var(--ok)] mt-1">Ilimitado</p>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="md:col-span-2 ui-card p-4 sm:p-5 flex items-center">
                <p className="text-sm text-[var(--text-2)]">{plan ? 'Tu plan no usa créditos.' : 'Sin plan no se pueden revisar fotos.'}</p>
              </div>
            )}
          </div>

          <SectionCard title="Lo que se ha usado">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {TYPES.map((t) => {
                const s = data.stats[t.kind] ?? { today: 0, month: 0, total: 0 };
                const included = !plan || plan.features.includes(t.feature);
                return (
                  <div key={t.kind} className={`rounded-xl border border-[var(--border-soft)] border-l-4 ${t.border} p-3.5 ${included ? '' : 'opacity-60'}`}>
                    <div className="flex items-center gap-2.5">
                      <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${t.soft} ${t.text}`}>{t.icon}</span>
                      <p className="text-sm font-semibold text-[var(--text)] leading-tight">{t.label}</p>
                    </div>
                    <p className={`text-2xl font-bold mt-3 ${t.text}`}>{s.month.toLocaleString('es-CL')}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">este mes</p>
                    <div className="flex justify-between text-[11px] text-[var(--text-2)] mt-2 pt-2 border-t border-[var(--border-soft)]">
                      <span>Hoy <strong>{s.today.toLocaleString('es-CL')}</strong></span>
                      <span>Total <strong>{s.total.toLocaleString('es-CL')}</strong></span>
                    </div>
                    {!included && <p className="text-[10px] text-[var(--text-muted)] mt-1">No incluido en tu plan</p>}
                  </div>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard title="Costo por uso">
            <div className="flex flex-wrap gap-2">
              {TYPES.filter((t) => !plan || plan.features.includes(t.feature)).map((t) => (
                <span key={t.kind} className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full ${t.soft} ${t.text}`}>
                  <span className="font-medium">{t.short}:</span>
                  {t.kind === 'ML_DIAGNOSTIC'
                    ? <span className="font-semibold text-[var(--ok)]">Ilimitado</span>
                    : <span className="font-semibold">{costOf(t.kind)} crédito{costOf(t.kind) === 1 ? '' : 's'} por foto</span>}
                </span>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Últimos usos">
            {data.recent.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">Todavía no hay usos registrados.</p>
            ) : (
              <div className="overflow-x-auto -mx-3 sm:-mx-5">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[var(--text-muted)] border-b border-[var(--border-soft)]">
                      <th className="px-3 sm:px-5 py-2 font-medium">Fecha</th>
                      <th className="px-3 py-2 font-medium">Uso</th>
                      <th className="px-3 py-2 font-medium">Producto</th>
                      <th className="px-3 py-2 font-medium">Usuario</th>
                      <th className="px-3 sm:px-5 py-2 font-medium text-right">Créditos</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-soft)]">
                    {data.recent.map((r) => (
                      <tr key={r.id}>
                        <td className="px-3 sm:px-5 py-2 whitespace-nowrap text-[var(--text-2)]">
                          {new Date(r.createdAt).toLocaleString('es-CL', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap"><TypeBadge kind={r.kind} /></td>
                        <td className="px-3 py-2 text-[var(--text)] max-w-[260px] truncate" title={r.product?.name}>{r.product ? r.product.name : '—'}</td>
                        <td className="px-3 py-2 text-[var(--text-2)] whitespace-nowrap">{r.userName ?? '—'}</td>
                        <td className="px-3 sm:px-5 py-2 text-right">
                          {r.credits ? r.credits : <span className="text-[var(--ok)] font-medium">Ilimitado</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}

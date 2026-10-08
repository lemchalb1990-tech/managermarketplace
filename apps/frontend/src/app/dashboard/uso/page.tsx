'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api, PLAN_FEATURE_INFO, type AiUsageReport, type PlanFeature } from '@/lib/api';
import { useAdminCompany } from '../AdminCompanyContext';
import { useDashboardTimezone } from '@/lib/dashboardTimezone';

const KIND_LABEL: Record<string, string> = {
  ML_DIAGNOSTIC: 'Fotos diagnosticadas por Mercado Libre',
  PHOTO_CHECK: 'Fotos revisadas con IA',
  PHOTO_FIX: 'Fotos corregidas con IA',
  PHOTO_GENERATE: 'Imágenes de referencia creadas',
};
const KIND_SHORT: Record<string, string> = {
  ML_DIAGNOSTIC: 'Diagnóstico ML',
  PHOTO_CHECK: 'Revisión con IA',
  PHOTO_FIX: 'Corrección con IA',
  PHOTO_GENERATE: 'Imagen de referencia',
};
const KIND_FEATURE: Record<string, PlanFeature> = {
  ML_DIAGNOSTIC: 'ML_DIAGNOSTIC', PHOTO_CHECK: 'AI_CHECK', PHOTO_FIX: 'AI_FIX', PHOTO_GENERATE: 'AI_GENERATE',
};

// Uso de la empresa: su plan, los créditos de IA que le quedan y lo que ha usado (revisión,
// corrección e imágenes de referencia, más las fotos diagnosticadas por Mercado Libre).
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
  const limit = (used: number, max: number | null | undefined) => (max == null ? `${used} usados · sin límite` : `${used} de ${max}`);
  const pct = (used: number, max: number | null | undefined) => (max ? Math.min(100, Math.round((used / max) * 100)) : 0);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="ui-page-title">Uso</h1>
        <p className="ui-page-subtitle">Tu plan, los créditos de IA disponibles y lo que se ha usado en la revisión de fotos.</p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data && !error && <p className="text-sm text-gray-400">Cargando…</p>}

      {data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <p className="text-xs text-gray-500">Plan</p>
              <p className="text-lg font-bold text-gray-900 mt-0.5">{plan?.name ?? 'Sin plan'}</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {plan
                  ? plan.features.map((f) => (
                      <span key={f} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">{PLAN_FEATURE_INFO[f]?.label ?? f}</span>
                    ))
                  : <span className="text-xs text-gray-500">Pide al administrador de la plataforma que te asigne uno.</span>}
              </div>
            </div>
            {usesAi ? (
              <>
                {([
                  { label: 'Créditos de hoy', used: data.usedToday, max: plan?.dailyCredits },
                  { label: 'Créditos del mes', used: data.usedMonth, max: plan?.monthlyCredits },
                ]).map((c) => (
                  <div key={c.label} className="bg-white border border-gray-200 rounded-2xl p-5">
                    <p className="text-xs text-gray-500">{c.label}</p>
                    <p className="text-lg font-bold text-gray-900 mt-0.5">{limit(c.used, c.max)}</p>
                    {c.max != null && (
                      <>
                        <div className="h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
                          <div className={`h-full rounded-full ${pct(c.used, c.max) >= 90 ? 'bg-red-500' : 'bg-blue-600'}`} style={{ width: `${pct(c.used, c.max)}%` }} />
                        </div>
                        <p className="text-[11px] text-gray-400 mt-1">Quedan {Math.max(0, c.max - c.used)}</p>
                      </>
                    )}
                  </div>
                ))}
              </>
            ) : (
              <div className="md:col-span-2 bg-white border border-gray-200 rounded-2xl p-5 flex items-center">
                <p className="text-sm text-gray-500">{plan ? 'Tu plan no usa créditos de IA.' : 'Sin plan no se pueden revisar fotos.'}</p>
              </div>
            )}
          </div>

          {usesAi && (
            <div className="bg-white border border-gray-200 rounded-2xl px-5 py-3 text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
              <span>Costo por uso:</span>
              {plan?.features.includes('AI_CHECK') && <span>Revisión con IA: {data.costs.PHOTO_CHECK} crédito(s) por foto</span>}
              {plan?.features.includes('AI_FIX') && <span>Corrección: {data.costs.PHOTO_FIX} por foto</span>}
              {plan?.features.includes('AI_GENERATE') && <span>Imagen de referencia: {data.costs.PHOTO_GENERATE} por imagen</span>}
              <span>Diagnóstico preliminar: <span className="font-semibold text-green-600">Ilimitado</span></span>
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
              <h2 className="ui-section-title">Lo que se ha usado</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 divide-gray-100">
              {Object.keys(KIND_LABEL)
                .filter((k) => !plan || plan.features.includes(KIND_FEATURE[k]) || (data.stats[k]?.total ?? 0) > 0)
                .map((k) => (
                  <div key={k} className="p-5 sm:border-b sm:border-gray-100 sm:odd:border-r">
                    <p className="text-sm font-medium text-gray-800">{KIND_LABEL[k]}</p>
                    <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                      {(['today', 'month', 'total'] as const).map((p) => (
                        <div key={p} className="bg-gray-50 rounded-lg py-2">
                          <p className="text-base font-bold text-gray-900">{(data.stats[k]?.[p] ?? 0).toLocaleString('es-CL')}</p>
                          <p className="text-[10px] text-gray-500">{p === 'today' ? 'Hoy' : p === 'month' ? 'Este mes' : 'Total'}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
              <h2 className="ui-section-title">Últimos usos</h2>
            </div>
            {data.recent.length === 0 ? (
              <p className="px-5 py-4 text-sm text-gray-500">Todavía no hay usos registrados.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                      <th className="px-5 py-2 font-medium">Fecha</th>
                      <th className="px-3 py-2 font-medium">Uso</th>
                      <th className="px-3 py-2 font-medium">Producto</th>
                      <th className="px-3 py-2 font-medium">Usuario</th>
                      <th className="px-5 py-2 font-medium text-right">Créditos</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.recent.map((r) => (
                      <tr key={r.id}>
                        <td className="px-5 py-2 whitespace-nowrap text-gray-600">
                          {new Date(r.createdAt).toLocaleString('es-CL', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{KIND_SHORT[r.kind] ?? r.kind}</td>
                        <td className="px-3 py-2 text-gray-700 max-w-[260px] truncate" title={r.product?.name}>{r.product ? r.product.name : '—'}</td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.userName ?? '—'}</td>
                        <td className="px-5 py-2 text-right">{r.credits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { clp, trafficLight } from './finanzas/finance-utils';

// Finanzas del mes en el panel de inicio: tarjetas con el mismo estilo que los indicadores del
// dashboard (ingresos, gastos y resultado vs. presupuesto). El mes va dentro de cada tarjeta y
// cada una lleva al módulo de Finanzas. Solo se muestra a quien tiene ese permiso (lo decide el
// dashboard).

const CARD_SHADOW: CSSProperties = { boxShadow: '0 10px 24px rgba(43,42,39,0.12), 0 2px 6px rgba(43,42,39,0.08)' };
const MONTHS_FULL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const ALERT_CLS: Record<string, string> = {
  danger: 'bg-red-50 border-red-200 text-red-700',
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
};

export default function DashboardFinance({ companyId }: { companyId?: string }) {
  const [data, setData] = useState<any>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    setData(null);
    setFailed(false);
    api.finance.summary(token, companyId, true).then(setData).catch(() => setFailed(true));
  }, [companyId]);

  if (failed) return null;

  const month = data ? MONTHS_FULL[data.month - 1] : '';
  const cards = data
    ? [
        { key: 'INCOME', label: `Ingresos de ${month}`, icon: '📈', color: 'bg-emerald-50 text-emerald-600', ...data.income },
        { key: 'EXPENSE', label: `Gastos de ${month}`, icon: '📉', color: 'bg-rose-50 text-rose-500', ...data.expense },
        { key: 'RESULT', label: `Resultado de ${month}`, icon: '📊', color: 'bg-sky-50 text-sky-600', ...data.result },
      ]
    : [];
  const alerts = data ? data.alerts.filter((a: any) => a.level !== 'info').slice(0, 3) : [];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {data
          ? cards.map((c) => {
              const light = c.key !== 'RESULT' ? trafficLight(c.key, c.budget, c.actual) : null;
              const pct = c.budget ? Math.round((c.actual / c.budget) * 100) : null;
              return (
                <Link key={c.key} href="/dashboard/finanzas" className="block">
                  <div className="ui-card p-5 flex items-start gap-4 h-full transition-shadow hover:shadow-md hover:border-[var(--border-strong,#d1d5db)]" style={CARD_SHADOW}>
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0 ${c.color}`}>{c.icon}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-[var(--text-muted)] font-medium mb-0.5">{c.label}</p>
                      <p className={`text-2xl font-bold leading-tight tracking-tight ${c.key === 'RESULT' && c.actual < 0 ? 'text-red-600' : 'text-[var(--text)]'}`}>
                        {clp(c.actual)}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                        <span className="text-[11px] text-[var(--text-muted)]">
                          {c.budget ? `Presupuesto ${clp(c.budget)}${pct != null ? ` · ${pct} %` : ''}` : 'Sin presupuesto definido'}
                        </span>
                        {light && <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${light.cls}`}>{light.label}</span>}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })
          : [0, 1, 2].map((i) => (
              <div key={i} className="ui-card p-5 h-[92px] animate-pulse" style={CARD_SHADOW}>
                <div className="h-3 w-24 bg-gray-100 rounded mb-3" />
                <div className="h-6 w-32 bg-gray-100 rounded" />
              </div>
            ))}
      </div>
      {alerts.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {alerts.map((a: any, i: number) => (
            <Link key={i} href="/dashboard/finanzas" className={`block px-3 py-2 border rounded-lg text-xs ${ALERT_CLS[a.level] || ALERT_CLS.warning}`}>{a.text}</Link>
          ))}
        </div>
      )}
    </div>
  );
}

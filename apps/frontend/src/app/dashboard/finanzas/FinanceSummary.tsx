'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { MONTHS, clp, trafficLight } from './finance-utils';
import { SkeletonCards } from '@/components/Skeleton';

const ALERT_CLS: Record<string, string> = {
  danger: 'bg-red-50 border-red-200 text-red-700',
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
  info: 'bg-blue-50 border-blue-200 text-blue-700',
};

// Resumen del mes: ingresos, gastos y resultado vs. presupuesto, saldo de bancos y caja,
// próximos vencimientos y alertas. `compact` es la versión del panel de inicio.
export default function FinanceSummary({ companyId, compact, version = 0 }: { companyId?: string; compact?: boolean; version?: number }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api.finance.summary(token, companyId).then(setData).catch((e) => setError(e.message || 'No se pudo cargar el resumen'));
  }, [companyId, version]);

  if (error) return compact ? null : <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>;
  if (!data) return <SkeletonCards count={4} />;

  const kpis = [
    { label: 'Ingresos', ...data.income, type: 'INCOME' },
    { label: 'Gastos', ...data.expense, type: 'EXPENSE' },
    { label: 'Resultado', ...data.result, type: 'RESULT' },
  ];
  const alerts = compact ? data.alerts.filter((a: any) => a.level !== 'info').slice(0, 4) : data.alerts;

  return (
    <div className={compact ? 'bg-white border border-gray-200 rounded-2xl p-5 space-y-4' : 'space-y-4'}>
      {compact && (
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">Finanzas · {MONTHS[data.month - 1]} {data.year}</h2>
          <Link href="/dashboard/finanzas" className="text-xs text-blue-600 hover:text-blue-800 font-medium">Ver finanzas →</Link>
        </div>
      )}

      <div className={`grid gap-3 ${compact ? 'grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'}`}>
        {kpis.map((k) => {
          const light = k.type !== 'RESULT' ? trafficLight(k.type, k.budget, k.actual) : null;
          return (
            <div key={k.label} className={compact ? 'border border-gray-100 rounded-xl p-3' : 'bg-white border border-gray-200 rounded-2xl p-4'}>
              <p className="text-xs text-gray-500">{k.label} del mes</p>
              <p className={`text-xl font-bold mt-0.5 ${k.type === 'RESULT' && k.actual < 0 ? 'text-red-600' : 'text-gray-900'}`}>{clp(k.actual)}</p>
              <p className="text-[11px] text-gray-500">
                Presupuesto {clp(k.budget)}{k.budget ? ` · ${Math.round((k.actual / k.budget) * 100)} %` : ''}
              </p>
              {light && <span className={`inline-block mt-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${light.cls}`}>{light.label}</span>}
            </div>
          );
        })}
        {/* Bancos y caja: solo en la página de Finanzas, no en el panel de inicio. */}
        {!compact && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <p className="text-xs text-gray-500">Bancos y caja</p>
          <p className={`text-xl font-bold mt-0.5 ${data.cash.total < 0 ? 'text-red-600' : 'text-gray-900'}`}>
            {data.cash.accounts.length ? clp(data.cash.total) : '—'}
          </p>
          <p className="text-[11px] text-gray-500">
            {data.cash.accounts.length ? `${data.cash.accounts.length} cuenta(s)` : 'Sin cuentas registradas'}
          </p>
        </div>
        )}
      </div>

      {alerts.length > 0 && (
        <div className="space-y-1.5">
          {alerts.map((a: any, i: number) => (
            <div key={i} className={`px-3 py-2 border rounded-lg text-xs ${ALERT_CLS[a.level]}`}>{a.text}</div>
          ))}
        </div>
      )}

      {!compact && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-2">Saldos</h3>
            {!data.cash.accounts.length ? (
              <p className="text-xs text-gray-400">Registra tus cuentas bancarias y caja en la pestaña "Bancos y caja".</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {data.cash.accounts.map((b: any) => (
                  <li key={b.id} className="flex justify-between">
                    <span className="text-gray-700">{b.name}</span>
                    <span className={`font-medium ${b.balance < 0 ? 'text-red-600' : 'text-gray-900'}`}>{clp(b.balance)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-2">Próximos 7 días</h3>
            {!data.upcoming.length ? (
              <p className="text-xs text-gray-400">Sin vencimientos de gastos recurrentes.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {data.upcoming.map((r: any) => (
                  <li key={r.id} className="flex justify-between gap-2">
                    <span className="text-gray-700">
                      <span className="text-xs text-gray-400 mr-2">{r.date.split('-').reverse().slice(0, 2).join('-')}</span>
                      {r.description}
                    </span>
                    <span className="font-medium text-gray-900">{clp(r.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

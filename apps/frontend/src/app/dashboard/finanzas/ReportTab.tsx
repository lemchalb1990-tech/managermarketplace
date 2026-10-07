'use client';

import { useEffect, useMemo, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { MONTHS, clp, flattenTree, sum, trafficLight } from './finance-utils';
import { SkeletonCards, SkeletonTable } from '@/components/Skeleton';

type Period = 'month' | 'ytd' | 'year';

export default function ReportTab({ year, companyId, version }: { year: number; companyId?: string; version: number }) {
  const now = new Date();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState<Period>('month');
  const [month, setMonth] = useState(now.getFullYear() === year ? now.getMonth() : 0);
  const [hideEmpty, setHideEmpty] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError('');
    api.finance.report(year, getToken()!, companyId)
      .then(setData)
      .catch((e) => setError(e.message || 'No se pudo cargar el reporte'))
      .finally(() => setLoading(false));
  }, [year, companyId, version]);

  // Rango de meses [desde, hasta) según el período elegido.
  const [from, to] = period === 'month' ? [month, month + 1] : period === 'ytd' ? [0, month + 1] : [0, 12];

  const rows = useMemo(() => {
    if (!data) return [];
    return flattenTree<any>(data.accounts)
      .map((a) => ({ ...a, b: sum(a.budget, from, to), r: sum(a.actual, from, to), auto: sum(a.automatic, from, to) }))
      .filter((a) => !hideEmpty || a.b || a.r || a.depth === 0)
      .filter((a) => !a.archived || a.b || a.r);
  }, [data, from, to, hideEmpty]);

  if (loading) return <div className="space-y-4"><SkeletonCards count={4} /><SkeletonTable rows={6} cols={5} /></div>;
  if (error) return <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const t = data.totals;
  const income = { b: sum(t.INCOME.budget, from, to), r: sum(t.INCOME.actual, from, to) };
  const expense = { b: sum(t.EXPENSE.budget, from, to), r: sum(t.EXPENSE.actual, from, to) };
  const periodLabel = period === 'month' ? `${MONTHS[month]} ${year}` : period === 'ytd' ? `Ene–${MONTHS[month]} ${year}` : `Año ${year}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(['month', 'ytd', 'year'] as Period[]).map((p) => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${period === p ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            {p === 'month' ? 'Mes' : p === 'ytd' ? 'Acumulado' : 'Año completo'}
          </button>
        ))}
        {period !== 'year' && (
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs">
            {MONTHS.map((m, i) => <option key={m} value={i}>{period === 'ytd' ? `hasta ${m}` : m}</option>)}
          </select>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
          <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
          Ocultar cuentas sin presupuesto ni movimientos
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: 'Ingresos', ...income, type: 'INCOME' },
          { label: 'Gastos', ...expense, type: 'EXPENSE' },
          { label: 'Resultado', b: income.b - expense.b, r: income.r - expense.r, type: 'INCOME' },
        ].map((k) => {
          const light = k.label !== 'Resultado' ? trafficLight(k.type, k.b, k.r) : null;
          return (
            <div key={k.label} className="bg-white border border-gray-200 rounded-2xl p-4">
              <p className="text-xs text-gray-500">{k.label} · {periodLabel}</p>
              <p className={`text-2xl font-bold mt-1 ${k.label === 'Resultado' && k.r < 0 ? 'text-red-600' : 'text-gray-900'}`}>{clp(k.r)}</p>
              <p className="text-xs text-gray-500 mt-1">
                Presupuesto {clp(k.b)}
                {k.b ? ` · ${Math.round((k.r / k.b) * 100)} %` : ''}
              </p>
              {light && <span className={`inline-block mt-2 px-2 py-0.5 rounded-full text-[11px] font-medium ${light.cls}`}>{light.label}</span>}
            </div>
          );
        })}
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-gray-600">
              <th className="text-left px-4 py-2.5 font-medium">Cuenta</th>
              <th className="text-right px-3 py-2.5 font-medium">Presupuesto</th>
              <th className="text-right px-3 py-2.5 font-medium">Real</th>
              <th className="text-right px-3 py-2.5 font-medium">Diferencia</th>
              <th className="text-left px-3 py-2.5 font-medium w-40">Avance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((a) => {
              const diff = a.type === 'EXPENSE' ? a.b - a.r : a.r - a.b;
              const pct = a.b ? Math.round((a.r / a.b) * 100) : null;
              const light = trafficLight(a.type, a.b, a.r);
              return (
                <tr key={a.id} className={a.depth === 0 ? 'bg-gray-50/60' : ''}>
                  <td className="px-4 py-2" style={{ paddingLeft: 16 + a.depth * 18 }}>
                    <span className={`${a.hasChildren ? 'font-semibold text-gray-900' : 'text-gray-700'} ${a.archived ? 'line-through text-gray-400' : ''}`}>
                      {a.code && <span className="text-gray-400 font-mono text-xs mr-1.5">{a.code}</span>}
                      {a.name}
                    </span>
                    {a.systemKey && (
                      <span className="ml-2 px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 text-[10px] font-medium"
                        title="Se calcula solo desde ventas, comisiones, despachos o compras">auto</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600">{a.b ? clp(a.b) : '—'}</td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900" title={a.auto ? `Incluye ${clp(a.auto)} automático` : undefined}>
                    {a.r ? clp(a.r) : '—'}
                  </td>
                  <td className={`px-3 py-2 text-right ${a.b ? (diff < 0 ? 'text-red-600' : 'text-emerald-700') : 'text-gray-300'}`}>
                    {a.b ? clp(diff) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {pct != null ? (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full ${light?.cls.includes('red') ? 'bg-red-500' : light?.cls.includes('amber') ? 'bg-amber-400' : 'bg-emerald-500'}`}
                            style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                        <span className="text-xs text-gray-600 w-10 text-right">{pct} %</span>
                      </div>
                    ) : <span className="text-xs text-gray-300">sin presupuesto</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">
        En gastos, la diferencia positiva es lo que queda disponible; en ingresos, lo que se superó la meta.
      </p>
    </div>
  );
}

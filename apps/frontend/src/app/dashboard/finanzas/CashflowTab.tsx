'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { MONTHS, clp } from './finance-utils';

// Proyección de saldo de los próximos meses: saldo actual de bancos y caja + resultado
// presupuestado de cada mes (o el promedio real de los últimos 3 meses si no hay presupuesto).
export default function CashflowTab({ companyId, version }: { companyId?: string; version: number }) {
  const [months, setMonths] = useState(6);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    api.finance.cashflow(months, getToken()!, companyId).then(setData).catch((e) => setError(e.message || 'No se pudo calcular el flujo'));
  }, [months, companyId, version]);

  if (error) return <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>;
  if (!data) return <div className="p-10 text-center text-gray-400 text-sm">Calculando...</div>;

  const max = Math.max(1, ...data.rows.map((r: any) => Math.abs(r.balance)), Math.abs(data.startBalance));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-gray-600">Proyectar</span>
        {[3, 6, 12].map((m) => (
          <button key={m} onClick={() => setMonths(m)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${months === m ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            {m} meses
          </button>
        ))}
        <span className="ml-auto text-sm text-gray-600">
          Saldo actual: <b className={data.startBalance < 0 ? 'text-red-600' : 'text-gray-900'}>{clp(data.startBalance)}</b>
        </span>
      </div>

      {!data.hasBankAccounts && (
        <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          No hay cuentas bancarias ni caja registradas: la proyección parte de $0. Regístralas en "Bancos y caja" para partir del saldo real.
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Mes</th>
              <th className="text-right px-3 py-2.5 font-medium">Ingresos</th>
              <th className="text-right px-3 py-2.5 font-medium">Gastos</th>
              <th className="text-right px-3 py-2.5 font-medium">Resultado</th>
              <th className="text-right px-3 py-2.5 font-medium">Saldo proyectado</th>
              <th className="px-3 py-2.5 w-1/4" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.rows.map((r: any, i: number) => (
              <tr key={`${r.year}-${r.month}`}>
                <td className="px-4 py-2">
                  <span className="font-medium text-gray-800">{MONTHS[r.month - 1]} {r.year}</span>
                  <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${r.source === 'budget' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                    {r.source === 'budget' ? 'presupuesto' : 'promedio'}
                  </span>
                  {i === 0 && <span className="ml-1 text-[10px] text-gray-400">(lo que falta del mes)</span>}
                </td>
                <td className="px-3 py-2 text-right text-emerald-700">{clp(r.income)}</td>
                <td className="px-3 py-2 text-right text-orange-700">{clp(r.expense)}</td>
                <td className={`px-3 py-2 text-right font-medium ${r.net < 0 ? 'text-red-600' : 'text-gray-900'}`}>{clp(r.net)}</td>
                <td className={`px-3 py-2 text-right font-semibold ${r.balance < 0 ? 'text-red-600' : 'text-gray-900'}`}>{clp(r.balance)}</td>
                <td className="px-3 py-2">
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full ${r.balance < 0 ? 'bg-red-400' : 'bg-emerald-500'}`} style={{ width: `${(Math.abs(r.balance) / max) * 100}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">
        Estimación sin IVA. Los meses sin presupuesto usan el promedio real de los últimos 3 meses
        (ingresos {clp(data.averages.income)}, gastos {clp(data.averages.expense)}). El mes en curso proyecta solo lo que falta según su presupuesto.
      </p>
    </div>
  );
}

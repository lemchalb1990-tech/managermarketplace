'use client';

import { useState } from 'react';
import { useAdminCompany } from '../AdminCompanyContext';
import ReportTab from './ReportTab';
import BudgetTab from './BudgetTab';
import MovementsTab from './MovementsTab';
import AccountsTab from './AccountsTab';

const TABS = [
  { key: 'report', label: 'Presupuesto vs. real' },
  { key: 'budget', label: 'Presupuesto' },
  { key: 'movements', label: 'Movimientos' },
  { key: 'accounts', label: 'Plan de cuentas' },
] as const;

type TabKey = typeof TABS[number]['key'];

export default function FinanzasPage() {
  const { isSuperAdmin, selectedCompanyId } = useAdminCompany();
  const companyId = isSuperAdmin ? selectedCompanyId || undefined : undefined;
  const [tab, setTab] = useState<TabKey>('report');
  const [year, setYear] = useState(new Date().getFullYear());
  // Cambia cuando una pestaña modifica datos, para que las demás recarguen al volver.
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Finanzas</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Montos sin IVA. Ventas, comisiones, despachos y compras se suman solos; el resto se registra en Movimientos.
          </p>
        </div>
        {tab !== 'accounts' && tab !== 'movements' && (
          <div className="flex items-center gap-2">
            <button onClick={() => setYear((y) => y - 1)} className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">←</button>
            <span className="text-sm font-semibold text-gray-800 w-12 text-center">{year}</span>
            <button onClick={() => setYear((y) => y + 1)} className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">→</button>
          </div>
        )}
      </div>

      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px ${
              tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'report' && <ReportTab year={year} companyId={companyId} version={version} />}
      {tab === 'budget' && <BudgetTab year={year} companyId={companyId} version={version} onSaved={bump} />}
      {tab === 'movements' && <MovementsTab companyId={companyId} version={version} onChanged={bump} />}
      {tab === 'accounts' && <AccountsTab companyId={companyId} onChanged={bump} />}
    </div>
  );
}

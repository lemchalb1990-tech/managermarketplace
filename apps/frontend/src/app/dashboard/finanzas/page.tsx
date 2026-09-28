'use client';

import { useState } from 'react';
import { useAdminCompany } from '../AdminCompanyContext';
import FinanceSummary from './FinanceSummary';
import ReportTab from './ReportTab';
import BudgetTab from './BudgetTab';
import MovementsTab from './MovementsTab';
import BanksTab from './BanksTab';
import RecurringTab from './RecurringTab';
import CashflowTab from './CashflowTab';
import AccountsTab from './AccountsTab';

const TABS = [
  { key: 'summary', label: 'Resumen' },
  { key: 'report', label: 'Presupuesto vs. real' },
  { key: 'budget', label: 'Presupuesto' },
  { key: 'movements', label: 'Movimientos' },
  { key: 'banks', label: 'Bancos y caja' },
  { key: 'recurring', label: 'Recurrentes' },
  { key: 'cashflow', label: 'Flujo de caja' },
  { key: 'accounts', label: 'Plan de cuentas' },
] as const;

type TabKey = typeof TABS[number]['key'];
const YEAR_TABS: TabKey[] = ['report', 'budget'];

export default function FinanzasPage() {
  const { isSuperAdmin, selectedCompanyId } = useAdminCompany();
  const companyId = isSuperAdmin ? selectedCompanyId || undefined : undefined;
  const [tab, setTab] = useState<TabKey>('summary');
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
            Presupuesto y resultados sin IVA. Ventas, comisiones, despachos y compras se suman solos.
          </p>
        </div>
        {YEAR_TABS.includes(tab) && (
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

      {tab === 'summary' && <FinanceSummary companyId={companyId} version={version} />}
      {tab === 'report' && <ReportTab year={year} companyId={companyId} version={version} />}
      {tab === 'budget' && <BudgetTab year={year} companyId={companyId} version={version} onSaved={bump} />}
      {tab === 'movements' && <MovementsTab companyId={companyId} version={version} onChanged={bump} />}
      {tab === 'banks' && <BanksTab companyId={companyId} version={version} onChanged={bump} />}
      {tab === 'recurring' && <RecurringTab companyId={companyId} version={version} onChanged={bump} />}
      {tab === 'cashflow' && <CashflowTab companyId={companyId} version={version} />}
      {tab === 'accounts' && <AccountsTab companyId={companyId} onChanged={bump} />}
    </div>
  );
}

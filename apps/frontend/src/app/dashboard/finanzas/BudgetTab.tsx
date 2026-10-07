'use client';

import { useEffect, useMemo, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { alertDialog, confirmDialog } from '../ConfirmDialog';
import { MONTHS, TYPE_LABEL, clp, flattenTree } from './finance-utils';
import { SkeletonTable } from '@/components/Skeleton';

const key = (accountId: string, month: number) => `${accountId}:${month}`;
const parse = (v: string) => Number(String(v).replace(/[^\d]/g, '')) || 0;

// Grilla cuentas × meses. Se presupuesta en las subcuentas (hojas); las cuentas madre muestran
// la suma en vivo. Solo se guardan las celdas modificadas.
export default function BudgetTab({ year, companyId, version, onSaved }: { year: number; companyId?: string; version: number; onSaved: () => void }) {
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [values, setValues] = useState<Record<string, number>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [copy, setCopy] = useState({ source: 'actual' as 'budget' | 'actual', percent: '0', type: '' });
  const [copying, setCopying] = useState(false);

  const load = () => {
    setLoading(true);
    setError('');
    api.finance.report(year, getToken()!, companyId)
      .then((r) => {
        setReport(r);
        const v: Record<string, number> = {};
        for (const a of r.accounts) a.ownBudget.forEach((amount: number, i: number) => { if (amount) v[key(a.id, i + 1)] = amount; });
        setValues(v);
        setDirty(new Set());
      })
      .catch((e) => setError(e.message || 'No se pudo cargar el presupuesto'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [year, companyId, version]);

  const rows = useMemo(() => (report ? flattenTree<any>(report.accounts).filter((a) => !a.archived) : []), [report]);

  // Suma de una cuenta (propia + subcuentas) en un mes, con los valores que se están editando.
  const childrenOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of rows) if (a.parentId) m.set(a.parentId, [...(m.get(a.parentId) || []), a.id]);
    return m;
  }, [rows]);
  const cell = (accountId: string, month: number): number =>
    (values[key(accountId, month)] || 0) + (childrenOf.get(accountId) || []).reduce((s, c) => s + cell(c, month), 0);

  const setCell = (accountId: string, month: number, amount: number) => {
    setValues((v) => ({ ...v, [key(accountId, month)]: amount }));
    setDirty((d) => new Set(d).add(key(accountId, month)));
  };

  const repeatFirst = (accountId: string) => {
    const first = Array.from({ length: 12 }, (_, i) => values[key(accountId, i + 1)] || 0).find((v) => v > 0) || 0;
    for (let m = 1; m <= 12; m++) setCell(accountId, m, first);
  };

  async function save() {
    setSaving(true);
    try {
      const entries = [...dirty].map((k) => {
        const [accountId, month] = k.split(':');
        return { accountId, month: Number(month), amount: values[k] || null };
      });
      await api.finance.saveBudgets({ year, entries, companyId }, getToken()!);
      setDirty(new Set());
      onSaved();
    } catch (e: any) {
      await alertDialog(e.message || 'No se pudo guardar el presupuesto');
    } finally {
      setSaving(false);
    }
  }

  async function copyFrom() {
    const pct = Number(copy.percent) || 0;
    const what = copy.source === 'actual' ? `lo real de ${year - 1}` : `el presupuesto de ${year - 1}`;
    const ok = await confirmDialog(
      `¿Cargar el presupuesto ${year} con ${what}${pct ? ` ${pct > 0 ? '+' : ''}${pct} %` : ''}? Reemplaza los meses de las cuentas que tengan monto en ${year - 1}; el resto no se toca.`,
    );
    if (!ok) return;
    setCopying(true);
    try {
      const res = await api.finance.copyBudget({ fromYear: year - 1, toYear: year, source: copy.source, percent: pct, type: copy.type || undefined, companyId }, getToken()!);
      await alertDialog(res.saved ? `Se cargaron ${res.saved} montos mensuales.` : `No hay montos en ${year - 1} para copiar.`);
      onSaved();
    } catch (e: any) {
      await alertDialog(e.message || 'No se pudo copiar el presupuesto');
    } finally {
      setCopying(false);
    }
  }

  if (loading) return <SkeletonTable rows={8} cols={6} />;
  if (error) return <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>;

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-2xl p-4 flex flex-wrap items-end gap-3 text-sm">
        <div>
          <p className="text-xs text-gray-500 mb-1">Cargar desde {year - 1}</p>
          <select value={copy.source} onChange={(e) => setCopy({ ...copy, source: e.target.value as any })}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="actual">Lo real de {year - 1}</option>
            <option value="budget">El presupuesto de {year - 1}</option>
          </select>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Ajuste %</p>
          <input value={copy.percent} onChange={(e) => setCopy({ ...copy, percent: e.target.value.replace(/[^\d-]/g, '') })}
            className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Cuentas</p>
          <select value={copy.type} onChange={(e) => setCopy({ ...copy, type: e.target.value })}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="">Ingresos y gastos</option>
            <option value="INCOME">Solo ingresos</option>
            <option value="EXPENSE">Solo gastos</option>
          </select>
        </div>
        <button onClick={copyFrom} disabled={copying || dirty.size > 0}
          title={dirty.size ? 'Guarda o descarta los cambios primero' : undefined}
          className="px-3 py-1.5 border border-blue-300 bg-blue-50 text-blue-700 rounded-lg text-sm font-semibold hover:bg-blue-100 disabled:opacity-50">
          {copying ? 'Cargando...' : 'Cargar'}
        </button>
        <div className="ml-auto flex items-center gap-2">
          {dirty.size > 0 && (
            <button onClick={load} disabled={saving} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
              Descartar
            </button>
          )}
          <button onClick={save} disabled={saving || dirty.size === 0}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
            {saving ? 'Guardando...' : dirty.size ? `Guardar (${dirty.size})` : 'Guardado'}
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-x-auto">
        <table className="text-xs min-w-full">
          <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
            <tr>
              <th className="text-left px-3 py-2 font-medium sticky left-0 bg-gray-50 min-w-[220px]">Cuenta</th>
              {MONTHS.map((m) => <th key={m} className="text-right px-1.5 py-2 font-medium min-w-[92px]">{m}</th>)}
              <th className="text-right px-3 py-2 font-medium min-w-[110px]">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((a) => {
              const editable = !a.hasChildren;
              const total = Array.from({ length: 12 }, (_, i) => cell(a.id, i + 1)).reduce((s, v) => s + v, 0);
              return (
                <tr key={a.id} className={a.hasChildren ? 'bg-gray-50/60' : ''}>
                  <td className="px-3 py-1.5 sticky left-0 bg-white" style={{ paddingLeft: 12 + a.depth * 16 }}>
                    <div className="flex items-center gap-2">
                      <span className={a.hasChildren ? 'font-semibold text-gray-900' : 'text-gray-700'}>
                        {a.depth === 0 ? `${a.name} (${TYPE_LABEL[a.type]})` : a.name}
                      </span>
                      {editable && (
                        <button onClick={() => repeatFirst(a.id)} title="Repetir el primer monto en todos los meses"
                          className="text-[10px] text-blue-500 hover:text-blue-700">repetir</button>
                      )}
                    </div>
                  </td>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <td key={m} className="px-1 py-1 text-right">
                      {editable ? (
                        <input
                          value={values[key(a.id, m)] ? Math.round(values[key(a.id, m)]).toLocaleString('es-CL') : ''}
                          onChange={(e) => setCell(a.id, m, parse(e.target.value))}
                          placeholder="—"
                          className={`w-full text-right border rounded px-1.5 py-1 ${dirty.has(key(a.id, m)) ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}`}
                        />
                      ) : (
                        <span className="text-gray-700 font-medium">{cell(a.id, m) ? clp(cell(a.id, m)) : '—'}</span>
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right font-semibold text-gray-900">{total ? clp(total) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">
        Se presupuesta en las subcuentas; las cuentas que agrupan otras suman solas. Montos sin IVA.
      </p>
    </div>
  );
}

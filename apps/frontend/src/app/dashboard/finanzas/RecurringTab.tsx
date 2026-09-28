'use client';

import { useEffect, useMemo, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { alertDialog, confirmDialog } from '../ConfirmDialog';
import { PAYMENT_LABEL, TYPE_LABEL, clp, flattenTree, todayKey } from './finance-utils';

const INTERVALS: Record<number, string> = { 1: 'Mensual', 2: 'Bimestral', 3: 'Trimestral', 6: 'Semestral', 12: 'Anual' };
const emptyForm = {
  accountId: '', description: '', amount: '', withIva: false, counterparty: '', paymentMethod: '', bankAccountId: '',
  dayOfMonth: '5', intervalMonths: '1', startDate: todayKey(), endDate: '', active: true,
};

// Gastos (o ingresos) que se repiten. El sistema genera el movimiento solo, el día indicado.
export default function RecurringTab({ companyId, version, onChanged }: { companyId?: string; version: number; onChanged: () => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [banks, setBanks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = () => {
    const token = getToken()!;
    setLoading(true);
    Promise.all([api.finance.recurrings(token, companyId), api.finance.accounts(token, companyId), api.finance.bankAccounts(token, companyId)])
      .then(([r, a, b]) => { setItems(r); setAccounts(a); setBanks(b.filter((x: any) => !x.archived)); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, [companyId, version]);

  const leafAccounts = useMemo(() => flattenTree<any>(accounts).filter((a) => !a.hasChildren && !a.archived && !a.systemKey), [accounts]);

  const openNew = () => { setForm({ ...emptyForm, startDate: todayKey() }); setEditing({}); };
  const openEdit = (r: any) => {
    const tax = Number(r.tax);
    setForm({
      accountId: r.accountId, description: r.description, amount: String(Math.round(Number(r.amount) + tax)), withIva: tax > 0,
      counterparty: r.counterparty || '', paymentMethod: r.paymentMethod || '', bankAccountId: r.bankAccountId || '',
      dayOfMonth: String(r.dayOfMonth), intervalMonths: String(r.intervalMonths), startDate: String(r.startDate).slice(0, 10),
      endDate: r.endDate ? String(r.endDate).slice(0, 10) : '', active: r.active,
    });
    setEditing(r);
  };

  async function save() {
    const total = Number(form.amount.replace(/[^\d]/g, ''));
    if (!form.accountId || !total || !form.description.trim()) { await alertDialog('Completa la cuenta, el monto y la descripción.'); return; }
    const net = form.withIva ? Math.round(total / 1.19) : total;
    setSaving(true);
    try {
      const payload = {
        accountId: form.accountId, description: form.description, amount: net, tax: total - net,
        counterparty: form.counterparty || undefined, paymentMethod: form.paymentMethod || undefined, bankAccountId: form.bankAccountId || null,
        dayOfMonth: Number(form.dayOfMonth), intervalMonths: Number(form.intervalMonths), startDate: form.startDate,
        endDate: form.endDate || null, active: form.active, companyId,
      };
      const token = getToken()!;
      if (editing?.id) await api.finance.updateRecurring(editing.id, payload, token);
      else await api.finance.createRecurring(payload, token);
      setEditing(null);
      load();
      onChanged();
    } catch (e: any) {
      await alertDialog(e.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  async function toggle(r: any) {
    try {
      await api.finance.updateRecurring(r.id, {
        accountId: r.accountId, description: r.description, amount: Number(r.amount), tax: Number(r.tax), counterparty: r.counterparty || undefined,
        paymentMethod: r.paymentMethod || undefined, bankAccountId: r.bankAccountId, dayOfMonth: r.dayOfMonth, intervalMonths: r.intervalMonths,
        startDate: String(r.startDate).slice(0, 10), endDate: r.endDate ? String(r.endDate).slice(0, 10) : null, active: !r.active, companyId,
      }, getToken()!);
      load();
      onChanged();
    } catch (e: any) {
      await alertDialog(e.message || 'No se pudo actualizar');
    }
  }

  async function remove(r: any) {
    if (!(await confirmDialog(`¿Eliminar "${r.description}"? Los movimientos ya generados se conservan.`, { danger: true }))) return;
    try {
      await api.finance.deleteRecurring(r.id, getToken()!);
      load();
      onChanged();
    } catch (e: any) {
      await alertDialog(e.message || 'No se pudo eliminar');
    }
  }

  const monthlyTotal = items.filter((r) => r.active).reduce((s, r) => s + (Number(r.amount) + Number(r.tax)) / r.intervalMonths, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={openNew} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold">+ Nuevo recurrente</button>
        <p className="text-xs text-gray-500">
          Arriendo, sueldos, suscripciones… Se registran solos cada período. Equivalente mensual activo: <b>{clp(monthlyTotal)}</b>
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 text-xs">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Descripción</th>
              <th className="text-left px-3 py-2 font-medium">Cuenta</th>
              <th className="text-left px-3 py-2 font-medium">Frecuencia</th>
              <th className="text-left px-3 py-2 font-medium">Próximo</th>
              <th className="text-right px-3 py-2 font-medium">Monto</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Cargando...</td></tr>
            ) : !items.length ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Sin gastos recurrentes.</td></tr>
            ) : items.map((r) => (
              <tr key={r.id} className={r.active ? '' : 'opacity-50'}>
                <td className="px-4 py-2">
                  <p className="text-gray-800">{r.description}</p>
                  <p className="text-[11px] text-gray-400">{[r.counterparty, r.bankAccount?.name, `${r._count.movements} generado(s)`].filter(Boolean).join(' · ')}</p>
                </td>
                <td className="px-3 py-2 text-xs text-gray-600">{r.account.name}</td>
                <td className="px-3 py-2 text-xs text-gray-600">{INTERVALS[r.intervalMonths] || `Cada ${r.intervalMonths} meses`}, día {r.dayOfMonth}</td>
                <td className="px-3 py-2 text-xs text-gray-600">
                  {!r.active ? 'Pausado' : r.nextDate ? r.nextDate.split('-').reverse().join('-') : 'Terminado'}
                </td>
                <td className="px-3 py-2 text-right font-medium text-gray-900">
                  {clp(Number(r.amount) + Number(r.tax))}
                  {Number(r.tax) > 0 && <span className="block text-[10px] text-gray-400 font-normal">neto {clp(Number(r.amount))}</span>}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap text-xs">
                  <button onClick={() => openEdit(r)} className="text-blue-600 hover:text-blue-800 font-medium mr-3">Editar</button>
                  <button onClick={() => toggle(r)} className="text-gray-500 hover:text-gray-800 mr-3">{r.active ? 'Pausar' : 'Reanudar'}</button>
                  <button onClick={() => remove(r)} className="text-red-500 hover:text-red-700">Eliminar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-3 max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold text-gray-900">{editing.id ? 'Editar recurrente' : 'Nuevo recurrente'}</h3>
            <div>
              <label className="text-xs text-gray-500">Cuenta</label>
              <select value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm mt-1">
                <option value="">Elige una cuenta…</option>
                {(['EXPENSE', 'INCOME'] as const).map((type) => (
                  <optgroup key={type} label={TYPE_LABEL[type]}>
                    {leafAccounts.filter((a) => a.type === type).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500">Descripción</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Ej: Arriendo bodega"
                className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500">Monto a pagar</label>
                <input value={form.amount ? Number(form.amount).toLocaleString('es-CL') : ''} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d]/g, '') })}
                  placeholder="$0" className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm mt-1 text-right" />
                <label className="flex items-center gap-1.5 text-[11px] text-gray-500 mt-1 cursor-pointer">
                  <input type="checkbox" checked={form.withIva} onChange={(e) => setForm({ ...form, withIva: e.target.checked })} />
                  Incluye IVA (con factura)
                </label>
              </div>
              <div>
                <label className="text-xs text-gray-500">Pagar desde</label>
                <select value={form.bankAccountId} onChange={(e) => setForm({ ...form, bankAccountId: e.target.value })} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm mt-1">
                  <option value="">—</option>
                  {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-gray-500">Frecuencia</label>
                <select value={form.intervalMonths} onChange={(e) => setForm({ ...form, intervalMonths: e.target.value })} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm mt-1">
                  {Object.entries(INTERVALS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500">Día del mes</label>
                <input type="number" min={1} max={31} value={form.dayOfMonth} onChange={(e) => setForm({ ...form, dayOfMonth: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm mt-1" />
              </div>
              <div>
                <label className="text-xs text-gray-500">Medio de pago</label>
                <select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm mt-1">
                  <option value="">—</option>
                  {Object.entries(PAYMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500">Desde</label>
                <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm mt-1" />
              </div>
              <div>
                <label className="text-xs text-gray-500">Hasta (opcional)</label>
                <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm mt-1" />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500">Proveedor / contraparte</label>
              <input value={form.counterparty} onChange={(e) => setForm({ ...form, counterparty: e.target.value })} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm mt-1" />
            </div>
            <p className="text-[11px] text-gray-400">Si el día no existe en un mes (p. ej. 31 en febrero), se usa el último día. Los períodos ya vencidos desde la fecha de inicio se registran al guardar.</p>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setEditing(null)} disabled={saving} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">Cancelar</button>
              <button onClick={save} disabled={saving} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

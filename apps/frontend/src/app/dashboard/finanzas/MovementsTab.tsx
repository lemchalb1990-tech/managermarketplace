'use client';

import { useEffect, useMemo, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api, imgUrl } from '@/lib/api';
import { alertDialog, confirmDialog } from '../ConfirmDialog';
import { MONTHS, PAYMENT_LABEL, TYPE_LABEL, clp, flattenTree, monthRange, todayKey } from './finance-utils';
import { SkeletonRows } from '@/components/Skeleton';

// amount = lo que se pagó; con withIva se separa en neto (presupuesto) + IVA (crédito fiscal).
const emptyForm = { accountId: '', date: todayKey(), amount: '', withIva: false, description: '', counterparty: '', paymentMethod: '', reference: '', bankAccountId: '' };

export default function MovementsTab({ companyId, version, onChanged }: { companyId?: string; version: number; onChanged: () => void }) {
  const now = new Date();
  const initial = monthRange(now.getFullYear(), now.getMonth() + 1);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [banks, setBanks] = useState<any[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [filters, setFilters] = useState({ from: initial.from, to: initial.to, accountId: '', search: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: any[]; total: number; pages: number; sum: number } | null>(null);
  const [automatic, setAutomatic] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<any | null>(null); // null = cerrado; {} = nuevo
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.finance.accounts(getToken()!, companyId).then(setAccounts).catch(() => {});
    api.finance.bankAccounts(getToken()!, companyId).then((b) => setBanks(b.filter((x: any) => !x.archived))).catch(() => {});
  }, [companyId, version]);

  useEffect(() => {
    const token = getToken()!;
    setLoading(true);
    setError('');
    Promise.all([
      api.finance.movements({ ...filters, page, companyId }, token),
      api.finance.automatic({ from: filters.from, to: filters.to, companyId }, token),
    ])
      .then(([m, a]) => { setData(m); setAutomatic(a); })
      .catch((e) => setError(e.message || 'No se pudieron cargar los movimientos'))
      .finally(() => setLoading(false));
  }, [filters, page, companyId, version]);

  // Nombre completo de cada cuenta ("Marketing › Publicidad digital") y las que admiten movimientos.
  const tree = useMemo(() => flattenTree<any>(accounts), [accounts]);
  const pathOf = useMemo(() => {
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return (id: string) => {
      const parts: string[] = [];
      for (let a = byId.get(id); a && a.parentId; a = byId.get(a.parentId)) parts.unshift(a.name);
      return parts.join(' › ') || byId.get(id)?.name || '';
    };
  }, [accounts]);
  const leafAccounts = tree.filter((a) => !a.hasChildren && !a.archived);

  const openNew = () => { setForm({ ...emptyForm, date: todayKey() }); setFile(null); setEditing({}); };
  const openEdit = (m: any) => {
    const tax = Number(m.tax || 0);
    setForm({
      accountId: m.accountId, date: String(m.date).slice(0, 10), amount: String(Math.round(Number(m.amount) + tax)), withIva: tax > 0,
      description: m.description, counterparty: m.counterparty || '', paymentMethod: m.paymentMethod || '', reference: m.reference || '',
      bankAccountId: m.bankAccountId || '',
    });
    setFile(null);
    setEditing(m);
  };

  async function save() {
    const total = Number(form.amount.replace(/[^\d]/g, ''));
    const amount = form.withIva ? Math.round(total / 1.19) : total;
    if (!form.accountId || !total || !form.description.trim()) {
      await alertDialog('Completa la cuenta, el monto y la descripción.');
      return;
    }
    setSaving(true);
    try {
      const { withIva: _withIva, ...rest } = form;
      const payload = { ...rest, amount, tax: total - amount, paymentMethod: form.paymentMethod || undefined, bankAccountId: form.bankAccountId || null, companyId };
      const token = getToken()!;
      const res = editing?.id
        ? await api.finance.updateMovement(editing.id, payload, token)
        : await api.finance.createMovement(payload, token);
      if (file) await api.finance.uploadAttachment(res.movement.id, file, token);
      setEditing(null);
      onChanged();
      const st = res.budgetStatus;
      if (st?.type === 'EXPENSE' && st.budget && st.actual > st.budget) {
        await alertDialog(`⚠️ "${st.accountName}" superó su presupuesto de ${MONTHS[st.month - 1]}: lleva ${clp(st.actual)} de ${clp(st.budget)} (${Math.round(st.percent)} %).`);
      } else if (st?.type === 'EXPENSE' && st.budget && st.percent >= 90) {
        await alertDialog(`"${st.accountName}" va en ${Math.round(st.percent)} % de su presupuesto de ${MONTHS[st.month - 1]} (${clp(st.actual)} de ${clp(st.budget)}).`);
      }
    } catch (e: any) {
      await alertDialog(e.message || 'No se pudo guardar el movimiento');
    } finally {
      setSaving(false);
    }
  }

  async function removeAttachment() {
    if (!editing?.id || !(await confirmDialog('¿Quitar el comprobante adjunto?'))) return;
    await api.finance.removeAttachment(editing.id, getToken()!).catch((e) => alertDialog(e.message));
    setEditing({ ...editing, attachmentUrl: null });
    onChanged();
  }

  async function remove(m: any) {
    if (!(await confirmDialog(`¿Eliminar "${m.description}" por ${clp(Number(m.amount))}?`, { danger: true }))) return;
    try {
      await api.finance.deleteMovement(m.id, getToken()!);
      onChanged();
    } catch (e: any) {
      await alertDialog(e.message || 'No se pudo eliminar');
    }
  }

  const setFilter = (patch: Partial<typeof filters>) => { setPage(1); setFilters((f) => ({ ...f, ...patch })); };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-2xl p-4 flex flex-wrap items-end gap-3 text-sm">
        <div>
          <p className="text-xs text-gray-500 mb-1">Desde</p>
          <input type="date" value={filters.from} onChange={(e) => setFilter({ from: e.target.value })} className="border border-gray-300 rounded-lg px-2 py-1.5" />
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Hasta</p>
          <input type="date" value={filters.to} onChange={(e) => setFilter({ to: e.target.value })} className="border border-gray-300 rounded-lg px-2 py-1.5" />
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Cuenta</p>
          <select value={filters.accountId} onChange={(e) => setFilter({ accountId: e.target.value })} className="border border-gray-300 rounded-lg px-2 py-1.5 max-w-[240px]">
            <option value="">Todas</option>
            {tree.filter((a) => !a.archived).map((a) => (
              <option key={a.id} value={a.id}>{' '.repeat(a.depth * 3)}{a.name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[160px]">
          <p className="text-xs text-gray-500 mb-1">Buscar</p>
          <input value={filters.search} onChange={(e) => setFilter({ search: e.target.value })} placeholder="Descripción, proveedor, n° documento"
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5" />
        </div>
        <button onClick={openNew} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold">
          + Nuevo movimiento
        </button>
      </div>

      {error && <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-2xl overflow-x-auto">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="ui-section-title">Registrados manualmente</h2>
            {data && <span className="text-xs text-gray-500">{data.total} movimiento(s) · {clp(data.sum)}</span>}
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Fecha</th>
                <th className="text-left px-3 py-2 font-medium">Cuenta</th>
                <th className="text-left px-3 py-2 font-medium">Descripción</th>
                <th className="text-right px-3 py-2 font-medium">Monto</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <SkeletonRows cols={5} />
              ) : !data?.items.length ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Sin movimientos en el período.</td></tr>
              ) : data.items.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{new Date(`${String(m.date).slice(0, 10)}T12:00:00`).toLocaleDateString('es-CL')}</td>
                  <td className="px-3 py-2 text-xs">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium mr-1 ${m.account.type === 'INCOME' ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-700'}`}>
                      {m.account.type === 'INCOME' ? 'Ingreso' : 'Gasto'}
                    </span>
                    {pathOf(m.accountId)}
                  </td>
                  <td className="px-3 py-2">
                    <p className="text-gray-800">
                      {m.description}
                      {m.recurring && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px]" title="Generado por un gasto recurrente">recurrente</span>}
                      {m.bankTransaction && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px]" title="Conciliado con la cartola">conciliado</span>}
                      {m.attachmentUrl && (
                        <a href={imgUrl(m.attachmentUrl)} target="_blank" rel="noopener noreferrer" className="ml-1.5 text-[10px] text-blue-600 hover:underline">📎 comprobante</a>
                      )}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      {[m.counterparty, m.bankAccount?.name, m.paymentMethod && PAYMENT_LABEL[m.paymentMethod], m.reference && `N° ${m.reference}`].filter(Boolean).join(' · ')}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900 whitespace-nowrap">
                    {clp(Number(m.amount))}
                    {Number(m.tax) > 0 && <span className="block text-[10px] text-gray-400 font-normal">+ IVA {clp(Number(m.tax))}</span>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => openEdit(m)} className="text-xs text-blue-600 hover:text-blue-800 font-medium mr-3">Editar</button>
                    <button onClick={() => remove(m)} className="text-xs text-red-500 hover:text-red-700 font-medium">Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.pages > 1 && (
            <div className="flex items-center justify-center gap-3 py-3 border-t border-gray-100">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 border border-gray-300 rounded-lg text-xs disabled:opacity-40">← Anterior</button>
              <span className="text-xs text-gray-500">Página {page} de {data.pages}</span>
              <button onClick={() => setPage((p) => Math.min(data.pages, p + 1))} disabled={page >= data.pages} className="px-3 py-1 border border-gray-300 rounded-lg text-xs disabled:opacity-40">Siguiente →</button>
            </div>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-4 h-fit">
          <h2 className="ui-section-title">Automáticos del período</h2>
          <p className="text-xs text-gray-500 mt-0.5 mb-3">Calculados desde ventas, comisiones, despachos y compras. No hace falta registrarlos.</p>
          {!automatic.length ? (
            <p className="text-xs text-gray-400">Sin montos automáticos en el período.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {automatic.map((a) => (
                <li key={a.accountId} className="flex items-center justify-between gap-2">
                  <span className="text-gray-700 text-xs">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${a.type === 'INCOME' ? 'bg-emerald-500' : 'bg-orange-400'}`} />
                    {a.name}
                  </span>
                  <span className="font-medium text-gray-900 text-xs">{clp(a.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-3">
            <h3 className="ui-section-title">{editing.id ? 'Editar movimiento' : 'Nuevo movimiento'}</h3>
            <div>
              <label className="text-xs text-gray-500">Cuenta</label>
              <select value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm mt-1">
                <option value="">Elige una cuenta…</option>
                {(['EXPENSE', 'INCOME'] as const).map((type) => (
                  <optgroup key={type} label={TYPE_LABEL[type]}>
                    {leafAccounts.filter((a) => a.type === type && !a.systemKey).map((a) => (
                      <option key={a.id} value={a.id}>{pathOf(a.id)}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <p className="text-[11px] text-gray-400 mt-1">Las cuentas automáticas (ventas, comisiones, despachos, compras) no aparecen: se llenan solas.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500">Fecha</label>
                <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm mt-1" />
              </div>
              <div>
                <label className="text-xs text-gray-500">Monto pagado</label>
                <input value={form.amount ? Number(form.amount.replace(/[^\d]/g, '')).toLocaleString('es-CL') : ''}
                  onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d]/g, '') })}
                  placeholder="$0" className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm mt-1 text-right" />
                <label className="flex items-center gap-1.5 text-[11px] text-gray-500 mt-1 cursor-pointer">
                  <input type="checkbox" checked={form.withIva} onChange={(e) => setForm({ ...form, withIva: e.target.checked })} />
                  Incluye IVA (con factura)
                </label>
                {form.withIva && Number(form.amount) > 0 && (
                  <p className="text-[11px] text-gray-400">Neto {clp(Math.round(Number(form.amount) / 1.19))} + IVA {clp(Number(form.amount) - Math.round(Number(form.amount) / 1.19))}</p>
                )}
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500">Descripción</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Ej: Arriendo bodega octubre" className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500">Proveedor / contraparte</label>
                <input value={form.counterparty} onChange={(e) => setForm({ ...form, counterparty: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm mt-1" />
              </div>
              <div>
                <label className="text-xs text-gray-500">N° documento</label>
                <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })}
                  placeholder="Factura, boleta…" className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500">Pagado desde / depositado en</label>
                <select value={form.bankAccountId} onChange={(e) => setForm({ ...form, bankAccountId: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm mt-1">
                  <option value="">—</option>
                  {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500">Medio de pago</label>
                <select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm mt-1">
                  <option value="">—</option>
                  {Object.entries(PAYMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500">Comprobante (PDF o foto, opcional)</label>
              {editing.attachmentUrl && !file ? (
                <div className="flex items-center gap-3 text-xs mt-1">
                  <a href={imgUrl(editing.attachmentUrl)} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">📎 Ver comprobante</a>
                  <label className="text-gray-600 cursor-pointer hover:text-gray-900">
                    Reemplazar<input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                  </label>
                  <button onClick={removeAttachment} className="text-red-500 hover:text-red-700">Quitar</button>
                </div>
              ) : (
                <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} className="block text-xs mt-1" />
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
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

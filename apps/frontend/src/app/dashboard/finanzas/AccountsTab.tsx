'use client';

import { useEffect, useMemo, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { alertDialog, confirmDialog } from '../ConfirmDialog';
import { TYPE_LABEL, flattenTree } from './finance-utils';
import { SkeletonTable } from '@/components/Skeleton';

type Draft = { mode: 'new' | 'edit'; id?: string; parentId: string; type: string; name: string; code: string };

export default function AccountsTab({ companyId, onChanged }: { companyId?: string; onChanged: () => void }) {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    api.finance.accounts(getToken()!, companyId)
      .then(setAccounts)
      .catch((e) => setError(e.message || 'No se pudo cargar el plan de cuentas'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [companyId]);

  const tree = useMemo(() => flattenTree<any>(accounts).filter((a) => showArchived || !a.archived), [accounts, showArchived]);
  const allTree = useMemo(() => flattenTree<any>(accounts), [accounts]);

  // Una cuenta no puede moverse dentro de sí misma ni de sus subcuentas.
  const descendants = (id: string): Set<string> => {
    const out = new Set([id]);
    for (const a of allTree) if (a.parentId && out.has(a.parentId)) out.add(a.id);
    return out;
  };

  const refresh = () => { load(); onChanged(); };

  async function saveDraft() {
    if (!draft || !draft.name.trim()) return;
    setSaving(true);
    try {
      const token = getToken()!;
      if (draft.mode === 'new') {
        await api.finance.createAccount({
          name: draft.name, code: draft.code || undefined, parentId: draft.parentId || undefined,
          type: draft.parentId ? undefined : draft.type, companyId,
        }, token);
      } else {
        await api.finance.updateAccount(draft.id!, { name: draft.name, code: draft.code, parentId: draft.parentId || null }, token);
      }
      setDraft(null);
      refresh();
    } catch (e: any) {
      await alertDialog(e.message || 'No se pudo guardar la cuenta');
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive(a: any) {
    try {
      await api.finance.updateAccount(a.id, { archived: !a.archived }, getToken()!);
      refresh();
    } catch (e: any) {
      await alertDialog(e.message || 'No se pudo actualizar la cuenta');
    }
  }

  async function remove(a: any) {
    if (!(await confirmDialog(`¿Eliminar la cuenta "${a.name}"? También se borra su presupuesto.`, { danger: true }))) return;
    try {
      await api.finance.deleteAccount(a.id, getToken()!);
      refresh();
    } catch (e: any) {
      await alertDialog(e.message || 'No se pudo eliminar la cuenta');
    }
  }

  if (loading) return <SkeletonTable rows={8} cols={4} />;
  if (error) return <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>;

  const draftType = draft?.parentId ? accounts.find((a) => a.id === draft.parentId)?.type : draft?.type;
  const parentOptions = draft
    ? allTree.filter((a) => !a.archived && (!draftType || a.type === draftType) && !(draft.id && descendants(draft.id).has(a.id)))
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => setDraft({ mode: 'new', parentId: '', type: 'EXPENSE', name: '', code: '' })}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold">
          + Nueva cuenta
        </button>
        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Mostrar archivadas
        </label>
        <p className="text-xs text-gray-400 ml-auto">
          Las cuentas <span className="px-1 rounded bg-purple-50 text-purple-700">auto</span> se llenan solas; se pueden renombrar o mover, no borrar.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl divide-y divide-gray-100">
        {tree.map((a) => (
          <div key={a.id} className={`flex items-center gap-2 px-4 py-2 text-sm ${a.depth === 0 ? 'bg-gray-50/60' : ''}`}
            style={{ paddingLeft: 16 + a.depth * 20 }}>
            {a.code && <span className="font-mono text-xs text-gray-400 w-16 shrink-0">{a.code}</span>}
            <span className={`${a.hasChildren ? 'font-semibold text-gray-900' : 'text-gray-700'} ${a.archived ? 'line-through text-gray-400' : ''}`}>{a.name}</span>
            {a.depth === 0 && <span className="text-[10px] text-gray-400">{TYPE_LABEL[a.type]}</span>}
            {a.systemKey && <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 text-[10px] font-medium">auto</span>}
            {a._count?.movements > 0 && <span className="text-[10px] text-gray-400">{a._count.movements} mov.</span>}
            <div className="ml-auto flex items-center gap-3 text-xs">
              {!a.archived && (
                <button onClick={() => setDraft({ mode: 'new', parentId: a.id, type: a.type, name: '', code: '' })}
                  className="text-blue-600 hover:text-blue-800 font-medium">+ Subcuenta</button>
              )}
              <button onClick={() => setDraft({ mode: 'edit', id: a.id, parentId: a.parentId || '', type: a.type, name: a.name, code: a.code || '' })}
                className="text-gray-600 hover:text-gray-900 font-medium">Editar</button>
              {!a.systemKey && (
                <button onClick={() => toggleArchive(a)} className="text-gray-500 hover:text-gray-800">{a.archived ? 'Restaurar' : 'Archivar'}</button>
              )}
              {!a.systemKey && !a.hasChildren && !a._count?.movements && (
                <button onClick={() => remove(a)} className="text-red-500 hover:text-red-700">Eliminar</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {draft && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-3">
            <h3 className="ui-section-title">{draft.mode === 'new' ? 'Nueva cuenta' : 'Editar cuenta'}</h3>
            <div>
              <label className="text-xs text-gray-500">Nombre</label>
              <input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500">Código (opcional)</label>
                <input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                  placeholder="5.4.06" className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm mt-1 font-mono" />
              </div>
              {draft.mode === 'new' && !draft.parentId && (
                <div>
                  <label className="text-xs text-gray-500">Tipo</label>
                  <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm mt-1">
                    <option value="EXPENSE">Gasto</option>
                    <option value="INCOME">Ingreso</option>
                  </select>
                </div>
              )}
            </div>
            <div>
              <label className="text-xs text-gray-500">Cuenta madre</label>
              <select value={draft.parentId} onChange={(e) => setDraft({ ...draft, parentId: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm mt-1">
                <option value="">— Ninguna (cuenta principal) —</option>
                {parentOptions.map((a) => (
                  <option key={a.id} value={a.id}>{' '.repeat(a.depth * 3)}{a.code ? `${a.code} ` : ''}{a.name}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setDraft(null)} disabled={saving} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">Cancelar</button>
              <button onClick={saveDraft} disabled={saving || !draft.name.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

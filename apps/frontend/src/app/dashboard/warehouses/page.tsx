'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { useAdminCompany } from '../AdminCompanyContext';
import { confirmDialog, alertDialog } from '../ConfirmDialog';
import { Modal, FormError, btnPrimary, btnSecondary, inputCls, labelCls } from '@/components/ui/Modal';

const emptyForm = { name: '', description: '' };
const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;

export default function WarehousesPage() {
  const { selectedCompanyId } = useAdminCompany();
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);

  // null = cerrado; { id: null } = crear; { id } = editar
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [pageError, setPageError] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const isAdmin = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'COMPANY_ADMIN';
  const blocked = isSuperAdmin && !selectedCompanyId;

  async function load() {
    const token = getToken();
    if (!token) return;
    if (blocked) { setWarehouses([]); setLoading(false); return; }
    setLoading(true);
    try {
      const data = await api.warehouses.list(token, isSuperAdmin ? selectedCompanyId : undefined);
      setWarehouses(data);
    } catch {
      setWarehouses([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setCurrentUser(getUser());
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, selectedCompanyId]);

  function openCreate() {
    setEditing({ id: null });
    setForm(emptyForm);
    setFormError('');
  }

  function openEdit(wh: any) {
    setEditing({ id: wh.id });
    setForm({ name: wh.name, description: wh.description || '' });
    setFormError('');
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setFormError('');
    setSaving(true);
    try {
      const token = getToken()!;
      const data = { name: form.name.trim(), description: form.description.trim() || undefined };
      if (editing.id) {
        await api.warehouses.update(editing.id, data, token);
      } else {
        await api.warehouses.create({ ...data, companyId: isSuperAdmin ? selectedCompanyId : undefined }, token);
      }
      setEditing(null);
      await load();
    } catch (err: any) {
      setFormError(err.message || 'No se pudo guardar la bodega');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(wh: any) {
    if (wh.active && wh.units > 0 && !(await confirmDialog(
      `"${wh.name}" tiene ${wh.units} unidad(es) en stock. Una bodega inactiva no puede recibir ni despachar traspasos. ¿Desactivarla igual?`,
    ))) return;
    setTogglingId(wh.id);
    try {
      const token = getToken()!;
      await api.warehouses.update(wh.id, { active: !wh.active }, token);
      await load();
    } catch (err: any) {
      await alertDialog(err.message);
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete(wh: any) {
    setPageError('');
    if (!(await confirmDialog(`¿Eliminar la bodega "${wh.name}"? Esta acción no se puede deshacer.`, { danger: true }))) return;
    setDeletingId(wh.id);
    try {
      const token = getToken()!;
      await api.warehouses.remove(wh.id, token);
      await load();
    } catch (err: any) {
      setPageError(err.message || 'Error al eliminar');
    } finally {
      setDeletingId(null);
    }
  }

  const totals = warehouses.reduce((s, w) => ({ units: s.units + (w.units ?? 0), value: s.value + (w.value ?? 0) }), { units: 0, value: 0 });

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-[1.375rem] font-bold text-gray-900">Bodegas</h1>
          <p className="text-gray-500 text-xs mt-0.5">
            Dónde está tu mercadería. El detalle por producto, el historial y los traspasos están en{' '}
            <Link href="/dashboard/inventario" className="text-blue-600 hover:underline">Inventario</Link>.
          </p>
        </div>
        {isAdmin && !blocked && (
          <button onClick={openCreate} className={btnPrimary}>+ Nueva bodega</button>
        )}
      </div>

      {pageError && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{pageError}</div>
      )}

      {!loading && warehouses.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
          <span>{warehouses.length} bodega(s)</span>
          <span><b className="text-gray-800">{totals.units.toLocaleString('es-CL')}</b> unidades en stock</span>
          <span>Valor a costo: <b className="text-gray-800">{fmtMoney(totals.value)}</b></span>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {blocked ? (
          <div className="px-4 py-12 text-center text-gray-400 text-sm">Selecciona una empresa arriba para ver sus bodegas.</div>
        ) : loading ? (
          <div className="px-4 py-10 text-center text-gray-400 text-sm">Cargando...</div>
        ) : warehouses.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-400">
            <div className="text-4xl mb-3">🏭</div>
            <p className="text-sm font-medium mb-1">Sin bodegas creadas</p>
            <p className="text-xs">Crea tu primera bodega para comenzar a organizar el inventario.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">Bodega</th>
                <th className="text-right px-4 py-3 text-gray-600 font-medium">Unidades</th>
                <th className="text-right px-4 py-3 text-gray-600 font-medium">SKUs con stock</th>
                <th className="text-right px-4 py-3 text-gray-600 font-medium">Valor a costo</th>
                <th className="text-center px-4 py-3 text-gray-600 font-medium">Traspasos</th>
                <th className="text-center px-4 py-3 text-gray-600 font-medium">Estado</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {warehouses.map((wh) => (
                <tr key={wh.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{wh.name}</p>
                    <p className="text-xs text-gray-400">
                      {wh.description || 'Sin descripción'}
                      {isSuperAdmin && wh.company ? ` · ${wh.company.name}` : ''}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-gray-800">{(wh.units ?? 0).toLocaleString('es-CL')}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-gray-600">{wh.skus ?? 0}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-gray-600">{fmtMoney(wh.value ?? 0)}</td>
                  <td className="px-4 py-3 text-center text-xs">
                    {wh.incomingTransfers > 0 && <span className="block text-amber-700">{wh.incomingTransfers} por recibir</span>}
                    {wh.outgoingTransfers > 0 && <span className="block text-gray-500">{wh.outgoingTransfers} por despachar/en camino</span>}
                    {!wh.incomingTransfers && !wh.outgoingTransfers && <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${wh.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {wh.active ? 'Activa' : 'Inactiva'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="flex gap-3 justify-end text-xs font-medium">
                      <Link href={`/dashboard/inventario?warehouseId=${wh.id}`} className="text-blue-600 hover:text-blue-800">Ver stock</Link>
                      <Link href={`/dashboard/inventario?tab=historial&warehouseId=${wh.id}`} className="text-blue-600 hover:text-blue-800">Historial</Link>
                      {isAdmin && (
                        <>
                          <button onClick={() => openEdit(wh)} className="text-gray-500 hover:text-gray-800">Editar</button>
                          <button onClick={() => handleToggleActive(wh)} disabled={togglingId === wh.id}
                            className="text-gray-400 hover:text-gray-600 disabled:opacity-50">
                            {togglingId === wh.id ? '...' : (wh.active ? 'Desactivar' : 'Activar')}
                          </button>
                          {wh._count?.products === 0 && !wh.units && (
                            <button onClick={() => handleDelete(wh)} disabled={deletingId === wh.id}
                              className="text-red-400 hover:text-red-600 disabled:opacity-50">
                              {deletingId === wh.id ? 'Eliminando...' : 'Eliminar'}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <Modal
          title={editing.id ? 'Editar bodega' : 'Nueva bodega'}
          onClose={() => setEditing(null)}
          onSubmit={handleSave}
          busy={saving}
          footer={<>
            <button type="button" onClick={() => setEditing(null)} disabled={saving} className={btnSecondary}>Cancelar</button>
            <button type="submit" disabled={saving} className={btnPrimary}>
              {saving ? 'Guardando...' : editing.id ? 'Guardar cambios' : 'Crear bodega'}
            </button>
          </>}
        >
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Nombre *</label>
              <input value={form.name} required maxLength={80}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Ej: Bodega Centro, Tienda Providencia" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Descripción</label>
              <input value={form.description} maxLength={200}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Dirección o notas" className={inputCls} />
            </div>
            <FormError message={formError} />
          </div>
        </Modal>
      )}
    </div>
  );
}

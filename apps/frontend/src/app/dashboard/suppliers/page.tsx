'use client';

import { useEffect, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';

const emptyForm = { name: '', taxId: '', email: '', phone: '', address: '' };

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(emptyForm);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');

  const [deleteError, setDeleteError] = useState('');

  const isAdmin = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'COMPANY_ADMIN';

  async function load() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      const data = await api.suppliers.list(token);
      setSuppliers(data);
    } catch {
      setSuppliers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const u = getUser();
    setCurrentUser(u);
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError('');
    setCreateLoading(true);
    try {
      const token = getToken()!;
      await api.suppliers.create({
        name: createForm.name.trim(),
        taxId: createForm.taxId.trim() || undefined,
        email: createForm.email.trim() || undefined,
        phone: createForm.phone.trim() || undefined,
        address: createForm.address.trim() || undefined,
      }, token);
      setCreateForm(emptyForm);
      setShowCreate(false);
      await load();
    } catch (err: any) {
      setCreateError(err.message || 'Error al crear proveedor');
    } finally {
      setCreateLoading(false);
    }
  }

  function openEdit(s: any) {
    setEditingId(s.id);
    setEditForm({ name: s.name, taxId: s.taxId || '', email: s.email || '', phone: s.phone || '', address: s.address || '' });
    setEditError('');
    setDeleteError('');
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setEditError('');
    setEditLoading(true);
    try {
      const token = getToken()!;
      await api.suppliers.update(editingId, {
        name: editForm.name.trim(),
        taxId: editForm.taxId.trim() || undefined,
        email: editForm.email.trim() || undefined,
        phone: editForm.phone.trim() || undefined,
        address: editForm.address.trim() || undefined,
      }, token);
      setEditingId(null);
      await load();
    } catch (err: any) {
      setEditError(err.message || 'Error al actualizar');
    } finally {
      setEditLoading(false);
    }
  }

  async function handleToggleActive(s: any) {
    const token = getToken()!;
    try {
      await api.suppliers.update(s.id, { active: !s.active }, token);
      await load();
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function handleDelete(s: any) {
    setDeleteError('');
    if (!confirm(`¿Eliminar el proveedor "${s.name}"? Esta acción no se puede deshacer.`)) return;
    const token = getToken()!;
    try {
      await api.suppliers.remove(s.id, token);
      await load();
    } catch (err: any) {
      setDeleteError(err.message || 'Error al eliminar');
    }
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Proveedores</h1>
          <p className="text-gray-500 text-sm mt-0.5">Empresas a las que les compras mercadería.</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => { setShowCreate(!showCreate); setCreateForm(emptyForm); setCreateError(''); }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            + Nuevo proveedor
          </button>
        )}
      </div>

      {deleteError && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {deleteError}
        </div>
      )}

      {showCreate && isAdmin && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h2 className="font-semibold text-gray-800 mb-4">Nuevo proveedor</h2>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
                <input value={createForm.name} onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                  required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">RUT</label>
                <input value={createForm.taxId} onChange={(e) => setCreateForm((f) => ({ ...f, taxId: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input type="email" value={createForm.email} onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Teléfono</label>
                <input value={createForm.phone} onChange={(e) => setCreateForm((f) => ({ ...f, phone: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Dirección</label>
                <input value={createForm.address} onChange={(e) => setCreateForm((f) => ({ ...f, address: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
            </div>
            {createError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{createError}</p>
            )}
            <div className="flex gap-2">
              <button type="submit" disabled={createLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {createLoading ? 'Creando...' : 'Crear proveedor'}
              </button>
              <button type="button" onClick={() => setShowCreate(false)}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="px-4 py-10 text-center text-gray-400 text-sm">Cargando...</div>
        ) : suppliers.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-400">
            <div className="text-4xl mb-3">🏢</div>
            <p className="text-sm font-medium mb-1">Sin proveedores creados</p>
            <p className="text-xs">Crea tu primer proveedor para empezar a registrar compras.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">Proveedor</th>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">Contacto</th>
                <th className="text-center px-4 py-3 text-gray-600 font-medium">Compras</th>
                <th className="text-center px-4 py-3 text-gray-600 font-medium">Estado</th>
                {isAdmin && <th className="px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {suppliers.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{s.name}</p>
                    {s.taxId && <p className="text-xs text-gray-400 font-mono">{s.taxId}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {s.email || s.phone ? (
                      <>
                        {s.email && <p>{s.email}</p>}
                        {s.phone && <p>{s.phone}</p>}
                      </>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center justify-center w-8 h-6 rounded-full text-xs font-bold ${
                      s._count?.purchases > 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-400'
                    }`}>
                      {s._count?.purchases ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      s.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {s.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => openEdit(s)}
                          className="text-xs text-blue-500 hover:text-blue-700 font-medium">
                          Editar
                        </button>
                        <button onClick={() => handleToggleActive(s)}
                          className="text-xs text-gray-400 hover:text-gray-600 font-medium">
                          {s.active ? 'Desactivar' : 'Activar'}
                        </button>
                        {s._count?.purchases === 0 && (
                          <button onClick={() => handleDelete(s)}
                            className="text-xs text-red-400 hover:text-red-600 font-medium">
                            Eliminar
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editingId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-900">Editar proveedor</h2>
              <button onClick={() => setEditingId(null)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <form onSubmit={handleEdit}>
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Nombre *</label>
                  <input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                    required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">RUT</label>
                  <input value={editForm.taxId} onChange={(e) => setEditForm((f) => ({ ...f, taxId: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Email</label>
                  <input type="email" value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Teléfono</label>
                  <input value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Dirección</label>
                  <input value={editForm.address} onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                {editError && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{editError}</p>
                )}
              </div>
              <div className="px-6 py-4 border-t border-gray-100 flex gap-2 justify-end">
                <button type="button" onClick={() => setEditingId(null)}
                  className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                  Cancelar
                </button>
                <button type="submit" disabled={editLoading}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
                  {editLoading ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';

const emptyForm = { name: '', description: '' };

export default function WarehousesPage() {
  const [warehouses, setWarehouses] = useState<any[]>([]);
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
      const data = await api.warehouses.list(token);
      setWarehouses(data);
    } catch {
      setWarehouses([]);
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
      await api.warehouses.create({
        name: createForm.name.trim(),
        description: createForm.description.trim() || undefined,
      }, token);
      setCreateForm(emptyForm);
      setShowCreate(false);
      await load();
    } catch (err: any) {
      setCreateError(err.message || 'Error al crear bodega');
    } finally {
      setCreateLoading(false);
    }
  }

  function openEdit(wh: any) {
    setEditingId(wh.id);
    setEditForm({ name: wh.name, description: wh.description || '' });
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
      await api.warehouses.update(editingId, {
        name: editForm.name.trim(),
        description: editForm.description.trim() || undefined,
      }, token);
      setEditingId(null);
      await load();
    } catch (err: any) {
      setEditError(err.message || 'Error al actualizar');
    } finally {
      setEditLoading(false);
    }
  }

  async function handleToggleActive(wh: any) {
    const token = getToken()!;
    try {
      await api.warehouses.update(wh.id, { active: !wh.active }, token);
      await load();
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function handleDelete(wh: any) {
    setDeleteError('');
    if (!confirm(`¿Eliminar la bodega "${wh.name}"? Esta acción no se puede deshacer.`)) return;
    const token = getToken()!;
    try {
      await api.warehouses.remove(wh.id, token);
      await load();
    } catch (err: any) {
      setDeleteError(err.message || 'Error al eliminar');
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bodegas</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Organiza tu inventario por ubicación física. Cada producto se asigna a una bodega al registrarlo.
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => { setShowCreate(!showCreate); setCreateForm(emptyForm); setCreateError(''); }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            + Nueva bodega
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
          <h2 className="font-semibold text-gray-800 mb-4">Nueva bodega</h2>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
                <input
                  value={createForm.name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Ej: Bodega Principal, Bodega Norte..."
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-xs font-medium text-gray-600 mb-1">Descripción</label>
                <input
                  value={createForm.description}
                  onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Ubicación o notas adicionales..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            {createError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{createError}</p>
            )}
            <div className="flex gap-2">
              <button type="submit" disabled={createLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {createLoading ? 'Creando...' : 'Crear bodega'}
              </button>
              <button type="button" onClick={() => setShowCreate(false)}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading ? (
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
                <th className="text-left px-4 py-3 text-gray-600 font-medium">Descripción</th>
                <th className="text-center px-4 py-3 text-gray-600 font-medium">Productos</th>
                <th className="text-center px-4 py-3 text-gray-600 font-medium">Estado</th>
                {isAdmin && <th className="px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {warehouses.map((wh) => (
                <tr key={wh.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{wh.name}</p>
                    {currentUser?.role === 'SUPER_ADMIN' && wh.company && (
                      <p className="text-xs text-gray-400">{wh.company.name}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs max-w-[200px]">
                    {wh.description || <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center justify-center w-8 h-6 rounded-full text-xs font-bold ${
                      wh._count?.products > 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-400'
                    }`}>
                      {wh._count?.products ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      wh.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {wh.active ? 'Activa' : 'Inactiva'}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => openEdit(wh)}
                          className="text-xs text-blue-500 hover:text-blue-700 font-medium">
                          Editar
                        </button>
                        <button onClick={() => handleToggleActive(wh)}
                          className="text-xs text-gray-400 hover:text-gray-600 font-medium">
                          {wh.active ? 'Desactivar' : 'Activar'}
                        </button>
                        {wh._count?.products === 0 && (
                          <button onClick={() => handleDelete(wh)}
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

      {/* Modal edición */}
      {editingId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-900">Editar bodega</h2>
              <button onClick={() => setEditingId(null)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <form onSubmit={handleEdit}>
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Nombre *</label>
                  <input
                    value={editForm.name}
                    onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Descripción</label>
                  <input
                    value={editForm.description}
                    onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="Ubicación o notas..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
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

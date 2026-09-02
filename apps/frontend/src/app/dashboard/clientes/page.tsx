'use client';

import { useEffect, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';

const emptyForm = { name: '', rut: '', giro: '', email: '', phone: '', address: '', commune: '', city: '', creditLimit: '' };

const fmt = (n: number) => `$${Number(n).toLocaleString('es-CL')}`;

const DTE_LABELS: Record<string, string> = {
  FACTURA: 'Factura', BOLETA: 'Boleta', NOTA_CREDITO: 'Nota Crédito',
  NOTA_DEBITO: 'Nota Débito', FACTURA_EXENTA: 'Fact. Exenta',
};
const INVOICE_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador', ISSUED: 'Emitido', ACCEPTED: 'Aceptado', REJECTED: 'Rechazado', CANCELLED: 'Anulado',
};
const fmtDate = (d: string) => new Date(d).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });

export default function ClientsPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [companies, setCompanies] = useState<any[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(emptyForm);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');

  const [deleteError, setDeleteError] = useState('');

  const [historyClient, setHistoryClient] = useState<any>(null);
  const [historyData, setHistoryData] = useState<any>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const canEdit = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'ORDER_MANAGER'].includes(currentUser?.role);
  const canCreate = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR', 'ORDER_MANAGER'].includes(currentUser?.role);
  const canDelete = ['SUPER_ADMIN', 'COMPANY_ADMIN'].includes(currentUser?.role);

  async function load() {
    const token = getToken();
    if (!token) return;
    if (isSuperAdmin && !selectedCompanyId) {
      setClients([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await api.clients.list(token, isSuperAdmin ? selectedCompanyId : undefined);
      setClients(data);
    } catch {
      setClients([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const u = getUser();
    setCurrentUser(u);
    const token = getToken();
    if (token && u?.role === 'SUPER_ADMIN') {
      api.companies.list(token).then(setCompanies).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, selectedCompanyId]);

  function selectCompany(companyId: string) {
    setSelectedCompanyId(companyId);
    setShowCreate(false);
  }

  function toPayload(f: typeof emptyForm) {
    return {
      name: f.name.trim(),
      rut: f.rut.trim() || undefined,
      giro: f.giro.trim() || undefined,
      email: f.email.trim() || undefined,
      phone: f.phone.trim() || undefined,
      address: f.address.trim() || undefined,
      commune: f.commune.trim() || undefined,
      city: f.city.trim() || undefined,
      creditLimit: f.creditLimit.trim() ? Number(f.creditLimit) : undefined,
    };
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError('');
    setCreateLoading(true);
    try {
      const token = getToken()!;
      await api.clients.create({ ...toPayload(createForm), companyId: isSuperAdmin ? selectedCompanyId : undefined }, token);
      setCreateForm(emptyForm);
      setShowCreate(false);
      await load();
    } catch (err: any) {
      setCreateError(err.message || 'Error al crear cliente');
    } finally {
      setCreateLoading(false);
    }
  }

  function openEdit(c: any) {
    setEditingId(c.id);
    setEditForm({
      name: c.name, rut: c.rut || '', giro: c.giro || '', email: c.email || '', phone: c.phone || '',
      address: c.address || '', commune: c.commune || '', city: c.city || '',
      creditLimit: c.creditLimit != null ? String(c.creditLimit) : '',
    });
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
      await api.clients.update(editingId, toPayload(editForm), token);
      setEditingId(null);
      await load();
    } catch (err: any) {
      setEditError(err.message || 'Error al actualizar');
    } finally {
      setEditLoading(false);
    }
  }

  async function handleToggleActive(c: any) {
    const token = getToken()!;
    try {
      await api.clients.update(c.id, { active: !c.active }, token);
      await load();
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function openHistory(c: any) {
    setHistoryClient(c);
    setHistoryData(null);
    setHistoryLoading(true);
    try {
      const token = getToken()!;
      const data = await api.clients.history(c.id, token);
      setHistoryData(data);
    } catch {
      setHistoryData(null);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleDelete(c: any) {
    setDeleteError('');
    if (!confirm(`¿Eliminar el cliente "${c.name}"? Esta acción no se puede deshacer.`)) return;
    const token = getToken()!;
    try {
      await api.clients.remove(c.id, token);
      await load();
    } catch (err: any) {
      setDeleteError(err.message || 'Error al eliminar');
    }
  }

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clientes</h1>
          <p className="text-gray-500 text-sm mt-0.5">Clientes para solicitudes de pedido y facturación.</p>
        </div>
        <div className="flex items-center gap-3">
          {isSuperAdmin && (
            <select
              value={selectedCompanyId}
              onChange={(e) => selectCompany(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white font-medium"
            >
              <option value="">— Selecciona una empresa —</option>
              {companies.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          {canCreate && (!isSuperAdmin || selectedCompanyId) && (
            <button
              onClick={() => { setShowCreate(!showCreate); setCreateForm(emptyForm); setCreateError(''); }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              + Nuevo cliente
            </button>
          )}
        </div>
      </div>

      {deleteError && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {deleteError}
        </div>
      )}

      {isSuperAdmin && !selectedCompanyId ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center text-gray-400 text-sm">
          <p className="text-3xl mb-2">🏢</p>
          <p>Selecciona una empresa arriba para ver y crear sus clientes.</p>
        </div>
      ) : (
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading ? (
          <div className="px-4 py-10 text-center text-gray-400 text-sm">Cargando...</div>
        ) : clients.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-400">
            <div className="text-4xl mb-3">🧑‍💼</div>
            <p className="text-sm font-medium mb-1">Sin clientes creados</p>
            <p className="text-xs">Crea tu primer cliente para empezar a levantar solicitudes de pedido.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">Cliente</th>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">Contacto</th>
                <th className="text-right px-4 py-3 text-gray-600 font-medium">Límite crédito</th>
                <th className="text-center px-4 py-3 text-gray-600 font-medium">Estado</th>
                {canEdit && <th className="px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {clients.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{c.name}</p>
                    {c.rut && <p className="text-xs text-gray-400 font-mono">{c.rut}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {c.email || c.phone ? (
                      <>
                        {c.email && <p>{c.email}</p>}
                        {c.phone && <p>{c.phone}</p>}
                      </>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {c.creditLimit != null ? fmt(c.creditLimit) : <span className="text-gray-300">Sin límite</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      c.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {c.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => openHistory(c)}
                          className="text-xs text-gray-500 hover:text-gray-700 font-medium">
                          Historial
                        </button>
                        <button onClick={() => openEdit(c)}
                          className="text-xs text-blue-500 hover:text-blue-700 font-medium">
                          Editar
                        </button>
                        <button onClick={() => handleToggleActive(c)}
                          className="text-xs text-gray-400 hover:text-gray-600 font-medium">
                          {c.active ? 'Desactivar' : 'Activar'}
                        </button>
                        {canDelete && c._count?.invoices === 0 && (
                          <button onClick={() => handleDelete(c)}
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
      )}

      {showCreate && canCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
              <h2 className="font-bold text-gray-900">Nuevo cliente</h2>
              <button onClick={() => setShowCreate(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <form onSubmit={handleCreate} className="overflow-y-auto">
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Nombre / Razón social *</label>
                  <input value={createForm.name} onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                    required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">RUT</label>
                    <input value={createForm.rut} onChange={(e) => setCreateForm((f) => ({ ...f, rut: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Límite de crédito</label>
                    <input type="number" min={0} step="0.01" value={createForm.creditLimit}
                      onChange={(e) => setCreateForm((f) => ({ ...f, creditLimit: e.target.value }))}
                      placeholder="Sin límite" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Giro</label>
                  <input value={createForm.giro} onChange={(e) => setCreateForm((f) => ({ ...f, giro: e.target.value }))}
                    placeholder="Actividad económica" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Email</label>
                  <input type="email" value={createForm.email} onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Teléfono</label>
                  <input value={createForm.phone} onChange={(e) => setCreateForm((f) => ({ ...f, phone: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Dirección</label>
                  <input value={createForm.address} onChange={(e) => setCreateForm((f) => ({ ...f, address: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Comuna</label>
                    <input value={createForm.commune} onChange={(e) => setCreateForm((f) => ({ ...f, commune: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Ciudad</label>
                    <input value={createForm.city} onChange={(e) => setCreateForm((f) => ({ ...f, city: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                </div>
                {createError && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{createError}</p>
                )}
              </div>
              <div className="px-6 py-4 border-t border-gray-100 flex gap-2 justify-end">
                <button type="button" onClick={() => setShowCreate(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                  Cancelar
                </button>
                <button type="submit" disabled={createLoading}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
                  {createLoading ? 'Creando...' : 'Crear cliente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
              <h2 className="font-bold text-gray-900">Editar cliente</h2>
              <button onClick={() => setEditingId(null)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <form onSubmit={handleEdit} className="overflow-y-auto">
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Nombre / Razón social *</label>
                  <input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                    required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">RUT</label>
                    <input value={editForm.rut} onChange={(e) => setEditForm((f) => ({ ...f, rut: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Límite de crédito</label>
                    <input type="number" min={0} step="0.01" value={editForm.creditLimit}
                      onChange={(e) => setEditForm((f) => ({ ...f, creditLimit: e.target.value }))}
                      placeholder="Sin límite" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Giro</label>
                  <input value={editForm.giro} onChange={(e) => setEditForm((f) => ({ ...f, giro: e.target.value }))}
                    placeholder="Actividad económica" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
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
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Comuna</label>
                    <input value={editForm.commune} onChange={(e) => setEditForm((f) => ({ ...f, commune: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Ciudad</label>
                    <input value={editForm.city} onChange={(e) => setEditForm((f) => ({ ...f, city: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
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

      {historyClient && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
              <div>
                <h2 className="font-bold text-gray-900">Historial de {historyClient.name}</h2>
                {historyClient.rut && <p className="text-xs text-gray-400 font-mono">{historyClient.rut}</p>}
              </div>
              <button onClick={() => setHistoryClient(null)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="overflow-y-auto px-6 py-5 space-y-6">
              {historyLoading ? (
                <p className="text-sm text-gray-400 text-center py-8">Cargando...</p>
              ) : !historyData ? (
                <p className="text-sm text-red-500 text-center py-8">No se pudo cargar el historial.</p>
              ) : (
                <>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">
                      Documentos tributarios ({historyData.invoices.length})
                    </h3>
                    {historyData.invoices.length === 0 ? (
                      <p className="text-xs text-gray-400">Sin documentos emitidos para este cliente.</p>
                    ) : (
                      <div className="border border-gray-200 rounded-lg overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="text-left px-3 py-2 text-gray-500 font-medium">Fecha</th>
                              <th className="text-left px-3 py-2 text-gray-500 font-medium">Tipo</th>
                              <th className="text-left px-3 py-2 text-gray-500 font-medium">Folio</th>
                              <th className="text-right px-3 py-2 text-gray-500 font-medium">Monto</th>
                              <th className="text-left px-3 py-2 text-gray-500 font-medium">Estado</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {historyData.invoices.map((inv: any) => (
                              <tr key={inv.id}>
                                <td className="px-3 py-2 text-gray-600">{fmtDate(inv.createdAt)}</td>
                                <td className="px-3 py-2 text-gray-600">{DTE_LABELS[inv.dteType] ?? inv.dteType}</td>
                                <td className="px-3 py-2 font-mono text-gray-500">{inv.folio ?? '—'}</td>
                                <td className="px-3 py-2 text-right font-medium text-gray-900">{fmt(Number(inv.totalAmount))}</td>
                                <td className="px-3 py-2">
                                  {INVOICE_STATUS_LABELS[inv.status] ?? inv.status}
                                  {inv.paid && <span className="ml-1 text-green-600">· Pagado</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

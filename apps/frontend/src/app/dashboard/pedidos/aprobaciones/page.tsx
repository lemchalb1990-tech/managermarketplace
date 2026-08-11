'use client';

import { useEffect, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';

const fmt = (n: number) => `$${Number(n).toLocaleString('es-CL')}`;

export default function AprobacionesPage() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [companies, setCompanies] = useState<any[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');

  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectLoading, setRejectLoading] = useState(false);

  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';

  async function load() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      const data = await api.orderRequests.pending(token, { companyId: isSuperAdmin ? selectedCompanyId || undefined : undefined });
      setItems(data.items);
    } catch {
      setItems([]);
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

  async function handleApprove(id: string) {
    setActionError('');
    if (!confirm('¿Aprobar esta solicitud? Se descontará el stock y se generará la orden de despacho.')) return;
    setActionLoadingId(id);
    try {
      const token = getToken()!;
      await api.orderRequests.approve(id, token);
      await load();
    } catch (err: any) {
      setActionError(err.message || 'Error al aprobar');
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleReject(e: React.FormEvent) {
    e.preventDefault();
    if (!rejectingId) return;
    setRejectLoading(true);
    setActionError('');
    try {
      const token = getToken()!;
      await api.orderRequests.reject(rejectingId, rejectReason.trim(), token);
      setRejectingId(null);
      setRejectReason('');
      await load();
    } catch (err: any) {
      setActionError(err.message || 'Error al rechazar');
    } finally {
      setRejectLoading(false);
    }
  }

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Aprobación de pedidos</h1>
          <p className="text-gray-500 text-sm mt-0.5">Solicitudes de pedido pendientes de revisión.</p>
        </div>
        {isSuperAdmin && (
          <select
            value={selectedCompanyId}
            onChange={(e) => setSelectedCompanyId(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white font-medium"
          >
            <option value="">— Todas las empresas —</option>
            {companies.map((c: any) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
      </div>

      {actionError && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {actionError}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-10 text-center text-gray-400 text-sm">Cargando...</div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-12 text-center text-gray-400">
          <div className="text-4xl mb-3">✅</div>
          <p className="text-sm font-medium mb-1">Sin solicitudes pendientes</p>
          <p className="text-xs">Todas las solicitudes de pedido han sido revisadas.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((r) => {
            const total = r.items.reduce((s: number, i: any) => s + Number(i.unitPrice) * i.quantity, 0);
            return (
              <div key={r.id} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="font-semibold text-gray-900">{r.client?.name}</p>
                    <p className="text-xs text-gray-400">
                      Solicitado por {r.requestedBy?.name} · {new Date(r.createdAt).toLocaleDateString('es-CL')}
                      {r.scheduledDispatchDate && <> · Despacho: {new Date(r.scheduledDispatchDate).toLocaleDateString('es-CL')}</>}
                    </p>
                  </div>
                  <p className="font-semibold text-gray-900">{fmt(total)}</p>
                </div>

                <div className="border-t border-gray-100 pt-3 space-y-1">
                  {r.items.map((i: any) => (
                    <div key={i.id} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700">{i.product?.name} <span className="text-gray-400 text-xs">x{i.quantity}</span></span>
                      <span className="text-gray-500">{fmt(Number(i.unitPrice) * i.quantity)}</span>
                    </div>
                  ))}
                </div>

                {r.notes && <p className="text-xs text-gray-500 mt-3 italic">"{r.notes}"</p>}

                <div className="flex gap-2 justify-end mt-4 pt-3 border-t border-gray-100">
                  <button onClick={() => { setRejectingId(r.id); setRejectReason(''); }}
                    className="px-4 py-2 border border-red-300 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50">
                    Rechazar
                  </button>
                  <button onClick={() => handleApprove(r.id)} disabled={actionLoadingId === r.id}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                    {actionLoadingId === r.id ? 'Aprobando...' : 'Aprobar'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {rejectingId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-900">Rechazar solicitud</h2>
              <button onClick={() => setRejectingId(null)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <form onSubmit={handleReject}>
              <div className="px-6 py-5">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Motivo del rechazo *</label>
                <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} required rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div className="px-6 py-4 border-t border-gray-100 flex gap-2 justify-end">
                <button type="button" onClick={() => setRejectingId(null)}
                  className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                  Cancelar
                </button>
                <button type="submit" disabled={rejectLoading}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
                  {rejectLoading ? 'Rechazando...' : 'Rechazar solicitud'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';

const fmt = (n: number) => `$${Number(n).toLocaleString('es-CL')}`;

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'Pendiente', className: 'bg-amber-100 text-amber-700' },
  APPROVED: { label: 'Aprobada', className: 'bg-green-100 text-green-700' },
  REJECTED: { label: 'Rechazada', className: 'bg-red-100 text-red-700' },
  CANCELLED: { label: 'Cancelada', className: 'bg-gray-100 text-gray-500' },
};

export default function MisSolicitudesPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelError, setCancelError] = useState('');

  async function load() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      const data = await api.orderRequests.mine(token);
      setItems(data.items);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCancel(id: string) {
    setCancelError('');
    if (!confirm('¿Cancelar esta solicitud?')) return;
    const token = getToken()!;
    try {
      await api.orderRequests.cancel(id, token);
      await load();
    } catch (err: any) {
      setCancelError(err.message || 'Error al cancelar');
    }
  }

  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mis solicitudes</h1>
          <p className="text-gray-500 text-sm mt-0.5">Estado de las solicitudes de pedido que has creado.</p>
        </div>
        <Link href="/dashboard/pedidos/nueva-solicitud"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
          + Nueva solicitud
        </Link>
      </div>

      {cancelError && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {cancelError}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading ? (
          <div className="px-4 py-10 text-center text-gray-400 text-sm">Cargando...</div>
        ) : items.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-400">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-sm font-medium mb-1">Sin solicitudes creadas</p>
            <p className="text-xs">Crea tu primera solicitud de pedido para un cliente.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">Fecha</th>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">Cliente</th>
                <th className="text-center px-4 py-3 text-gray-600 font-medium">Ítems</th>
                <th className="text-right px-4 py-3 text-gray-600 font-medium">Total</th>
                <th className="text-center px-4 py-3 text-gray-600 font-medium">Estado</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((r) => {
                const total = r.items.reduce((s: number, i: any) => s + Number(i.unitPrice) * i.quantity, 0);
                const status = STATUS_CONFIG[r.status] || { label: r.status, className: 'bg-gray-100 text-gray-500' };
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-600">{new Date(r.createdAt).toLocaleDateString('es-CL')}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{r.client?.name}</td>
                    <td className="px-4 py-3 text-center text-gray-600">{r.items.length}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">{fmt(total)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status.className}`}>{status.label}</span>
                      {r.status === 'REJECTED' && r.rejectionReason && (
                        <p className="text-xs text-red-500 mt-1">{r.rejectionReason}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.status === 'PENDING' && (
                        <button onClick={() => handleCancel(r.id)}
                          className="text-xs text-red-400 hover:text-red-600 font-medium">
                          Cancelar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

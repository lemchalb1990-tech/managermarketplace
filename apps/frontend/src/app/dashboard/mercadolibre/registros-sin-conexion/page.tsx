'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { useDashboardTimezone } from '@/lib/dashboardTimezone';
import { useAdminCompany } from '../../AdminCompanyContext';
import { confirmDialog, alertDialog } from '../../ConfirmDialog';

const CHANNEL_LABEL: Record<string, string> = {
  MERCADO_LIBRE: 'Mercado Libre', SHOPIFY: 'Shopify', WOOCOMMERCE: 'WooCommerce',
  JUMPSELLER: 'JumpSeller', FALABELLA: 'Falabella', PARIS: 'Paris',
  HITES: 'Hites', RIPLEY: 'Ripley', WALMART: 'Walmart',
};

export default function RegistrosSinConexionPage() {
  const tz = useDashboardTimezone();
  const { companies } = useAdminCompany();
  const [companyFilter, setCompanyFilter] = useState('');
  const [sales, setSales] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  async function load(p = 1, companyId = companyFilter) {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.pos.orphanedSales(token, p, companyId || undefined);
      setSales(res.sales);
      setTotal(res.total);
      setPage(res.page);
      setPages(res.pages);
      setSelectedIds(new Set());
    } catch (err: any) {
      setError(err.message || 'No se pudieron cargar los registros.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(1); }, []);

  function handleCompanyFilterChange(id: string) {
    setCompanyFilter(id);
    load(1, id);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => (prev.size === sales.length ? new Set() : new Set(sales.map((s) => s.id))));
  }

  async function handleDelete(id: string) {
    if (!(await confirmDialog('¿Eliminar esta venta huérfana? Esta acción no se puede deshacer.', { danger: true }))) return;
    setDeletingId(id);
    try {
      const token = getToken()!;
      await api.pos.deleteSale(id, token);
      await load(page);
    } catch (err: any) {
      await alertDialog(err.message || 'No se pudo eliminar. Puede tener movimientos de stock, factura u orden asociados.');
    } finally {
      setDeletingId('');
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    if (!(await confirmDialog(`¿Eliminar ${selectedIds.size} registro(s) seleccionado(s)? Esta acción no se puede deshacer.`, { danger: true }))) return;
    setBulkDeleting(true);
    try {
      const token = getToken()!;
      const res = await api.pos.bulkDeleteSales(Array.from(selectedIds), token);
      await load(page);
      if (res.failed.length > 0) {
        await alertDialog(`${res.deleted} eliminado(s). ${res.failed.length} no se pudieron eliminar (tienen movimientos de stock, factura u orden asociados).`);
      }
    } catch (err: any) {
      await alertDialog(err.message || 'No se pudieron eliminar los registros seleccionados.');
    } finally {
      setBulkDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm text-gray-400">Mercado Libre</span>
        <span className="text-gray-300">/</span>
        <span className="text-sm text-gray-600 font-medium">Registros sin conexión</span>
      </div>

      <div>
        <h1 className="text-[1.375rem] font-bold text-gray-900">Registros sin conexión</h1>
        <p className="text-xs text-gray-500 mt-1">
          Ventas de un canal con cuenta (Mercado Libre, Shopify, etc.) cuya conexión ya fue desconectada.
          Se conservan en el historial y en los totales de ventas, pero no se mezclan en ningún desglose por canal/tienda.
          Solo Super Admin las ve acá para revisarlas o eliminarlas si corresponde.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <select
          value={companyFilter}
          onChange={(e) => handleCompanyFilterChange(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white min-w-[220px]"
        >
          <option value="">Todas las empresas</option>
          {companies.map((c: any) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {selectedIds.size > 0 && (
          <button onClick={handleBulkDelete} disabled={bulkDeleting}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
            {bulkDeleting ? 'Eliminando...' : `Eliminar seleccionados (${selectedIds.size})`}
          </button>
        )}
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 w-10">
                <input type="checkbox" checked={sales.length > 0 && selectedIds.size === sales.length}
                  onChange={toggleSelectAll} />
              </th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Empresa</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Canal</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">ID externo</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Total</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Fecha</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Cargando...</td></tr>
            )}
            {!loading && sales.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <input type="checkbox" checked={selectedIds.has(s.id)} onChange={() => toggleSelect(s.id)} />
                </td>
                <td className="px-4 py-3 font-medium text-gray-900">{s.company?.name || '—'}</td>
                <td className="px-4 py-3 text-gray-600">{CHANNEL_LABEL[s.channel] || s.channel}</td>
                <td className="px-4 py-3 text-gray-500 font-mono text-xs">{s.externalId || '—'}</td>
                <td className="px-4 py-3 text-gray-900">${Number(s.total).toLocaleString('es-CL')}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {new Date(s.createdAt).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric', timeZone: tz })}
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => handleDelete(s.id)} disabled={deletingId === s.id}
                    className="text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-50">
                    {deletingId === s.id ? 'Eliminando...' : 'Eliminar'}
                  </button>
                </td>
              </tr>
            ))}
            {!loading && sales.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                  <p className="text-sm">Sin registros huérfanos.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>{total} registro(s)</span>
          <div className="flex gap-2">
            <button onClick={() => load(page - 1)} disabled={page <= 1}
              className="px-3 py-1.5 border border-gray-300 rounded-lg disabled:opacity-40">
              ← Anterior
            </button>
            <span className="px-2 py-1.5">Página {page} de {pages}</span>
            <button onClick={() => load(page + 1)} disabled={page >= pages}
              className="px-3 py-1.5 border border-gray-300 rounded-lg disabled:opacity-40">
              Siguiente →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api, type TransferDocument, type TransferStatus } from '@/lib/api';
import { useDashboardTimezone } from '@/lib/dashboardTimezone';
import { inputCls } from '@/components/ui/Modal';
import { TransferDetailModal, TransferFormModal } from './TransferModals';
import { TRANSFER_STATUS, fmtDateTime, fmtQty, useDebounced, type InventoryContext } from './shared';

const FILTERS: Array<{ key: '' | TransferStatus; label: string }> = [
  { key: '', label: 'Todos' },
  { key: 'DRAFT', label: 'Borradores' },
  { key: 'IN_TRANSIT', label: 'En tránsito' },
  { key: 'RECEIVED', label: 'Recibidos' },
  { key: 'RECEIVED_WITH_DIFF', label: 'Con diferencia' },
  { key: 'CANCELLED', label: 'Anulados' },
];

export function TransfersTab({ ctx }: { ctx: InventoryContext }) {
  const tz = useDashboardTimezone();
  const openId = ctx.params.get('transferId');
  const warehouseId = ctx.params.get('warehouseId') || '';
  const [status, setStatus] = useState<'' | TransferStatus>('');
  const [search, setSearch] = useState('');
  const [docs, setDocs] = useState<TransferDocument[]>([]);
  const [meta, setMeta] = useState({ total: 0, pages: 1, byStatus: {} as Record<string, number> });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const debounced = useDebounced(search);
  // La página vuelve a 1 cuando cambia cualquier filtro (derivado, sin efecto extra).
  const filterKey = JSON.stringify([status, warehouseId, debounced, ctx.companyId]);
  const [paging, setPaging] = useState({ key: filterKey, page: 1 });
  const page = paging.key === filterKey ? paging.page : 1;
  const setPage = (fn: (p: number) => number) => setPaging({ key: filterKey, page: fn(page) });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.inventory.transfers.list({ companyId: ctx.companyId, status: status || undefined, warehouseId: warehouseId || undefined, search: debounced || undefined, page }, getToken()!);
      setDocs(res.documents);
      setMeta({ total: res.total, pages: res.pages, byStatus: res.byStatus });
    } catch (err: any) {
      setError(err.message || 'No se pudieron cargar los traspasos');
    } finally {
      setLoading(false);
    }
  }, [ctx.companyId, status, warehouseId, debounced, page]);

  useEffect(() => { load(); }, [load]);

  const allCount = Object.values(meta.byStatus).reduce((s, n) => s + n, 0);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {FILTERS.map((f) => {
          const n = f.key ? meta.byStatus[f.key] ?? 0 : allCount;
          const on = status === f.key;
          return (
            <button key={f.key || 'all'} onClick={() => setStatus(f.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${on ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
              {f.label}{n ? <span className={`ml-1.5 ${on ? 'text-white/70' : 'text-gray-400'}`}>{n}</span> : null}
            </button>
          );
        })}
        {ctx.perms.transfer && (
          <button onClick={() => setCreating(true)} className="ml-auto px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold">
            + Nuevo traspaso
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-3 mb-4 flex flex-wrap gap-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por N° (TR-000012), producto u observación"
          className={`${inputCls} flex-1 min-w-[220px]`} />
        <select value={warehouseId} onChange={(e) => ctx.setQuery({ warehouseId: e.target.value || undefined }, true)} className={`${inputCls} w-52`}>
          <option value="">Todas las bodegas</option>
          {ctx.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>

      {error && <div className="mb-3 px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading && docs.length === 0 ? (
          <div className="px-4 py-10 text-center text-gray-400 text-sm">Cargando...</div>
        ) : docs.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-400">
            <p className="text-sm font-medium mb-1">Sin traspasos</p>
            <p className="text-xs">{ctx.perms.transfer ? 'Crea un traspaso para mover mercadería entre bodegas.' : 'Todavía no hay traspasos registrados.'}</p>
          </div>
        ) : (
          <table className={`w-full text-sm ${loading ? 'opacity-60' : ''}`}>
            <thead className="bg-gray-50 border-b border-gray-200 text-xs">
              <tr>
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium">N°</th>
                <th className="text-left px-3 py-2.5 text-gray-600 font-medium">Origen → Destino</th>
                <th className="text-left px-3 py-2.5 text-gray-600 font-medium">Productos</th>
                <th className="text-right px-3 py-2.5 text-gray-600 font-medium">Unidades</th>
                <th className="text-left px-3 py-2.5 text-gray-600 font-medium">Estado</th>
                <th className="text-left px-3 py-2.5 text-gray-600 font-medium">Última acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {docs.map((d) => {
                const units = d.lines.reduce((s, l) => s + l.quantity, 0);
                const last = d.cancelledAt ? { t: 'Anulado', at: d.cancelledAt, by: d.cancelledBy }
                  : d.receivedAt ? { t: 'Recibido', at: d.receivedAt, by: d.receivedBy }
                  : d.dispatchedAt ? { t: 'Despachado', at: d.dispatchedAt, by: d.dispatchedBy }
                  : { t: 'Creado', at: d.createdAt, by: d.createdBy };
                return (
                  <tr key={d.id} onClick={() => ctx.setQuery({ transferId: d.id })} className="hover:bg-gray-50 cursor-pointer">
                    <td className="px-4 py-2.5 font-mono text-xs font-semibold text-gray-800 whitespace-nowrap">{d.documentNumber}</td>
                    <td className="px-3 py-2.5 text-gray-700">{d.fromWarehouse.name} <span className="text-gray-400">→</span> {d.toWarehouse.name}</td>
                    <td className="px-3 py-2.5 text-gray-600 max-w-[260px] truncate">
                      {d.lines.slice(0, 2).map((l) => l.product.name).join(', ')}{d.lines.length > 2 ? ` y ${d.lines.length - 2} más` : ''}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">{fmtQty(units)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${TRANSFER_STATUS[d.status].cls}`}>{TRANSFER_STATUS[d.status].label}</span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                      {last.t} {fmtDateTime(last.at, tz)}{last.by ? ` · ${last.by.name}` : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {meta.pages > 1 && (
        <div className="flex items-center justify-end gap-2 mt-3 text-xs text-gray-500">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1 border border-gray-300 rounded-lg disabled:opacity-40">← Anterior</button>
          <span>Página {page} de {meta.pages}</span>
          <button onClick={() => setPage((p) => Math.min(meta.pages, p + 1))} disabled={page >= meta.pages} className="px-3 py-1 border border-gray-300 rounded-lg disabled:opacity-40">Siguiente →</button>
        </div>
      )}

      {creating && (
        <TransferFormModal ctx={ctx} prefill={{ fromWarehouseId: warehouseId || undefined }} onClose={() => setCreating(false)}
          onSaved={(doc) => { setCreating(false); load(); ctx.setQuery({ transferId: doc.id }); }} />
      )}
      {openId && (
        <TransferDetailModal key={openId} ctx={ctx} id={openId} onClose={() => ctx.setQuery({ transferId: undefined }, true)} onChanged={load} />
      )}
    </div>
  );
}

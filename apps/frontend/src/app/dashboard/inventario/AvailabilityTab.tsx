'use client';

import { useCallback, useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api, type InventoryAvailability, type InventoryRow } from '@/lib/api';
import { useDashboardTimezone, dateKeyInTz } from '@/lib/dashboardTimezone';
import { inputCls } from '@/components/ui/Modal';
import { AdjustModal } from './AdjustModal';
import { TransferFormModal } from './TransferModals';
import { fmtMoney, fmtQty, useDebounced, type InventoryContext } from './shared';

export function AvailabilityTab({ ctx }: { ctx: InventoryContext }) {
  const tz = useDashboardTimezone();
  const warehouseId = ctx.params.get('warehouseId') || '';
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [onlyStock, setOnlyStock] = useState(true);
  const [belowCritical, setBelowCritical] = useState(false);
  const [at, setAt] = useState('');
  const [data, setData] = useState<InventoryAvailability | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [adjusting, setAdjusting] = useState<InventoryRow | null>(null);
  const [transferFor, setTransferFor] = useState<{ row?: InventoryRow } | null>(null);
  const debouncedSearch = useDebounced(search);
  // La página vuelve a 1 cuando cambia cualquier filtro (derivado, sin efecto extra).
  const filterKey = JSON.stringify([warehouseId, debouncedSearch, category, onlyStock, belowCritical, at, ctx.companyId]);
  const [paging, setPaging] = useState({ key: filterKey, page: 1 });
  const page = paging.key === filterKey ? paging.page : 1;
  const setPage = (fn: (p: number) => number) => setPaging({ key: filterKey, page: fn(page) });

  const filters = { companyId: ctx.companyId, warehouseId: warehouseId || undefined, search: debouncedSearch || undefined, category: category || undefined, onlyStock, belowCritical, at: at || undefined };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.inventory.availability({ ...filters, page, pageSize: 50 }, getToken()!));
    } catch (err: any) {
      setError(err.message || 'No se pudo cargar el inventario');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.companyId, warehouseId, debouncedSearch, category, onlyStock, belowCritical, at, page]);

  useEffect(() => { load(); }, [load]);

  async function exportCsv() {
    setExporting(true);
    try { await api.inventory.exportAvailability(filters, getToken()!); }
    catch (err: any) { setError(err.message || 'No se pudo exportar'); }
    finally { setExporting(false); }
  }

  const whs = data?.warehouses ?? [];
  const shownWhs = warehouseId ? whs.filter((w) => w.id === warehouseId) : whs;
  const single = !!warehouseId;
  const historical = !!data?.at;

  return (
    <div>
      {/* Resumen por bodega */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {whs.map((w) => {
          const on = w.id === warehouseId;
          return (
            <button key={w.id} onClick={() => ctx.setQuery({ warehouseId: on ? undefined : w.id }, true)}
              className={`text-left rounded-xl border p-3.5 transition-colors ${on ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
              <p className="text-xs font-semibold text-gray-700 truncate">{w.name}{!w.active && <span className="font-normal text-gray-400"> · inactiva</span>}</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-gray-900">{fmtQty(w.units)} <span className="text-xs font-normal text-gray-500">u.</span></p>
              <p className="text-[11px] text-gray-500">{w.skus} SKUs · {fmtMoney(w.value)}</p>
              {w.inTransitIn > 0 && <p className="text-[11px] text-amber-700 mt-0.5">{fmtQty(w.inTransitIn)} u. en camino</p>}
            </button>
          );
        })}
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 mb-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Buscar</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="SKU o nombre" className={inputCls} />
        </div>
        <div className="w-44">
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Bodega</label>
          <select value={warehouseId} onChange={(e) => ctx.setQuery({ warehouseId: e.target.value || undefined }, true)} className={inputCls}>
            <option value="">Todas</option>
            {ctx.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div className="w-44">
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Categoría</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
            <option value="">Todas</option>
            {(data?.categories ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="w-40">
          <label className="block text-[11px] font-medium text-gray-500 mb-1" title="Reconstruido desde el historial de movimientos">Stock al día</label>
          <input type="date" value={at} max={dateKeyInTz(tz)} onChange={(e) => setAt(e.target.value)} className={inputCls} />
        </div>
        <div className="flex flex-col gap-1 text-xs text-gray-600 pb-1">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={onlyStock} onChange={(e) => setOnlyStock(e.target.checked)} /> Solo con stock</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={belowCritical} onChange={(e) => setBelowCritical(e.target.checked)} /> Bajo stock crítico</label>
        </div>
        <div className="flex gap-2 ml-auto">
          <button onClick={exportCsv} disabled={exporting} className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {exporting ? 'Exportando...' : 'Exportar Excel'}
          </button>
          {ctx.perms.transfer && (
            <button onClick={() => setTransferFor({})} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold">
              Nuevo traspaso
            </button>
          )}
        </div>
      </div>

      {historical && (
        <div className="mb-3 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          Stock al cierre del {data!.at}, reconstruido desde el historial de movimientos. Los movimientos anteriores al historial por bodega no se consideran.
        </div>
      )}
      {error && <div className="mb-3 px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading && !data ? (
          <div className="px-4 py-10 text-center text-gray-400 text-sm">Cargando...</div>
        ) : !data || data.rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-400 text-sm">No hay productos con estos filtros.</div>
        ) : (
          <table className={`w-full text-sm ${loading ? 'opacity-60' : ''}`}>
            <thead className="bg-gray-50 border-b border-gray-200 text-xs">
              <tr>
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium">Producto</th>
                {single ? (
                  <>
                    <th className="text-right px-3 py-2.5 text-gray-600 font-medium">Físico</th>
                    <th className="text-right px-3 py-2.5 text-gray-600 font-medium" title="Reservado por órdenes de trabajo">Reservado</th>
                    <th className="text-right px-3 py-2.5 text-gray-600 font-medium">Disponible</th>
                    <th className="text-right px-3 py-2.5 text-gray-600 font-medium">En camino</th>
                  </>
                ) : shownWhs.map((w) => (
                  <th key={w.id} className="text-right px-3 py-2.5 text-gray-600 font-medium whitespace-nowrap">{w.name}</th>
                ))}
                <th className="text-right px-3 py-2.5 text-gray-600 font-medium">Total</th>
                <th className="text-right px-3 py-2.5 text-gray-600 font-medium">Valor</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.rows.map((r) => {
                const s = single ? r.stock[warehouseId] : undefined;
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-gray-900">{r.name}</p>
                      <p className="text-[11px] text-gray-400">
                        {r.sku}{r.category ? ` · ${r.category}` : ''}
                        {r.belowCritical && <span className="ml-1.5 text-red-600 font-semibold">bajo crítico ({r.criticalStock})</span>}
                        {r.mismatch && ctx.perms.adjust && (
                          <button onClick={() => ctx.goTo('cuadratura')} className="ml-1.5 text-orange-600 font-semibold hover:underline">descuadre</button>
                        )}
                      </p>
                    </td>
                    {single ? (
                      <>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">{fmtQty(s?.quantity)}</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-gray-500">{s?.reserved ? fmtQty(s.reserved) : '—'}</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums font-semibold">{fmtQty(s?.available)}</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-amber-700">{r.inTransitIn[warehouseId] ? `+${fmtQty(r.inTransitIn[warehouseId])}` : '—'}</td>
                      </>
                    ) : shownWhs.map((w) => {
                      const cell = r.stock[w.id];
                      const incoming = r.inTransitIn[w.id];
                      return (
                        <td key={w.id} className="px-3 py-2.5 text-right font-mono tabular-nums">
                          <span className={cell?.quantity ? 'text-gray-900' : 'text-gray-300'}>{fmtQty(cell?.quantity)}</span>
                          {cell?.reserved ? <span className="block text-[10px] text-gray-400">{fmtQty(cell.reserved)} reserv.</span> : null}
                          {incoming ? <span className="block text-[10px] text-amber-700">+{fmtQty(incoming)} en camino</span> : null}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums font-semibold">{fmtQty(r.total)}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-gray-500">{fmtMoney(r.value)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap text-xs font-medium">
                      <div className="flex gap-3 justify-end">
                        <button onClick={() => ctx.goTo('historial', { productId: r.id, warehouseId: warehouseId || undefined })} className="text-blue-600 hover:text-blue-800">Historial</button>
                        {ctx.perms.adjust && !historical && <button onClick={() => setAdjusting(r)} className="text-gray-600 hover:text-gray-900">Ajustar</button>}
                        {ctx.perms.transfer && !historical && <button onClick={() => setTransferFor({ row: r })} className="text-gray-600 hover:text-gray-900">Traspasar</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {data && data.pages > 1 && (
        <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
          <span>{fmtQty(data.total)} productos</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1 border border-gray-300 rounded-lg disabled:opacity-40">← Anterior</button>
            <span>Página {data.page} de {data.pages}</span>
            <button onClick={() => setPage((p) => Math.min(data.pages, p + 1))} disabled={page >= data.pages} className="px-3 py-1 border border-gray-300 rounded-lg disabled:opacity-40">Siguiente →</button>
          </div>
        </div>
      )}

      {adjusting && (
        <AdjustModal row={adjusting} warehouses={ctx.warehouses} defaultWarehouseId={warehouseId || undefined} companyId={ctx.companyId}
          onClose={() => setAdjusting(null)} onSaved={() => { setAdjusting(null); load(); }} />
      )}
      {transferFor && (
        <TransferFormModal ctx={ctx} prefill={transferFor.row ? {
          productId: transferFor.row.id, sku: transferFor.row.sku, name: transferFor.row.name,
          fromWarehouseId: warehouseId || Object.entries(transferFor.row.stock).sort((a, b) => b[1].available - a[1].available)[0]?.[0],
        } : { fromWarehouseId: warehouseId || undefined }}
          onClose={() => setTransferFor(null)}
          onSaved={(doc) => { setTransferFor(null); load(); ctx.goTo('traspasos', { transferId: doc.id }); }} />
      )}
    </div>
  );
}

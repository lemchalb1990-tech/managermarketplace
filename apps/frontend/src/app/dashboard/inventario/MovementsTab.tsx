'use client';

import { useCallback, useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api, type InventoryMovements } from '@/lib/api';
import { useDashboardTimezone } from '@/lib/dashboardTimezone';
import { inputCls } from '@/components/ui/Modal';
import { MOVEMENT_TYPES, fmtDateTime, fmtMoney, fmtQty, movementTypeCls, useDebounced, type InventoryContext } from './shared';

// Kardex: todos los movimientos de stock con fecha, documento, bodega, entrada/salida y
// saldo de la bodega después del movimiento. Filtrable por producto, bodega, tipo,
// documento y rango de fechas; exportable.
export function MovementsTab({ ctx }: { ctx: InventoryContext }) {
  const tz = useDashboardTimezone();
  const productId = ctx.params.get('productId') || '';
  const warehouseId = ctx.params.get('warehouseId') || '';
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [document, setDocument] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<InventoryMovements | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const dSearch = useDebounced(search);
  const dDocument = useDebounced(document);
  // La página vuelve a 1 cuando cambia cualquier filtro (derivado, sin efecto extra).
  const filterKey = JSON.stringify([productId, warehouseId, dSearch, type, dDocument, from, to, ctx.companyId]);
  const [paging, setPaging] = useState({ key: filterKey, page: 1 });
  const page = paging.key === filterKey ? paging.page : 1;
  const setPage = (fn: (p: number) => number) => setPaging({ key: filterKey, page: fn(page) });

  const filters = {
    companyId: ctx.companyId, productId: productId || undefined, warehouseId: warehouseId || undefined,
    search: productId ? undefined : dSearch || undefined, type: type || undefined, document: dDocument || undefined,
    from: from || undefined, to: to || undefined,
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.inventory.movements({ ...filters, page }, getToken()!));
    } catch (err: any) {
      setError(err.message || 'No se pudo cargar el historial');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.companyId, productId, warehouseId, dSearch, type, dDocument, from, to, page]);

  useEffect(() => { load(); }, [load]);

  async function exportCsv() {
    setExporting(true);
    try { await api.inventory.exportMovements(filters, getToken()!); }
    catch (err: any) { setError(err.message || 'No se pudo exportar'); }
    finally { setExporting(false); }
  }

  const productName = productId && data?.items[0]?.product.id === productId ? data.items[0].product : null;

  return (
    <div>
      {productId && (
        <div className="mb-3 flex items-center gap-3 px-4 py-2.5 bg-blue-50 border border-blue-100 rounded-lg text-sm">
          <span className="text-blue-900">
            Historial de <b>{productName ? `${productName.sku} · ${productName.name}` : 'un producto'}</b>
            {warehouseId && <> en <b>{ctx.warehouses.find((w) => w.id === warehouseId)?.name}</b></>}
          </span>
          <button onClick={() => ctx.setQuery({ productId: undefined }, true)} className="ml-auto text-xs font-semibold text-blue-700 hover:underline">
            Ver todos los productos
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-3 mb-4 flex flex-wrap items-end gap-3">
        {!productId && (
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[11px] font-medium text-gray-500 mb-1">Producto</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="SKU o nombre" className={inputCls} />
          </div>
        )}
        <div className="w-44">
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Bodega</label>
          <select value={warehouseId} onChange={(e) => ctx.setQuery({ warehouseId: e.target.value || undefined }, true)} className={inputCls}>
            <option value="">Todas</option>
            {ctx.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div className="w-44">
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Tipo</label>
          <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
            <option value="">Todos</option>
            <option value="TRANSFER_OUT,TRANSFER_IN">Traspasos (entrada y salida)</option>
            {MOVEMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="w-40">
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Documento</label>
          <input value={document} onChange={(e) => setDocument(e.target.value)} placeholder="TR-000012, N° venta..." className={inputCls} />
        </div>
        <div className="w-36">
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Desde</label>
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        </div>
        <div className="w-36">
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Hasta</label>
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        </div>
        <button onClick={exportCsv} disabled={exporting} className="ml-auto px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {exporting ? 'Exportando...' : 'Exportar Excel'}
        </button>
      </div>

      {data && (
        <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
          <span>{fmtQty(data.total)} movimientos</span>
          <span>Entradas: <b className="text-emerald-700">+{fmtQty(data.summary.entries)}</b></span>
          <span>Salidas: <b className="text-red-600">−{fmtQty(data.summary.exits)}</b></span>
        </div>
      )}
      {error && <div className="mb-3 px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading && !data ? (
          <div className="px-4 py-10 text-center text-gray-400 text-sm">Cargando...</div>
        ) : !data || data.items.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-400 text-sm">No hay movimientos con estos filtros.</div>
        ) : (
          <table className={`w-full text-sm ${loading ? 'opacity-60' : ''}`}>
            <thead className="bg-gray-50 border-b border-gray-200 text-xs">
              <tr>
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium">Fecha</th>
                <th className="text-left px-3 py-2.5 text-gray-600 font-medium">Movimiento</th>
                {!productId && <th className="text-left px-3 py-2.5 text-gray-600 font-medium">Producto</th>}
                <th className="text-left px-3 py-2.5 text-gray-600 font-medium">Bodega</th>
                <th className="text-right px-3 py-2.5 text-gray-600 font-medium">Entrada</th>
                <th className="text-right px-3 py-2.5 text-gray-600 font-medium">Salida</th>
                <th className="text-right px-3 py-2.5 text-gray-600 font-medium" title="Stock de la bodega después del movimiento">Saldo</th>
                <th className="text-left px-3 py-2.5 text-gray-600 font-medium">Usuario / motivo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.items.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50 align-top">
                  <td className="px-4 py-2.5 text-xs text-gray-600 whitespace-nowrap">{fmtDateTime(m.createdAt, tz)}</td>
                  <td className="px-3 py-2.5">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${movementTypeCls(m.type)}`}>{m.typeLabel}</span>
                    {m.documentNumber && (
                      m.referenceType === 'TRANSFER' && m.referenceId ? (
                        <button onClick={() => ctx.goTo('traspasos', { transferId: m.referenceId! })} className="block mt-1 font-mono text-[11px] text-blue-600 hover:underline">{m.documentNumber}</button>
                      ) : (
                        <span className="block mt-1 font-mono text-[11px] text-gray-500">{m.documentNumber}</span>
                      )
                    )}
                  </td>
                  {!productId && (
                    <td className="px-3 py-2.5">
                      <button onClick={() => ctx.setQuery({ productId: m.product.id }, true)} className="text-left hover:text-blue-600">
                        <span className="block text-gray-900">{m.product.name}</span>
                        <span className="block text-[11px] text-gray-400">{m.product.sku}</span>
                      </button>
                    </td>
                  )}
                  <td className="px-3 py-2.5 text-gray-600">{m.warehouse?.name ?? <span className="text-gray-300" title="Movimiento anterior al registro por bodega">Sin bodega</span>}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-emerald-700">{m.in ? `+${fmtQty(m.in)}` : ''}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-red-600">{m.out ? `−${fmtQty(m.out)}` : ''}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums font-semibold">{m.balanceAfter != null ? fmtQty(m.balanceAfter) : <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-500 max-w-[280px]">
                    {m.user && <span className="block text-gray-700">{m.user.name}</span>}
                    {m.reason && <span className="block">{m.reason}</span>}
                    {m.unitCost != null && <span className="block text-gray-400">Costo {fmtMoney(m.unitCost)} c/u</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data && data.pages > 1 && (
        <div className="flex items-center justify-end gap-2 mt-3 text-xs text-gray-500">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1 border border-gray-300 rounded-lg disabled:opacity-40">← Anterior</button>
          <span>Página {data.page} de {data.pages}</span>
          <button onClick={() => setPage((p) => Math.min(data.pages, p + 1))} disabled={page >= data.pages} className="px-3 py-1 border border-gray-300 rounded-lg disabled:opacity-40">Siguiente →</button>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';

type OrderItem = { title: string; quantity: number; unitPrice: number; resolved: boolean; productName: string | null };
type OrderPreview = {
  externalId: string; date: string; total: number; buyerNickname: string | null;
  importable: boolean; items: OrderItem[];
};

const PAGE_SIZE = 20;

function firstDayOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
}
function today() {
  return new Date().toISOString().split('T')[0];
}

export function SalesImportModal({
  connectionId,
  connectionName,
  onClose,
}: {
  connectionId: string;
  connectionName: string;
  onClose: () => void;
}) {
  const [from, setFrom] = useState(firstDayOfMonth());
  const [to, setTo] = useState(today());
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [orders, setOrders] = useState<OrderPreview[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [alreadyImportedCount, setAlreadyImportedCount] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);
  const [page, setPage] = useState(0);

  async function handleSearch() {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const token = getToken()!;
      const data = await api.marketplace.previewSalesImport(connectionId, { from, to }, token);
      setOrders(data.orders);
      setTruncated(data.truncated);
      setAlreadyImportedCount(data.alreadyImportedCount);
      setSelected(new Set(data.orders.filter((o) => o.importable).map((o) => o.externalId)));
      setPage(0);
      setSearched(true);
    } catch (err: any) {
      setError(err.message || 'No se pudieron obtener las ventas de Mercado Libre.');
    } finally {
      setLoading(false);
    }
  }

  function toggle(externalId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(externalId)) next.delete(externalId); else next.add(externalId);
      return next;
    });
  }

  function toggleAll() {
    const importableIds = orders.filter((o) => o.importable).map((o) => o.externalId);
    const allSelected = importableIds.every((id) => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(importableIds));
  }

  async function handleConfirm() {
    if (selected.size === 0) return;
    setImporting(true);
    setError('');
    try {
      const token = getToken()!;
      const res = await api.marketplace.confirmSalesImport(connectionId, Array.from(selected), token);
      setResult(res);
    } catch (err: any) {
      setError(err.message || 'Error al importar las ventas.');
    } finally {
      setImporting(false);
    }
  }

  const importableCount = orders.filter((o) => o.importable).length;
  const unresolvedCount = orders.length - importableCount;
  const pageCount = Math.max(1, Math.ceil(orders.length / PAGE_SIZE));
  const pagedOrders = orders.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-4xl max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-semibold text-gray-900">Importar ventas de "{connectionName}"</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Trae ventas ya realizadas en Mercado Libre como historial. No descuenta stock ni genera movimientos de inventario.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-4 border-b border-gray-100 flex items-end gap-3 shrink-0">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Desde</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Hasta</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <button onClick={handleSearch} disabled={loading}
            className="px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-lg text-sm font-semibold disabled:opacity-50">
            {loading ? 'Buscando...' : 'Buscar ventas'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="m-6 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          {!error && result && (
            <div className="p-6 space-y-3">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800">
                <p className="font-semibold mb-1">Importación completada</p>
                <p>{result.imported} venta(s) importada(s), {result.skipped} omitida(s) (ya existían).</p>
              </div>
              {result.errors.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-xs text-amber-800 space-y-1">
                  {result.errors.map((e, i) => <p key={i}>{e}</p>)}
                </div>
              )}
            </div>
          )}

          {!error && !result && searched && (
            orders.length === 0 ? (
              <div className="p-12 text-center text-gray-400 text-sm">
                {alreadyImportedCount > 0
                  ? 'Todas las ventas de este período ya fueron importadas.'
                  : 'No se encontraron ventas en el período seleccionado.'}
              </div>
            ) : (
              <>
                {truncated && (
                  <div className="mx-6 mt-4 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                    Se encontraron más ventas de las que se muestran aquí. Acota el rango de fechas para verlas todas.
                  </div>
                )}
                <div className="mx-6 mt-4 flex gap-4 text-xs text-gray-500">
                  <span>{importableCount} listas para importar</span>
                  {unresolvedCount > 0 && <span>{unresolvedCount} con productos no vinculados en el catálogo</span>}
                  {alreadyImportedCount > 0 && <span>{alreadyImportedCount} ya importadas (no se muestran)</span>}
                </div>
                <table className="w-full text-sm mt-3">
                  <thead className="bg-gray-50 border-y border-gray-200 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left">
                        <input type="checkbox"
                          checked={importableCount > 0 && orders.filter(o => o.importable).every(o => selected.has(o.externalId))}
                          onChange={toggleAll} />
                      </th>
                      <th className="px-2 py-2 text-left text-gray-600 font-medium">Fecha</th>
                      <th className="px-2 py-2 text-left text-gray-600 font-medium">Comprador</th>
                      <th className="px-2 py-2 text-left text-gray-600 font-medium">Productos</th>
                      <th className="px-2 py-2 text-right text-gray-600 font-medium">Total</th>
                      <th className="px-2 py-2 text-left text-gray-600 font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pagedOrders.map((o) => (
                      <tr key={o.externalId} className={o.importable ? 'hover:bg-gray-50' : 'opacity-50'}>
                        <td className="px-4 py-2">
                          <input type="checkbox" disabled={!o.importable}
                            checked={selected.has(o.externalId)} onChange={() => toggle(o.externalId)} />
                        </td>
                        <td className="px-2 py-2 text-gray-700 whitespace-nowrap">
                          {new Date(o.date).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        </td>
                        <td className="px-2 py-2 text-gray-600">{o.buyerNickname || '—'}</td>
                        <td className="px-2 py-2 text-gray-700">
                          {o.items.map((it, i) => (
                            <div key={i} className="text-xs">
                              {it.quantity}× {it.productName || it.title}
                              {!it.resolved && <span className="text-red-500 ml-1">(sin vincular)</span>}
                            </div>
                          ))}
                        </td>
                        <td className="px-2 py-2 text-right text-gray-700">${Math.round(o.total).toLocaleString('es-CL')}</td>
                        <td className="px-2 py-2">
                          {o.importable
                            ? <span className="text-xs text-green-600">Lista</span>
                            : <span className="text-xs text-red-500">No importable</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {pageCount > 1 && (
                  <div className="flex items-center justify-center gap-3 py-3 border-t border-gray-100">
                    <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                      className="px-3 py-1 border border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                      ← Anterior
                    </button>
                    <span className="text-xs text-gray-500">Página {page + 1} de {pageCount}</span>
                    <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}
                      className="px-3 py-1 border border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                      Siguiente →
                    </button>
                  </div>
                )}
              </>
            )
          )}

          {!error && !result && !searched && !loading && (
            <div className="p-12 text-center text-gray-400 text-sm">
              Elige un rango de fechas y haz clic en "Buscar ventas".
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between shrink-0">
          {result ? (
            <>
              <span />
              <button onClick={onClose} className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold">
                Cerrar
              </button>
            </>
          ) : (
            <>
              <span className="text-xs text-gray-500">{selected.size} seleccionada(s)</span>
              <div className="flex gap-2">
                <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                  Cancelar
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={importing || selected.size === 0}
                  className="px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-lg text-sm font-semibold disabled:opacity-50"
                >
                  {importing ? 'Importando...' : `Importar ${selected.size > 0 ? `(${selected.size})` : ''}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

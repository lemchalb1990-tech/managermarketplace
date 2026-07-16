'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';

type PreviewItem = {
  externalId: string;
  title: string;
  price: number;
  stock: number;
  thumbnail: string | null;
  permalink: string;
  status: string;
  sku: string | null;
  matchedProductId: string | null;
  matchedProductName: string | null;
};

const PAGE_SIZE = 20;

export function ImportModal({
  connectionId,
  connectionName,
  onClose,
  onImported,
}: {
  connectionId: string;
  connectionName: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextScrollId, setNextScrollId] = useState<string | null>(null);
  const [alreadyImportedCount, setAlreadyImportedCount] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; linked: number; skipped: number } | null>(null);
  const [page, setPage] = useState(0);

  async function loadPreview(scrollId: string | null, append: boolean) {
    if (append) setLoadingMore(true); else setLoading(true);
    setError('');
    try {
      const token = getToken()!;
      const data = await api.marketplace.previewImport(connectionId, scrollId, token);
      setItems((prev) => append ? [...prev, ...data.items] : data.items);
      setTotal(data.total);
      setHasMore(data.hasMore);
      setNextScrollId(data.nextScrollId);
      setAlreadyImportedCount((prev) => append ? prev + data.alreadyImportedCount : data.alreadyImportedCount);
      setSelected((prev) => {
        const next = append ? new Set(prev) : new Set<string>();
        data.items.forEach((i) => next.add(i.externalId));
        return next;
      });
      if (!append) setPage(0);
    } catch (err: any) {
      setError(err.message || 'No se pudieron obtener las publicaciones de Mercado Libre.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => { loadPreview(null, false); }, [connectionId]);

  function toggle(externalId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(externalId)) next.delete(externalId); else next.add(externalId);
      return next;
    });
  }

  function toggleAll() {
    const allIds = items.map((i) => i.externalId);
    const allSelected = allIds.every((id) => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(allIds));
  }

  async function handleConfirm() {
    if (selected.size === 0) return;
    setImporting(true);
    setError('');
    try {
      const token = getToken()!;
      const res = await api.marketplace.confirmImport(connectionId, Array.from(selected), token);
      setResult(res);
      onImported();
    } catch (err: any) {
      setError(err.message || 'Error al importar las publicaciones.');
    } finally {
      setImporting(false);
    }
  }

  const newCount = items.filter((i) => !i.matchedProductId).length;
  const matchCount = items.filter((i) => i.matchedProductId).length;
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pagedItems = items.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-4xl max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-semibold text-gray-900">Importar publicaciones de "{connectionName}"</h3>
            <p className="text-xs text-gray-500 mt-0.5">Revisa lo que se traerá antes de confirmar.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-12 text-center text-gray-400 text-sm">Buscando publicaciones en Mercado Libre...</div>
          )}

          {!loading && error && (
            <div className="m-6 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          {!loading && !error && result && (
            <div className="p-6">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800">
                <p className="font-semibold mb-1">Importación completada</p>
                <p>{result.imported} producto(s) nuevo(s) creado(s), {result.linked} vinculado(s) a productos existentes, {result.skipped} omitido(s) (ya importados).</p>
              </div>
            </div>
          )}

          {!loading && !error && !result && (
            <>
              {items.length === 0 ? (
                <div className="p-12 text-center text-gray-400 text-sm">
                  {alreadyImportedCount > 0
                    ? 'Todas las publicaciones de esta cuenta ya fueron importadas.'
                    : 'No se encontraron publicaciones activas en esta cuenta de Mercado Libre.'}
                </div>
              ) : (
                <>
                  <div className="mx-6 mt-4 flex gap-4 text-xs text-gray-500">
                    <span>{newCount} nuevas</span>
                    <span>{matchCount} coinciden por SKU con productos existentes</span>
                    {alreadyImportedCount > 0 && <span>{alreadyImportedCount} ya importadas (no se muestran)</span>}
                  </div>
                  <table className="w-full text-sm mt-3">
                    <thead className="bg-gray-50 border-y border-gray-200 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-left">
                          <input
                            type="checkbox"
                            checked={items.length > 0 && items.every((i) => selected.has(i.externalId))}
                            onChange={toggleAll}
                          />
                        </th>
                        <th className="px-2 py-2 text-left text-gray-600 font-medium">Publicación</th>
                        <th className="px-2 py-2 text-left text-gray-600 font-medium">SKU</th>
                        <th className="px-2 py-2 text-right text-gray-600 font-medium">Precio</th>
                        <th className="px-2 py-2 text-right text-gray-600 font-medium">Stock</th>
                        <th className="px-2 py-2 text-left text-gray-600 font-medium">Acción</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {pagedItems.map((item) => (
                        <tr key={item.externalId} className="hover:bg-gray-50">
                          <td className="px-4 py-2">
                            <input
                              type="checkbox"
                              checked={selected.has(item.externalId)}
                              onChange={() => toggle(item.externalId)}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-2">
                              {item.thumbnail && (
                                <img src={item.thumbnail} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                              )}
                              <a href={item.permalink} target="_blank" rel="noreferrer"
                                className="text-gray-800 hover:text-blue-600 line-clamp-1">
                                {item.title}
                              </a>
                            </div>
                          </td>
                          <td className="px-2 py-2 font-mono text-xs text-gray-500">{item.sku || '—'}</td>
                          <td className="px-2 py-2 text-right text-gray-700">${Math.round(item.price).toLocaleString('es-CL')}</td>
                          <td className="px-2 py-2 text-right text-gray-700">{item.stock}</td>
                          <td className="px-2 py-2">
                            {item.matchedProductId ? (
                              <span className="text-xs text-blue-600">Vincular a "{item.matchedProductName}"</span>
                            ) : (
                              <span className="text-xs text-green-600">Crear producto nuevo</span>
                            )}
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
                  {hasMore && (
                    <div className="flex items-center justify-center py-3 border-t border-gray-100">
                      <button onClick={() => loadPreview(nextScrollId, true)} disabled={loadingMore}
                        className="px-4 py-2 border border-blue-300 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold hover:bg-blue-100 disabled:opacity-50">
                        {loadingMore ? 'Cargando...' : `Cargar más publicaciones (${items.length + alreadyImportedCount} de ${total || '?'})`}
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
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
                  disabled={importing || loading || selected.size === 0}
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

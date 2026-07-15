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
  alreadyLinked: boolean;
  matchedProductId: string | null;
  matchedProductName: string | null;
};

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
  const [error, setError] = useState('');
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; linked: number; skipped: number } | null>(null);

  async function loadPreview() {
    setLoading(true);
    setError('');
    try {
      const token = getToken()!;
      const data = await api.marketplace.previewImport(connectionId, token);
      setItems(data.items);
      setTruncated(data.truncated);
      setSelected(new Set(data.items.filter((i) => !i.alreadyLinked).map((i) => i.externalId)));
    } catch (err: any) {
      setError(err.message || 'No se pudieron obtener las publicaciones de Mercado Libre.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadPreview(); }, [connectionId]);

  function toggle(externalId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(externalId)) next.delete(externalId); else next.add(externalId);
      return next;
    });
  }

  function toggleAll() {
    const selectable = items.filter((i) => !i.alreadyLinked).map((i) => i.externalId);
    const allSelected = selectable.every((id) => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(selectable));
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

  const selectableCount = items.filter((i) => !i.alreadyLinked).length;
  const newCount = items.filter((i) => !i.alreadyLinked && !i.matchedProductId).length;
  const matchCount = items.filter((i) => !i.alreadyLinked && i.matchedProductId).length;

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
              {truncated && (
                <div className="mx-6 mt-4 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                  Se encontraron más publicaciones de las que se muestran aquí. Mostrando las primeras {items.length}.
                </div>
              )}

              {items.length === 0 ? (
                <div className="p-12 text-center text-gray-400 text-sm">
                  No se encontraron publicaciones activas en esta cuenta de Mercado Libre.
                </div>
              ) : (
                <>
                  <div className="mx-6 mt-4 flex gap-4 text-xs text-gray-500">
                    <span>{newCount} nuevas</span>
                    <span>{matchCount} coinciden por SKU con productos existentes</span>
                    <span>{items.length - selectableCount} ya importadas</span>
                  </div>
                  <table className="w-full text-sm mt-3">
                    <thead className="bg-gray-50 border-y border-gray-200 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-left">
                          <input
                            type="checkbox"
                            checked={selectableCount > 0 && selected.size === selectableCount}
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
                      {items.map((item) => (
                        <tr key={item.externalId} className={item.alreadyLinked ? 'opacity-50' : 'hover:bg-gray-50'}>
                          <td className="px-4 py-2">
                            <input
                              type="checkbox"
                              disabled={item.alreadyLinked}
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
                            {item.alreadyLinked ? (
                              <span className="text-xs text-gray-400">Ya importada</span>
                            ) : item.matchedProductId ? (
                              <span className="text-xs text-blue-600">Vincular a "{item.matchedProductName}"</span>
                            ) : (
                              <span className="text-xs text-green-600">Crear producto nuevo</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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

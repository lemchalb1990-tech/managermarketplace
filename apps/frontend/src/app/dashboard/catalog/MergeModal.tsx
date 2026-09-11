'use client';

import { useState } from 'react';
import { imgUrl } from '@/lib/api';

const fmtCLP = (n: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(n);

const MERGE_FIELDS: { key: string; label: string; format: (p: any) => string }[] = [
  { key: 'sku', label: 'SKU', format: (p) => p.sku },
  { key: 'name', label: 'Nombre', format: (p) => p.name },
  { key: 'type', label: 'Tipo', format: (p) => (p.type === 'SERVICIO' ? 'Servicio' : 'Artículo') },
  { key: 'category', label: 'Categoría', format: (p) => p.category || '— Sin categoría —' },
  { key: 'price', label: 'Precio POS', format: (p) => fmtCLP(Number(p.price)) },
  { key: 'mlPrice', label: 'Precio ML', format: (p) => (p.mlPrice != null ? fmtCLP(Number(p.mlPrice)) : '— Sin precio ML —') },
  { key: 'cost', label: 'Costo', format: (p) => (p.cost != null ? fmtCLP(Number(p.cost)) : '— Sin costo —') },
  { key: 'supplierPrice', label: 'Precio proveedor', format: (p) => (p.supplierPrice != null ? fmtCLP(Number(p.supplierPrice)) : '— Sin precio proveedor —') },
  { key: 'stock', label: 'Stock', format: (p) => `${p.stock} unidad(es)` },
  { key: 'criticalStock', label: 'Stock crítico', format: (p) => `${p.criticalStock ?? 0} unidad(es)` },
  { key: 'warehouseId', label: 'Bodega', format: (p) => p.warehouse?.name || '— Sin bodega —' },
  { key: 'mlCategoryId', label: 'Categoría ML', format: (p) => p.mlCategoryId || '— Sin categoría ML —' },
  { key: 'description', label: 'Descripción', format: (p) => (p.description ? (p.description.length > 80 ? `${p.description.slice(0, 80)}…` : p.description) : '— Sin descripción —') },
  { key: 'mlDescription', label: 'Descripción ML', format: (p) => (p.mlDescription ? 'Tiene descripción ML' : '— Sin descripción ML —') },
  { key: 'mlAttributes', label: 'Atributos ML', format: (p) => (Array.isArray(p.mlAttributes) && p.mlAttributes.length ? `${p.mlAttributes.length} atributo(s)` : '— Sin atributos ML —') },
  { key: 'dropship', label: '¿Es dropship?', format: (p) => (p.dropship ? 'Sí' : 'No') },
];

const COUNT_LABELS: { key: string; label: string }[] = [
  { key: 'saleItems', label: 'ítem(s) de venta' },
  { key: 'stockMovements', label: 'movimiento(s) de stock' },
  { key: 'purchaseItems', label: 'ítem(s) de compra' },
  { key: 'listings', label: 'publicación(es)' },
  { key: 'orderItemChecks', label: 'check(s) de órdenes' },
  { key: 'stockTransfers', label: 'traspaso(s) de stock' },
  { key: 'orderRequestItems', label: 'ítem(s) de solicitudes de pedido' },
  { key: 'returnItems', label: 'ítem(s) de devoluciones' },
  { key: 'dropshipOrderItems', label: 'ítem(s) de pedidos dropship' },
];

interface MergeModalProps {
  products: any[];
  connectionConflicts: { connectionId: string; connectionName: string; products: { id: string; name: string }[] }[];
  onClose: () => void;
  onConfirm: (dto: {
    productIds: string[];
    survivorId: string;
    fieldSources: Record<string, string>;
    imagesFromProductId: string | null;
    dropshipFromProductId: string | null;
  }) => void;
  submitting: boolean;
  error: string;
}

export default function MergeModal({ products, connectionConflicts, onClose, onConfirm, submitting, error }: MergeModalProps) {
  const [step, setStep] = useState<'fields' | 'confirm'>('fields');
  const [fieldSources, setFieldSources] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const f of MERGE_FIELDS) initial[f.key] = products[0].id;
    return initial;
  });

  const productsWithImages = products.filter((p) => p.images?.length > 0);
  const productsWithDropship = products.filter((p) => p.dropshipProduct);
  const [imagesFrom, setImagesFrom] = useState<string | null>(productsWithImages[0]?.id || null);
  const [dropshipFrom, setDropshipFrom] = useState<string | null>(productsWithDropship[0]?.id || null);

  const blocked = connectionConflicts.length > 0;
  const survivorId = fieldSources.sku;
  const survivor = products.find((p) => p.id === survivorId);
  const losers = products.filter((p) => p.id !== survivorId);

  const totals = losers.reduce((acc: Record<string, number>, p) => {
    for (const c of COUNT_LABELS) acc[c.key] = (acc[c.key] || 0) + (p._count?.[c.key] || 0);
    return acc;
  }, {});

  function pick(key: string, productId: string) {
    setFieldSources((f) => ({ ...f, [key]: productId }));
  }

  function cellClass(selected: boolean) {
    return `w-full text-left px-2 py-1.5 rounded-lg border text-xs transition ${
      selected ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-gray-200 hover:border-gray-300 text-gray-600'
    }`;
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between shrink-0">
          <div>
            <h2 className="font-bold text-gray-900 text-base">Unificar {products.length} productos</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {blocked
                ? 'Hay un conflicto que impide unificar este grupo.'
                : step === 'fields'
                  ? 'Elige de qué producto viene cada dato del producto final.'
                  : 'Revisa el resumen antes de confirmar.'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none w-8 h-8 flex items-center justify-center shrink-0">×</button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4">
          {blocked ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 space-y-2">
              <p className="font-semibold">No se puede unificar todavía</p>
              <p>Hay publicaciones de más de un producto en la misma conexión de marketplace:</p>
              <ul className="list-disc list-inside space-y-1">
                {connectionConflicts.map((c) => (
                  <li key={c.connectionId}>
                    <strong>{c.connectionName}</strong>: {c.products.map((p) => p.name).join(' y ')}
                  </li>
                ))}
              </ul>
              <p>Desvincula una de esas publicaciones (pestaña "Mercado Libre" del producto) antes de unificar este grupo.</p>
            </div>
          ) : step === 'fields' ? (
            <div className="space-y-3">
              <div className="overflow-x-auto border border-gray-200 rounded-xl">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-gray-500 w-32">Campo</th>
                      {products.map((p) => (
                        <th key={p.id} className="text-left px-3 py-2 font-medium text-gray-500">
                          <span className="block font-mono text-gray-700">{p.sku}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {MERGE_FIELDS.map((f) => (
                      <tr key={f.key}>
                        <td className="px-3 py-2 font-medium text-gray-600 align-top whitespace-nowrap">{f.label}</td>
                        {products.map((p) => (
                          <td key={p.id} className="px-2 py-2 align-top">
                            <button type="button" onClick={() => pick(f.key, p.id)} className={cellClass(fieldSources[f.key] === p.id)}>
                              {f.format(p)}
                            </button>
                          </td>
                        ))}
                      </tr>
                    ))}

                    {productsWithImages.length > 0 && (
                      <tr>
                        <td className="px-3 py-2 font-medium text-gray-600 align-top whitespace-nowrap">Imágenes</td>
                        {products.map((p) => (
                          <td key={p.id} className="px-2 py-2 align-top">
                            {p.images?.length > 0 ? (
                              <button type="button" onClick={() => setImagesFrom(p.id)}
                                className={`${cellClass(imagesFrom === p.id)} flex items-center gap-1.5`}>
                                <img src={imgUrl(p.images[0].url)} className="w-6 h-6 rounded object-cover shrink-0" alt="" />
                                {p.images.length} foto(s)
                              </button>
                            ) : (
                              <span className="text-gray-300">— Sin fotos —</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    )}
                    {productsWithImages.length > 0 && (
                      <tr>
                        <td className="px-3 py-2" />
                        <td colSpan={products.length} className="px-2 pb-2">
                          <button type="button" onClick={() => setImagesFrom(null)}
                            className={`px-2 py-1 rounded-lg border text-xs ${imagesFrom === null ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                            Ninguna (sin imágenes)
                          </button>
                        </td>
                      </tr>
                    )}

                    {productsWithDropship.length > 0 && (
                      <>
                        <tr>
                          <td className="px-3 py-2 font-medium text-gray-600 align-top whitespace-nowrap">Proveedor dropship</td>
                          {products.map((p) => (
                            <td key={p.id} className="px-2 py-2 align-top">
                              {p.dropshipProduct ? (
                                <button type="button" onClick={() => setDropshipFrom(p.id)} className={cellClass(dropshipFrom === p.id)}>
                                  {p.dropshipProduct.dropshipSupplier?.supplier?.name || 'Proveedor dropship'}
                                </button>
                              ) : (
                                <span className="text-gray-300">— Sin proveedor —</span>
                              )}
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <td className="px-3 py-2" />
                          <td colSpan={products.length} className="px-2 pb-2">
                            <button type="button" onClick={() => setDropshipFrom(null)}
                              className={`px-2 py-1 rounded-lg border text-xs ${dropshipFrom === null ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                              Ninguno (no es dropship)
                            </button>
                          </td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-400">
                El producto sobreviviente es el que elijas como origen del <strong>SKU</strong> (marcado en azul en esa fila) — los demás se eliminarán.
              </p>
            </div>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-800 space-y-1">
                <p className="font-semibold">Esta acción no se puede deshacer.</p>
                <p>
                  Sobrevive <strong className="font-mono">{survivor?.sku}</strong> — {survivor?.name}.
                  {' '}Se eliminarán {losers.length} producto(s): {losers.map((p) => p.sku).join(', ')}.
                </p>
              </div>
              <div className="border border-gray-200 rounded-xl p-4">
                <p className="font-medium text-gray-700 mb-2">Se reasignarán al SKU sobreviviente:</p>
                <ul className="space-y-1 text-gray-600">
                  {COUNT_LABELS.filter((c) => totals[c.key] > 0).map((c) => (
                    <li key={c.key}>• {totals[c.key]} {c.label}</li>
                  ))}
                  {COUNT_LABELS.every((c) => !totals[c.key]) && (
                    <li className="text-gray-400">Sin registros asociados que reasignar.</li>
                  )}
                </ul>
              </div>
            </div>
          )}

          {error && (
            <p className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
            Cancelar
          </button>
          {!blocked && step === 'fields' && (
            <button onClick={() => setStep('confirm')} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold">
              Continuar
            </button>
          )}
          {!blocked && step === 'confirm' && (
            <>
              <button onClick={() => setStep('fields')} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                Volver
              </button>
              <button
                onClick={() => onConfirm({
                  productIds: products.map((p) => p.id),
                  survivorId,
                  fieldSources,
                  imagesFromProductId: imagesFrom,
                  dropshipFromProductId: dropshipFrom,
                })}
                disabled={submitting}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold"
              >
                {submitting ? 'Unificando...' : 'Confirmar fusión'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

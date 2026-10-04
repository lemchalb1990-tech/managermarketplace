'use client';

import { useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { confirmDialog } from '../ConfirmDialog';

// Publicación del producto en una tienda de Walmart. Walmart todavía no permite publicar
// productos nuevos desde el panel (exige un "Item Spec" por categoría): se trabaja con las
// publicaciones existentes — vincular por SKU de Walmart, ver su estado, precio propio del
// canal y sincronizar stock/precio.

const STATUS: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: 'Activa', cls: 'bg-green-100 text-green-700' },
  PAUSED: { label: 'Pausada', cls: 'bg-amber-100 text-amber-700' },
  DRAFT: { label: 'Borrador', cls: 'bg-gray-100 text-gray-600' },
  ERROR: { label: 'Con error', cls: 'bg-red-100 text-red-700' },
  CLOSED: { label: 'Cerrada', cls: 'bg-gray-200 text-gray-600' },
};

const fmt = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;

export default function WalmartListingCard({ product, connection, onRefresh }: {
  product: any; connection: any; onRefresh: () => void | Promise<void>;
}) {
  const listing = (product.listings || []).find((l: any) => l.connectionId === connection.id);
  const channelPrice = (product.channelPrices || []).find((cp: any) => cp.connectionId === connection.id);
  const [priceInput, setPriceInput] = useState(channelPrice ? String(Number(channelPrice.price)) : '');
  const [skuInput, setSkuInput] = useState('');
  const [busy, setBusy] = useState<'' | 'sync' | 'price' | 'link' | 'unlink'>('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(kind: typeof busy, fn: () => Promise<unknown>, okText: string) {
    setBusy(kind);
    setMessage(null);
    try {
      await fn();
      await onRefresh();
      setMessage({ ok: true, text: okText });
    } catch (err: any) {
      setMessage({ ok: false, text: err.message || 'No se pudo completar la acción.' });
    } finally {
      setBusy('');
    }
  }

  const token = () => getToken()!;
  const effectivePrice = channelPrice ? Number(channelPrice.price) : Number(product.price);
  const st = listing ? (STATUS[listing.status] || { label: listing.status, cls: 'bg-gray-100 text-gray-600' }) : null;

  return (
    <div className="border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full bg-[#0071CE] shrink-0" />
        <p className="font-medium text-gray-900 text-sm mr-auto">{connection.name}</p>
        {st ? (
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>{st.label}</span>
        ) : (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">Sin publicar</span>
        )}
      </div>

      {listing ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
            <div className="flex justify-between gap-2"><span className="text-gray-500">SKU Walmart</span><span className="font-mono text-gray-800 break-all">{listing.externalId || '—'}</span></div>
            <div className="flex justify-between gap-2"><span className="text-gray-500">Stock a sincronizar</span><span className="text-gray-800 font-medium">{product.stock} un.</span></div>
            <div className="flex justify-between gap-2 sm:col-span-2"><span className="text-gray-500 shrink-0">Título publicado</span><span className="text-gray-800 text-right">{listing.title || product.name}</span></div>
            <div className="flex justify-between gap-2"><span className="text-gray-500">Precio en Walmart</span><span className="text-gray-800 font-medium">{fmt(effectivePrice)}{!channelPrice && <span className="text-gray-400 font-normal"> (precio de venta)</span>}</span></div>
            <div className="flex justify-between gap-2"><span className="text-gray-500">Última sincronización</span>
              <span className="text-gray-800">{listing.syncedAt ? new Date(listing.syncedAt).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</span></div>
          </div>
          {listing.externalUrl && (
            <a href={listing.externalUrl} target="_blank" rel="noreferrer" className="inline-block text-xs text-blue-600 hover:underline">Ver publicación en Walmart →</a>
          )}
          {listing.errorMsg && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Último error de sincronización: {listing.errorMsg}</p>
          )}

          <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-gray-100">
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">Precio de Venta Walmart</label>
              <input type="number" min="0" step="1" value={priceInput} onChange={(e) => setPriceInput(e.target.value)}
                placeholder={`Igual al precio de venta (${fmt(Number(product.price))})`}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <button disabled={!!busy}
              onClick={() => run('price', () => (priceInput.trim() === ''
                ? api.catalog.removeChannelPrice(product.id, connection.id, token())
                : api.catalog.setChannelPrice(product.id, connection.id, parseFloat(priceInput), token())), 'Precio de Walmart guardado.')}
              className="px-3 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {busy === 'price' ? 'Guardando...' : 'Guardar precio'}
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button disabled={!!busy}
              onClick={() => run('sync', () => api.connections.sync(connection.id, product.id, token()), 'Stock y precio enviados a Walmart.')}
              className="flex-1 sm:flex-none px-3 py-2 bg-[#0071CE] hover:bg-[#005fa8] text-white rounded-lg text-xs font-semibold disabled:opacity-50">
              {busy === 'sync' ? 'Sincronizando...' : 'Sincronizar stock y precio ahora'}
            </button>
            <button disabled={!!busy}
              onClick={async () => {
                if (!(await confirmDialog(`¿Desvincular este producto de la publicación ${listing.externalId} en "${connection.name}"? No se borra nada en Walmart; solo deja de sincronizarse.`, { danger: true }))) return;
                await run('unlink', () => api.catalog.deleteListing(product.id, connection.id, token()), 'Producto desvinculado de Walmart.');
              }}
              className="px-3 py-2 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg text-xs font-medium disabled:opacity-50">
              {busy === 'unlink' ? 'Desvinculando...' : 'Desvincular'}
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">
            Este producto no está vinculado a una publicación de esta tienda. Publicar productos nuevos en Walmart todavía
            no está disponible desde el panel: vincúlalo con el SKU de una publicación existente, o tráelas todas con
            &quot;Importar catálogo&quot; en Walmart.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">SKU de la publicación en Walmart</label>
              <input value={skuInput} onChange={(e) => setSkuInput(e.target.value)} placeholder="Ej: SKU-000123"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono" />
            </div>
            <button disabled={!!busy || !skuInput.trim()}
              onClick={() => run('link', () => api.connections.link(connection.id, product.id, { externalId: skuInput.trim() }, token()), 'Producto vinculado a la publicación de Walmart.')}
              className="px-3 py-2 bg-[#0071CE] hover:bg-[#005fa8] text-white rounded-lg text-xs font-semibold disabled:opacity-50">
              {busy === 'link' ? 'Vinculando...' : 'Vincular'}
            </button>
          </div>
        </div>
      )}

      {message && (
        <p className={`text-xs ${message.ok ? 'text-green-700' : 'text-red-600'}`}>{message.text}</p>
      )}
    </div>
  );
}

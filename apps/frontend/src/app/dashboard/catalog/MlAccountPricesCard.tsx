'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';

// Precio y título del producto en cada cuenta de Mercado Libre. Un precio base de ML y un título
// base (el nombre del producto) que usan todas las cuentas, salvo las que tengan precio o título
// propio (el título propio solo en cuentas con publicación). Stock, descripción y fotos son siempre los
// mismos para todas las cuentas (un solo producto). Al guardar, el precio vigente se envía de
// inmediato a las publicaciones activas/pausadas de cada cuenta.

const fmt = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;

export default function MlAccountPricesCard({ product, connections, onSaved }: {
  product: any; connections: any[]; onSaved: () => void | Promise<void>;
}) {
  const own = (connId: string) => (product.channelPrices || []).find((cp: any) => cp.connectionId === connId);
  const [base, setBase] = useState<string>(product.mlPrice != null ? String(Number(product.mlPrice)) : '');
  type Row = { mode: 'base' | 'own'; price: string; titleMode: 'base' | 'own'; title: string };
  const listingOf = (connId: string) => (product.listings || []).find((l: any) => l.connectionId === connId);
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(connections.map((c) => {
      const cp = own(c.id);
      const t = listingOf(c.id)?.title;
      return [c.id, { mode: cp ? 'own' : 'base', price: cp ? String(Number(cp.price)) : '', titleMode: t ? 'own' : 'base', title: t || '' }];
    })));
  // Datos en vivo de ML: las publicaciones con ventas no pueden cambiar título (queda el de ML).
  const [info, setInfo] = useState<Record<string, { mlTitle: string; mlPrice: number; sold: number }>>({});
  useEffect(() => {
    let alive = true;
    api.marketplace.accountInfo(product.id, getToken()!).then((list) => {
      if (!alive) return;
      setInfo(Object.fromEntries(list.map((i) => [i.connectionId, i])));
      setRows((r) => {
        const next = { ...r };
        for (const i of list) {
          if (i.sold > 0 && i.mlTitle && next[i.connectionId]) {
            const isBase = i.mlTitle.trim() === String(product.name).trim();
            next[i.connectionId] = { ...next[i.connectionId], titleMode: isBase ? 'base' : 'own', title: isBase ? '' : i.mlTitle };
          }
        }
        return next;
      });
    }).catch(() => {});
    return () => { alive = false; };
  }, [product.id, product.name]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const baseValue = Number(base) > 0 ? Number(base) : Number(product.price);
  const ownCount = Object.values(rows).filter((r) => r.mode === 'own').length;
  const setRow = (id: string, patch: Partial<Row>) =>
    setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));

  async function save(equalizeAll = false) {
    setSaving(true);
    setMessage(null);
    try {
      const accounts = connections.map((c) => {
        const r = rows[c.id];
        return {
          connectionId: c.id,
          price: !equalizeAll && r?.mode === 'own' && Number(r.price) > 0 ? Number(r.price) : null,
          // "Igualar" solo afecta precios; el título se envía solo en cuentas con publicación.
          ...(listingOf(c.id) && !(info[c.id]?.sold > 0) ? { title: r?.titleMode === 'own' && r.title.trim() ? r.title.trim() : null } : {}),
        };
      });
      const res = await api.marketplace.setAccountPrices(product.id, { basePrice: Number(base) > 0 ? Number(base) : null, accounts }, getToken()!);
      if (equalizeAll) setRows((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ...v, mode: 'base' as const, price: '' }])));
      const failed = [...res.pushed, ...(res.titles || [])].filter((p) => !p.ok);
      setMessage(failed.length
        ? { ok: false, text: `Precios guardados. No se pudo actualizar en: ${failed.map((f) => `${f.connection} (${f.error})`).join('; ')}` }
        : { ok: true, text: `Precios y títulos guardados${res.pushed.length ? ` y enviados a ${res.pushed.length} publicación(es) de Mercado Libre` : ''}.` });
      await onSaved();
    } catch (err: any) {
      setMessage({ ok: false, text: err.message || 'No se pudieron guardar los precios.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-yellow-200 bg-yellow-50/40 rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-gray-800 mr-auto">Precios y títulos por cuenta</p>
        {ownCount > 0 && (
          <button onClick={() => save(true)} disabled={saving}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50">
            Igualar todas al precio base
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500">
        Stock, descripción y fotos son los mismos en todas las cuentas. El precio y el título pueden ser los mismos (base) o propios de cada cuenta.
        El título base es el nombre del producto; Mercado Libre no deja cambiar el título de una publicación que ya tiene ventas.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-full sm:w-56">
          <label className="block text-xs font-medium text-gray-600 mb-1">Precio base Mercado Libre</label>
          <input type="number" min="0" step="1" value={base} onChange={(e) => setBase(e.target.value)}
            placeholder={`Igual al precio de venta (${fmt(Number(product.price))})`}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" />
        </div>
      </div>

      <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg bg-white">
        {connections.map((c) => {
          const listing = (product.listings || []).find((l: any) => l.connectionId === c.id);
          const r = rows[c.id] || { mode: 'base', price: '', titleMode: 'base', title: '' };
          return (
            <div key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
              <div className="min-w-0 flex-1 basis-40">
                <p className="text-sm font-medium text-gray-800 truncate">{c.name}</p>
                <p className="text-[11px] text-gray-400 truncate">
                  {listing?.externalId ? `${listing.externalId} · ${listing.status === 'ACTIVE' ? 'Activa' : listing.status === 'PAUSED' ? 'Pausada' : listing.status}` : 'Sin publicar'}
                  {info[c.id]?.sold > 0 && ` · ${info[c.id].sold} vendido(s)`}
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="radio" name={`mode-${c.id}`} checked={r.mode === 'base'} onChange={() => setRow(c.id, { mode: 'base' })} />
                  Precio base <span className="text-gray-400">{fmt(baseValue)}</span>
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="radio" name={`mode-${c.id}`} checked={r.mode === 'own'} onChange={() => setRow(c.id, { mode: 'own' })} />
                  Propio
                </label>
              </div>
              {r.mode === 'own' && (
                <input type="number" min="0" step="1" value={r.price} onChange={(e) => setRow(c.id, { price: e.target.value })}
                  placeholder="Precio en esta cuenta"
                  className="w-full sm:w-36 px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
              )}
              {listing && info[c.id]?.sold > 0 && (
                <div className="w-full text-xs text-gray-600">
                  <span className="text-gray-500">Título: </span>
                  <span className="font-medium">{info[c.id].mlTitle}</span>
                  <span className="ml-1 px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">con ventas, Mercado Libre no permite cambiarlo</span>
                </div>
              )}
              {listing && !(info[c.id]?.sold > 0) && (
                <div className="w-full flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                  <span className="text-gray-500 w-10">Título</span>
                  <label className="flex items-center gap-1 cursor-pointer min-w-0">
                    <input type="radio" name={`tmode-${c.id}`} checked={r.titleMode === 'base'} onChange={() => setRow(c.id, { titleMode: 'base' })} />
                    Título base <span className="text-gray-400 truncate max-w-[16rem]" title={product.name}>{product.name}</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="radio" name={`tmode-${c.id}`} checked={r.titleMode === 'own'}
                      onChange={() => setRow(c.id, { titleMode: 'own', title: r.title || product.name })} />
                    Propio
                  </label>
                  {r.titleMode === 'own' && (
                    <input type="text" maxLength={60} value={r.title} onChange={(e) => setRow(c.id, { title: e.target.value })}
                      placeholder="Título en esta cuenta"
                      className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => save(false)} disabled={saving}
          className="px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-lg text-xs font-semibold disabled:opacity-50">
          {saving ? 'Guardando...' : 'Guardar precios y títulos'}
        </button>
        {message && <p className={`text-xs ${message.ok ? 'text-green-700' : 'text-red-600'}`}>{message.text}</p>}
      </div>
    </div>
  );
}

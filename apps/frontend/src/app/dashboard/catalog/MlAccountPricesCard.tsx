'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';

// Precio y título del producto en cada publicación de Mercado Libre. Un precio base de ML y un
// título base (el nombre del producto) que usan todas las cuentas, salvo las que tengan precio o
// título propio. Una cuenta puede tener varias publicaciones del mismo producto: la principal usa
// el precio de la cuenta y las adicionales pueden tener su propio precio. Stock, descripción y
// fotos son siempre los mismos para todas (un solo producto). Al guardar, el precio vigente se
// envía de inmediato a las publicaciones activas/pausadas.

const fmt = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;

type Row = { mode: 'base' | 'own'; price: string; titleMode: 'base' | 'own'; title: string };

export default function MlAccountPricesCard({ product, connections, onSaved }: {
  product: any; connections: any[]; onSaved: () => void | Promise<void>;
}) {
  const own = (connId: string) => (product.channelPrices || []).find((cp: any) => cp.connectionId === connId);
  const [base, setBase] = useState<string>(product.mlPrice != null ? String(Number(product.mlPrice)) : '');
  const connIds = new Set(connections.map((c) => c.id));
  const listingOf = (connId: string) => (product.listings || []).find((l: any) => l.connectionId === connId && (l.slot ?? 0) === 0);
  const extrasOf = (connId: string) => (product.listings || []).filter((l: any) => l.connectionId === connId && (l.slot ?? 0) > 0);
  const extras: any[] = (product.listings || []).filter((l: any) => connIds.has(l.connectionId) && (l.slot ?? 0) > 0);

  // Filas de cuenta (publicación principal) por connectionId; publicaciones adicionales por listingId.
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(connections.map((c) => {
      const cp = own(c.id);
      const t = listingOf(c.id)?.title;
      return [c.id, { mode: cp ? 'own' : 'base', price: cp ? String(Number(cp.price)) : '', titleMode: t ? 'own' : 'base', title: t || '' }];
    })));
  const [extraRows, setExtraRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(extras.map((l) => [l.id, {
      mode: l.price != null ? 'own' : 'base', price: l.price != null ? String(Number(l.price)) : '',
      titleMode: l.title ? 'own' : 'base', title: l.title || '',
    }])));

  // Datos en vivo de ML por publicación: las con ventas no pueden cambiar título (queda el de ML).
  const [info, setInfo] = useState<Record<string, { mlTitle: string; mlPrice: number; sold: number }>>({});
  useEffect(() => {
    let alive = true;
    api.marketplace.accountInfo(product.id, getToken()!).then((list) => {
      if (!alive) return;
      setInfo(Object.fromEntries(list.map((i) => [i.listingId, i])));
      const titled = (i: { mlTitle: string }): Partial<Row> => {
        const isBase = i.mlTitle.trim() === String(product.name).trim();
        return { titleMode: isBase ? 'base' : 'own', title: isBase ? '' : i.mlTitle };
      };
      const sold = list.filter((i) => i.sold > 0 && i.mlTitle);
      setRows((r) => {
        const next = { ...r };
        for (const i of sold) if (i.slot === 0 && next[i.connectionId]) next[i.connectionId] = { ...next[i.connectionId], ...titled(i) };
        return next;
      });
      setExtraRows((r) => {
        const next = { ...r };
        for (const i of sold) if (i.slot > 0 && next[i.listingId]) next[i.listingId] = { ...next[i.listingId], ...titled(i) };
        return next;
      });
    }).catch(() => {});
    return () => { alive = false; };
  }, [product.id, product.name]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const baseValue = Number(base) > 0 ? Number(base) : Number(product.price);
  const accountValue = (connId: string) => {
    const r = rows[connId];
    return r?.mode === 'own' && Number(r.price) > 0 ? Number(r.price) : baseValue;
  };
  const ownCount = Object.values(rows).filter((r) => r.mode === 'own').length + Object.values(extraRows).filter((r) => r.mode === 'own').length;
  const sold = (listing: any) => !!listing && info[listing.id]?.sold > 0;
  const titleOf = (r: Row | undefined, listing: any) =>
    listing && !sold(listing) ? { title: r?.titleMode === 'own' && r.title.trim() ? r.title.trim() : null } : {};

  async function save(equalizeAll = false) {
    setSaving(true);
    setMessage(null);
    try {
      const accounts = connections.map((c) => {
        const r = rows[c.id];
        return {
          connectionId: c.id,
          price: !equalizeAll && r?.mode === 'own' && Number(r.price) > 0 ? Number(r.price) : null,
          // "Igualar" solo afecta precios; el título se envía solo en publicaciones sin ventas.
          ...titleOf(r, listingOf(c.id)),
        };
      });
      const publications = extras.map((l) => {
        const r = extraRows[l.id];
        return { listingId: l.id, price: !equalizeAll && r?.mode === 'own' && Number(r.price) > 0 ? Number(r.price) : null, ...titleOf(r, l) };
      });
      const res = await api.marketplace.setAccountPrices(product.id, { basePrice: Number(base) > 0 ? Number(base) : null, accounts, publications }, getToken()!);
      if (equalizeAll) {
        const reset = (r: Record<string, Row>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ...v, mode: 'base' as const, price: '' }]));
        setRows(reset);
        setExtraRows(reset);
      }
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

  const statusText = (listing: any) => listing?.externalId
    ? `${listing.externalId} · ${listing.status === 'ACTIVE' ? 'Activa' : listing.status === 'PAUSED' ? 'Pausada' : listing.status}${sold(listing) ? ` · ${info[listing.id].sold} vendido(s)` : ''}`
    : 'Sin publicar';

  // Precio + título de una publicación. `baseLabel`/`baseAmount`: lo que usa si no tiene precio propio.
  function renderEditor(key: string, r: Row, set: (patch: Partial<Row>) => void, listing: any, baseLabel: string, baseAmount: number) {
    return (
      <>
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="radio" name={`mode-${key}`} checked={r.mode === 'base'} onChange={() => set({ mode: 'base' })} />
            {baseLabel} <span className="text-gray-400">{fmt(baseAmount)}</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="radio" name={`mode-${key}`} checked={r.mode === 'own'} onChange={() => set({ mode: 'own' })} />
            Propio
          </label>
        </div>
        {r.mode === 'own' && (
          <input type="number" min="0" step="1" value={r.price} onChange={(e) => set({ price: e.target.value })}
            placeholder="Precio propio"
            className="w-full sm:w-36 px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
        )}
        {listing && sold(listing) && (
          <div className="w-full text-xs text-gray-600">
            <span className="text-gray-500">Título: </span>
            <span className="font-medium">{info[listing.id].mlTitle}</span>
            <span className="ml-1 px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">con ventas, Mercado Libre no permite cambiarlo</span>
          </div>
        )}
        {listing && !sold(listing) && (
          <div className="w-full flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
            <span className="text-gray-500 w-10">Título</span>
            <label className="flex items-center gap-1 cursor-pointer min-w-0">
              <input type="radio" name={`tmode-${key}`} checked={r.titleMode === 'base'} onChange={() => set({ titleMode: 'base' })} />
              Título base <span className="text-gray-400 truncate max-w-[16rem]" title={product.name}>{product.name}</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="radio" name={`tmode-${key}`} checked={r.titleMode === 'own'}
                onChange={() => set({ titleMode: 'own', title: r.title || product.name })} />
              Propio
            </label>
            {r.titleMode === 'own' && (
              <input type="text" maxLength={60} value={r.title} onChange={(e) => set({ title: e.target.value })}
                placeholder="Título de esta publicación"
                className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
            )}
          </div>
        )}
      </>
    );
  }

  const emptyRow: Row = { mode: 'base', price: '', titleMode: 'base', title: '' };

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
        Stock, descripción y fotos son los mismos en todas las publicaciones. El precio y el título pueden ser los mismos (base) o propios de cada cuenta o publicación.
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
          const listing = listingOf(c.id);
          const r = rows[c.id] || emptyRow;
          const more = extrasOf(c.id);
          return (
            <div key={c.id}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
                <div className="min-w-0 flex-1 basis-40">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {c.name}
                    {more.length > 0 && <span className="ml-1 text-[11px] font-normal text-gray-400">({more.length + 1} publicaciones)</span>}
                  </p>
                  <p className="text-[11px] text-gray-400 truncate">{statusText(listing)}</p>
                </div>
                {renderEditor(c.id, r, (patch) => setRows((x) => ({ ...x, [c.id]: { ...(x[c.id] || emptyRow), ...patch } })), listing, 'Precio base', baseValue)}
              </div>
              {more.map((l: any) => (
                <div key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 pl-6 pr-3 py-2 bg-gray-50/60 border-t border-dashed border-gray-100">
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="text-xs font-medium text-gray-700 truncate">Publicación adicional</p>
                    <p className="text-[11px] text-gray-400 truncate">{statusText(l)}</p>
                  </div>
                  {renderEditor(l.id, extraRows[l.id] || emptyRow,
                    (patch) => setExtraRows((x) => ({ ...x, [l.id]: { ...(x[l.id] || emptyRow), ...patch } })), l, 'Precio de la cuenta', accountValue(c.id))}
                </div>
              ))}
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

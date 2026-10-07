'use client';

import { ReactNode, useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { confirmDialog } from '../ConfirmDialog';

// Publicaciones del producto en un marketplace (pestaña "Conexiones"): una fila por publicación
// con estado, ID, link, error, precio (base o propio), título y sus acciones. Stock, descripción
// y fotos son los mismos para todas (un solo producto).
// - Mercado Libre: precio base ML editable + precio propio por cuenta o por publicación adicional,
//   y título propio (se envía a ML; con ventas, ML no deja cambiarlo y se muestra el real).
// - Otros canales: precio base = precio de venta del catálogo; precio propio por cuenta
//   (ChannelPrice). El título/ficha propia de cada canal se edita en su "Ficha de publicación".

const fmt = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;

const STATUS_LABEL: Record<string, string> = { ACTIVE: 'Activa', PAUSED: 'Pausada', DRAFT: 'Borrador', ERROR: 'Error', CLOSED: 'Cerrada' };
const STATUS_COLOR: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700', PAUSED: 'bg-yellow-100 text-yellow-700', DRAFT: 'bg-gray-100 text-gray-600',
  ERROR: 'bg-red-100 text-red-600', CLOSED: 'bg-gray-200 text-gray-500',
};

type Row = { mode: 'base' | 'own'; price: string; titleMode: 'base' | 'own'; title: string };

export default function ChannelPublicationsCard({
  title, isMl, product, connections, onSaved, headerActions, renderActions, renderDetail, detailLabel,
}: {
  title: string;
  isMl: boolean;
  product: any;
  connections: any[];
  onSaved: () => void | Promise<void>;
  headerActions?: ReactNode;
  // Botones de la publicación principal de la cuenta.
  renderActions?: (conn: any, listing: any | undefined) => ReactNode;
  // Ficha propia del canal (familia, atributos, publicar…), desplegable bajo la fila.
  renderDetail?: (conn: any) => ReactNode;
  detailLabel?: string;
}) {
  const own = (connId: string) => (product.channelPrices || []).find((cp: any) => cp.connectionId === connId);
  const [base, setBase] = useState<string>(product.mlPrice != null ? String(Number(product.mlPrice)) : '');
  const connIds = new Set(connections.map((c) => c.id));
  const listingOf = (connId: string) => (product.listings || []).find((l: any) => l.connectionId === connId && (l.slot ?? 0) === 0);
  const extrasOf = (connId: string) => (product.listings || []).filter((l: any) => l.connectionId === connId && (l.slot ?? 0) > 0);
  const extras: any[] = (product.listings || []).filter((l: any) => connIds.has(l.connectionId) && (l.slot ?? 0) > 0);

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
  const [openDetail, setOpenDetail] = useState<Record<string, boolean>>({});

  // ML en vivo: las publicaciones con ventas no pueden cambiar título (queda el de ML).
  const [info, setInfo] = useState<Record<string, { mlTitle: string; mlPrice: number; sold: number }>>({});
  useEffect(() => {
    if (!isMl || !(product.listings || []).some((l: any) => connIds.has(l.connectionId) && l.externalId)) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id, product.name, isMl]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const baseValue = isMl && Number(base) > 0 ? Number(base) : Number(isMl ? (product.mlPrice ?? product.price) : product.price);
  const accountValue = (connId: string) => {
    const r = rows[connId];
    return r?.mode === 'own' && Number(r.price) > 0 ? Number(r.price) : baseValue;
  };
  const ownCount = Object.values(rows).filter((r) => r.mode === 'own').length + Object.values(extraRows).filter((r) => r.mode === 'own').length;
  const sold = (listing: any) => !!listing && info[listing.id]?.sold > 0;
  const titleOf = (r: Row | undefined, listing: any) =>
    listing && !sold(listing) ? { title: r?.titleMode === 'own' && r.title.trim() ? r.title.trim() : null } : {};
  const ownPrice = (r: Row | undefined, equalize: boolean) => (!equalize && r?.mode === 'own' && Number(r.price) > 0 ? Number(r.price) : null);

  async function save(equalizeAll = false) {
    setSaving(true);
    setMessage(null);
    const token = getToken()!;
    try {
      if (isMl) {
        const accounts = connections.map((c) => ({ connectionId: c.id, price: ownPrice(rows[c.id], equalizeAll), ...titleOf(rows[c.id], listingOf(c.id)) }));
        const publications = extras.map((l) => ({ listingId: l.id, price: ownPrice(extraRows[l.id], equalizeAll), ...titleOf(extraRows[l.id], l) }));
        const res = await api.marketplace.setAccountPrices(product.id, { basePrice: Number(base) > 0 ? Number(base) : null, accounts, publications }, token);
        const failed = [...res.pushed, ...(res.titles || [])].filter((p) => !p.ok);
        setMessage(failed.length
          ? { ok: false, text: `Guardado. No se pudo actualizar en: ${failed.map((f) => `${f.connection} (${f.error})`).join('; ')}` }
          : { ok: true, text: `Guardado${res.pushed.length ? ` y enviado a ${res.pushed.length} publicación(es)` : ''}.` });
      } else {
        // Precio propio por cuenta (ChannelPrice) y se envía a las publicaciones de ese canal.
        const failed: string[] = [];
        for (const c of connections) {
          const price = ownPrice(rows[c.id], equalizeAll);
          if (price == null) await api.catalog.removeChannelPrice(product.id, c.id, token);
          else await api.catalog.setChannelPrice(product.id, c.id, price, token);
          if (listingOf(c.id)?.externalId) {
            await api.connections.sync(c.id, product.id, token).catch((e: any) => failed.push(`${c.name} (${e.message})`));
          }
        }
        // Publicaciones adicionales: precio propio de la publicación y se envía a esa publicación.
        for (const l of extras) {
          await api.connections.setListingPrice(l.id, ownPrice(extraRows[l.id], equalizeAll), token);
          if (l.externalId) {
            const name = connections.find((c) => c.id === l.connectionId)?.name || '';
            await api.connections.sync(l.connectionId, product.id, token, l.id).catch((e: any) => failed.push(`${name} ${l.externalId} (${e.message})`));
          }
        }
        setMessage(failed.length ? { ok: false, text: `Guardado. No se pudo actualizar en: ${failed.join('; ')}` } : { ok: true, text: 'Guardado.' });
      }
      if (equalizeAll) {
        const reset = (r: Record<string, Row>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ...v, mode: 'base' as const, price: '' }]));
        setRows(reset);
        setExtraRows(reset);
      }
      await onSaved();
    } catch (err: any) {
      setMessage({ ok: false, text: err.message || 'No se pudo guardar.' });
    } finally {
      setSaving(false);
    }
  }

  // Estado, ID (copiar), link y error de una publicación.
  function renderIdentity(name: string, listing: any, small = false) {
    return (
      <div className="min-w-0 flex-1 basis-56 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className={`${small ? 'text-xs text-gray-700' : 'text-sm text-gray-800'} font-medium truncate`}>{name}</p>
          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${listing ? STATUS_COLOR[listing.status] || 'bg-gray-100 text-gray-500' : 'bg-gray-100 text-gray-500'}`}>
            {listing ? STATUS_LABEL[listing.status] || listing.status : 'Sin publicar'}
          </span>
          {sold(listing) && <span className="text-[10px] text-gray-500">{info[listing.id].sold} vendido(s)</span>}
        </div>
        {listing?.externalId && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
            <code className="font-mono bg-gray-50 border border-gray-200 rounded px-1 py-px text-gray-600">{listing.externalId}</code>
            <button type="button" onClick={() => navigator.clipboard.writeText(listing.externalId)} className="text-blue-500 hover:text-blue-700">Copiar</button>
            {/^https?:\/\//.test(listing.externalUrl || '') && (
              <a href={listing.externalUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Ver publicación ↗</a>
            )}
          </div>
        )}
        {listing?.errorMsg && <p className="text-[11px] text-red-600 break-words">❌ {listing.errorMsg}</p>}
      </div>
    );
  }

  function renderPrice(key: string, r: Row, set: (patch: Partial<Row>) => void, baseLabel: string, baseAmount: number) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="radio" name={`mode-${key}`} checked={r.mode === 'base'} onChange={() => set({ mode: 'base' })} />
          {baseLabel} <span className="text-gray-400">{fmt(baseAmount)}</span>
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="radio" name={`mode-${key}`} checked={r.mode === 'own'} onChange={() => set({ mode: 'own' })} />
          Propio
        </label>
        {r.mode === 'own' && (
          <input type="number" min="0" step="1" value={r.price} onChange={(e) => set({ price: e.target.value })}
            placeholder="Precio propio"
            className="w-32 px-2 py-1 border border-gray-300 rounded-lg text-sm" />
        )}
      </div>
    );
  }

  function renderTitle(key: string, r: Row, set: (patch: Partial<Row>) => void, listing: any) {
    if (!listing) return null;
    if (!isMl) {
      return listing.title ? <p className="w-full text-xs text-gray-600"><span className="text-gray-500">Título: </span>{listing.title}</p> : null;
    }
    if (sold(listing)) {
      return (
        <div className="w-full text-xs text-gray-600">
          <span className="text-gray-500">Título: </span>
          <span className="font-medium">{info[listing.id].mlTitle}</span>
          <span className="ml-1 px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">con ventas, Mercado Libre no permite cambiarlo</span>
        </div>
      );
    }
    return (
      <div className="w-full flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        <span className="text-gray-500">Título</span>
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
    );
  }

  const emptyRow: Row = { mode: 'base', price: '', titleMode: 'base', title: '' };
  const listingCount = (product.listings || []).filter((l: any) => connIds.has(l.connectionId)).length;

  return (
    <div className="border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-gray-800 mr-auto">
          {title} <span className="font-normal text-gray-400 text-xs">· {listingCount} publicación(es)</span>
        </p>
        {headerActions}
        {ownCount > 0 && (
          <button onClick={() => save(true)} disabled={saving}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50">
            Igualar al precio base
          </button>
        )}
      </div>

      {isMl ? (
        <div className="w-full sm:w-56">
          <label className="block text-xs font-medium text-gray-600 mb-1">Precio base Mercado Libre</label>
          <input type="number" min="0" step="1" value={base} onChange={(e) => setBase(e.target.value)}
            placeholder={`Igual al precio de venta (${fmt(Number(product.price))})`}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" />
        </div>
      ) : (
        <p className="text-xs text-gray-500">Precio base: precio de venta del catálogo <b>{fmt(Number(product.price))}</b> (se cambia en Información).</p>
      )}

      <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg bg-white">
        {connections.map((c) => {
          const listing = listingOf(c.id);
          const r = rows[c.id] || emptyRow;
          const set = (patch: Partial<Row>) => setRows((x) => ({ ...x, [c.id]: { ...(x[c.id] || emptyRow), ...patch } }));
          const more = extrasOf(c.id);
          return (
            <div key={c.id}>
              <div className="px-3 py-2.5 space-y-2">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                  {renderIdentity(c.name, listing)}
                  {renderPrice(c.id, r, set, 'Precio base', baseValue)}
                </div>
                {renderTitle(c.id, r, set, listing)}
                {(renderActions || renderDetail) && (
                  <div className="flex flex-wrap items-center gap-2">
                    {renderActions?.(c, listing)}
                    {renderDetail && (
                      <button type="button" onClick={() => setOpenDetail((o) => ({ ...o, [c.id]: !o[c.id] }))}
                        className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50">
                        {openDetail[c.id] ? '– Ocultar ficha' : `+ ${detailLabel || 'Ficha de publicación'}`}
                      </button>
                    )}
                  </div>
                )}
                {renderDetail && openDetail[c.id] && <div className="pt-1">{renderDetail(c)}</div>}
              </div>
              {more.map((l: any) => {
                const er = extraRows[l.id] || emptyRow;
                const setE = (patch: Partial<Row>) => setExtraRows((x) => ({ ...x, [l.id]: { ...(x[l.id] || emptyRow), ...patch } }));
                return (
                  <div key={l.id} className="pl-6 pr-3 py-2 bg-gray-50/60 border-t border-dashed border-gray-100 space-y-2">
                    <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                      {renderIdentity(`${c.name} · publicación adicional`, l, true)}
                      {renderPrice(l.id, er, setE, 'Precio de la cuenta', accountValue(c.id))}
                    </div>
                    {renderTitle(l.id, er, setE, l)}
                    <div className="flex flex-wrap items-center gap-2">
                      {isMl
                        ? <ExtraListingActions isMl productId={product.id} productStock={product.stock} conn={c} listing={l} onDone={onSaved} />
                        : <GenericChannelActions conn={c} listing={l} productId={product.id} productStock={product.stock} extra onDone={onSaved} />}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => save(false)} disabled={saving}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50">
          {saving ? 'Guardando...' : isMl ? 'Guardar precios y títulos' : 'Guardar precios'}
        </button>
        {message && <p className={`text-xs ${message.ok ? 'text-green-700' : 'text-red-600'}`}>{message.text}</p>}
      </div>
    </div>
  );
}

// Acciones de canales sin ficha propia (JumpSeller, Shopify, WooCommerce…): publicar, sincronizar,
// pausar/activar (si el canal lo permite) y eliminar el vínculo. `extra`: publicación adicional de
// la misma cuenta (las acciones van sobre esa publicación puntual; no se publica desde ahí).
const TOGGLE_CHANNELS = new Set(['JUMPSELLER', 'SHOPIFY', 'WOOCOMMERCE']);
// Canales donde se puede borrar la publicación en la tienda desde el sistema.
const REMOTE_DELETE_CHANNELS: Record<string, string> = { JUMPSELLER: 'JumpSeller' };
export function GenericChannelActions({ conn, listing, productId, productStock, extra = false, onDone }: {
  conn: any; listing: any | undefined; productId: string; productStock?: number; extra?: boolean; onDone: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  async function run(kind: string, fn: () => Promise<any>) {
    setBusy(kind);
    setErr('');
    try {
      await fn();
      await onDone();
    } catch (e: any) {
      setErr(e.message || 'Error');
    } finally {
      setBusy(null);
    }
  }
  const token = () => getToken()!;
  const listingId = extra ? listing?.id : undefined;
  const isActive = listing?.status === 'ACTIVE';
  const canToggle = TOGGLE_CHANNELS.has(conn.marketplace) && listing?.externalId && (isActive || listing?.status === 'PAUSED');
  return (
    <>
      {!listing?.externalId && !extra && (
        <button onClick={() => run('publish', () => api.connections.publish(conn.id, productId, token()))} disabled={!!busy}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50">
          {busy === 'publish' ? 'Publicando...' : 'Publicar'}
        </button>
      )}
      {listing?.externalId && (
        <button onClick={() => run('sync', () => api.connections.sync(conn.id, productId, token(), listingId))} disabled={!!busy}
          title="Envía el precio y stock del producto a la publicación"
          className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50 disabled:opacity-50">
          {busy === 'sync' ? 'Sincronizando...' : '↻ Sincronizar'}
        </button>
      )}
      {canToggle && (
        <button onClick={() => run('toggle', () => api.connections.toggle(conn.id, productId, token(), listingId))}
          disabled={!!busy || (!isActive && productStock === 0)}
          title={!isActive && productStock === 0 ? 'Sin stock no se puede activar' : isActive ? 'Pausar la publicación' : 'Activar la publicación'}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 ${
            isActive ? 'bg-red-50 border border-red-200 text-red-600 hover:bg-red-100' : 'bg-green-50 border border-green-200 text-green-700 hover:bg-green-100'
          }`}>
          {busy === 'toggle' ? (isActive ? 'Pausando...' : 'Activando...') : isActive ? '⏸ Pausar' : '▶ Activar'}
        </button>
      )}
      {listing?.externalId && REMOTE_DELETE_CHANNELS[conn.marketplace] && (
        <button disabled={!!busy}
          onClick={async () => {
            if (!(await confirmDialog(`¿Eliminar esta publicación de ${REMOTE_DELETE_CHANNELS[conn.marketplace]}? El producto se borra de tu tienda y deja de estar a la venta ahí. No se puede deshacer.`, { danger: true }))) return;
            await run('remote', () => api.connections.deleteRemote(conn.id, productId, token(), listing.id));
          }}
          title={`Eliminar la publicación de ${REMOTE_DELETE_CHANNELS[conn.marketplace]} (borra el producto en la tienda)`}
          className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50">
          {busy === 'remote' ? 'Eliminando...' : '🗑 Eliminar'}
        </button>
      )}
      {/* JumpSeller: el vínculo no se quita a mano (se elimina junto con la publicación). */}
      {listing && conn.marketplace !== 'JUMPSELLER' && (
        <button disabled={!!busy}
          onClick={async () => {
            if (!(await confirmDialog('¿Quitar el vínculo con esta publicación? La publicación sigue en la tienda tal como está; el sistema solo deja de sincronizarla.', { danger: true }))) return;
            await run('delete', () => api.catalog.deleteListing(productId, conn.id, token(), listing.id));
          }}
          title="Deja de sincronizar la publicación sin tocar la tienda"
          className="px-3 py-1.5 border border-red-200 bg-red-50 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100 disabled:opacity-50">
          {busy === 'delete' ? 'Quitando...' : '🔗 Quitar vínculo'}
        </button>
      )}
      {err && <span className="text-xs text-red-600">{err}</span>}
    </>
  );
}

// Acciones de una publicación adicional de la misma cuenta (los botones de la fila principal
// actúan sobre la publicación principal): sincronizar, pausar/activar y eliminar el vínculo.
function ExtraListingActions({ isMl, productId, productStock, conn, listing, onDone }: {
  isMl: boolean; productId: string; productStock: number; conn: any; listing: any; onDone: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [warn, setWarn] = useState('');
  async function run(kind: string, fn: () => Promise<any>) {
    setBusy(kind);
    setErr('');
    setWarn('');
    try {
      const r = await fn();
      if (r?.warnings?.length) setWarn(r.warnings.join(' | '));
      await onDone();
    } catch (e: any) {
      setErr(e.message || 'Error');
    } finally {
      setBusy(null);
    }
  }
  const token = () => getToken()!;
  const isActive = listing.status === 'ACTIVE';
  const canToggle = isMl && listing.externalId && (isActive || listing.status === 'PAUSED');
  return (
    <>
      {isMl && listing.externalId && (
        <button onClick={() => run('sync', () => api.marketplace.sync(productId, conn.id, token(), listing.id))} disabled={!!busy}
          title="Envía el precio, descripción y stock del producto a esta publicación"
          className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50 disabled:opacity-50">
          {busy === 'sync' ? 'Sincronizando...' : '↻ Sincronizar'}
        </button>
      )}
      {canToggle && (
        <button onClick={() => run('toggle', () => api.marketplace.toggleListing(productId, conn.id, token(), listing.id))}
          disabled={!!busy || (!isActive && productStock === 0)}
          title={!isActive && productStock === 0 ? 'Sin stock no se puede activar' : isActive ? 'Pausar la publicación' : 'Activar la publicación'}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 ${
            isActive ? 'bg-red-50 border border-red-200 text-red-600 hover:bg-red-100' : 'bg-green-50 border border-green-200 text-green-700 hover:bg-green-100'
          }`}>
          {busy === 'toggle' ? (isActive ? 'Pausando...' : 'Activando...') : isActive ? '⏸ Pausar' : '▶ Activar'}
        </button>
      )}
      <button disabled={!!busy}
        onClick={async () => {
          if (!(await confirmDialog('¿Eliminar el vínculo con esta publicación? La publicación sigue en el marketplace; el sistema deja de rastrearla.', { danger: true }))) return;
          await run('delete', () => api.catalog.deleteListing(productId, conn.id, token(), listing.id));
        }}
        title="Borra el vínculo interno con el marketplace sin afectar la publicación real"
        className="px-3 py-1.5 border border-red-200 bg-red-50 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100 disabled:opacity-50">
        {busy === 'delete' ? 'Eliminando...' : '🗑 Eliminar'}
      </button>
      {warn && <span className="text-xs text-amber-700">{warn}</span>}
      {err && <span className="text-xs text-red-600">{err}</span>}
    </>
  );
}

'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { api, imgUrl, type MlConversationFull, type MlConversationRow, type MlMessageRule, type MlRuleCondition, type MlRuleImage } from '@/lib/api';
import { useMlCompany } from '../MlCompanyContext';
import { onActivity } from '@/lib/activityBus';
import { MlChat } from '@/components/MlChat';
import { Modal, btnPrimary, btnSecondary, inputCls, labelCls, FormError } from '@/components/ui/Modal';
import { confirmDialog } from '../../ConfirmDialog';

type Tab = 'inbox' | 'rules';
const MAX_RULE_IMAGES = 5;

const ago = (d: string | null) => {
  if (!d) return '';
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(d).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
};

export default function MensajesPage() {
  // useSearchParams necesita un límite de Suspense para el render del servidor.
  return <Suspense fallback={null}><MensajesInner /></Suspense>;
}

function MensajesInner() {
  const { companyId } = useMlCompany();
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>('inbox');
  const [unread, setUnread] = useState(0);

  // Sin leer en el botón Bandeja: se actualiza con mensajes nuevos o al leer/marcar una conversación.
  const loadUnread = useCallback(() => {
    api.marketplace.messages.unreadCount(getToken()!, companyId).then((r) => setUnread(r.count)).catch(() => null);
  }, [companyId]);
  useEffect(() => {
    const id = requestAnimationFrame(loadUnread);
    window.addEventListener('ml-messages-changed', loadUnread);
    const off = onActivity(['message'], loadUnread);
    return () => { cancelAnimationFrame(id); window.removeEventListener('ml-messages-changed', loadUnread); off(); };
  }, [loadUnread]);

  return (
    <div className="max-w-[1400px]">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="ui-page-title mb-1">Mensajes</h1>
          <p className="ui-page-subtitle">Conversaciones con los compradores de tus ventas de Mercado Libre y mensajes que se envían solos.</p>
        </div>
        <div role="tablist" aria-label="Secciones de mensajes" className="flex gap-1 rounded-xl border border-gray-200 bg-white p-1">
          {([['inbox', 'Bandeja'], ['rules', 'Mensajes programados']] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${tab === k ? 'bg-[var(--navy)] text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
              {l}
              {k === 'inbox' && unread > 0 && (
                <span className={`grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[10px] font-bold ${tab === k ? 'bg-white text-[var(--navy)]' : 'bg-[var(--brand)] text-white'}`}>{unread}</span>
              )}
            </button>
          ))}
        </div>
      </div>
      {tab === 'inbox' ? <Inbox companyId={companyId} initialId={params.get('c')} /> : <Rules companyId={companyId} />}
    </div>
  );
}

// Estado de la orden interna → etiqueta y color en la bandeja y en la ficha.
const ORDER_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'Por despachar', cls: 'bg-orange-50 text-orange-800' },
  PREPARING: { label: 'Por despachar', cls: 'bg-orange-50 text-orange-800' },
  READY: { label: 'Lista para despacho', cls: 'bg-orange-50 text-orange-800' },
  IN_TRANSIT: { label: 'En camino', cls: 'bg-[var(--brand-light)] text-[var(--brand-ink)]' },
  DELIVERED: { label: 'Entregada', cls: 'bg-green-50 text-green-800' },
  CANCELLED: { label: 'Cancelada', cls: 'bg-gray-100 text-gray-600' },
};
const INVOICE_STATUS: Record<string, string> = { DRAFT: 'Borrador', ISSUED: 'Emitida', ACCEPTED: 'Emitida', REJECTED: 'Rechazada', CANCELLED: 'Anulada' };
const LOG_STATUS: Record<string, { label: string; cls: string }> = {
  SENT: { label: 'Enviado', cls: 'text-green-700' },
  FAILED: { label: 'Falló', cls: 'text-red-600' },
  SKIPPED: { label: 'Omitido', cls: 'text-gray-500' },
};
const clp = (v: string | number) => `$${Number(v).toLocaleString('es-CL', { maximumFractionDigits: 0 })}`;
const when = (d: string) => new Date(d).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const initials = (s: string | null) => (s || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

function Inbox({ companyId, initialId }: { companyId?: string; initialId: string | null }) {
  const [rows, setRows] = useState<MlConversationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(initialId);
  const [conv, setConv] = useState<MlConversationFull | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    const t = getToken()!;
    api.marketplace.messages.list(t, { companyId, unread: unreadOnly, search: search.trim() || undefined, page })
      .then((r) => { setRows(r.rows); setTotal(r.total); setPageSize(r.pageSize); if (r.page !== page) setPage(r.page); })
      .catch(() => { setRows([]); setTotal(0); });
    api.marketplace.messages.unreadCount(t, companyId).then((r) => setUnreadTotal(r.count)).catch(() => null);
  }, [companyId, unreadOnly, search, page]);
  useEffect(() => {
    const id = setTimeout(load, 250);
    return () => clearTimeout(id);
  }, [load]);
  useEffect(() => onActivity(['message'], load), [load]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(page * pageSize, total);

  useEffect(() => {
    if (!openId) return;
    let alive = true;
    const id = requestAnimationFrame(() => {
      setLoading(true);
      api.marketplace.messages.open(openId, getToken()!)
        .then((c) => {
          if (!alive) return;
          setConv(c);
          setRows((r) => r.map((x) => (x.id === c.id ? { ...x, unread: 0 } : x)));
          window.dispatchEvent(new Event('ml-messages-changed'));
        })
        .catch(() => { if (alive) setConv(null); })
        .finally(() => { if (alive) setLoading(false); });
    });
    return () => { alive = false; cancelAnimationFrame(id); };
  }, [openId]);

  // Queda como pendiente (solo en el panel) y se cierra para que no se vuelva a marcar leída.
  async function markUnread(id: string) {
    await api.marketplace.messages.setUnread(id, true, getToken()!).catch(() => null);
    setRows((r) => r.map((x) => (x.id === id ? { ...x, unread: Math.max(1, x.unread) } : x)));
    setOpenId(null);
    setConv(null);
    window.dispatchEvent(new Event('ml-messages-changed'));
    load();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)] xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.5fr)_minmax(0,0.75fr)]">
      {/* Lista de conversaciones (25 por página) */}
      <div className="ui-card flex h-[680px] flex-col overflow-hidden">
        <div className="space-y-2 border-b border-gray-100 p-3">
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Comprador, mensaje o N° de venta…" className={inputCls} />
          <div className="flex gap-1 text-xs font-semibold">
            {[false, true].map((v) => (
              <button key={String(v)} type="button" onClick={() => { setUnreadOnly(v); setPage(1); }}
                className={`rounded-full px-3 py-1 ${unreadOnly === v ? 'bg-[var(--navy)] text-white' : 'bg-gray-100 text-gray-600'}`}>
                {v ? `Sin leer${unreadTotal ? ` (${unreadTotal})` : ''}` : 'Todos'}
              </button>
            ))}
          </div>
        </div>
        <ul className="flex-1 divide-y divide-gray-100 overflow-y-auto">
          {rows.length === 0 && <li className="p-6 text-center text-sm text-gray-400">Sin conversaciones. Aparecen cuando un comprador escribe o cuando escribes desde una venta.</li>}
          {rows.map((r) => {
            const img = r.sale?.items[0]?.product?.images?.[0]?.url;
            const st = r.sale?.order?.status ? ORDER_STATUS[r.sale.order.status] : null;
            const active = openId === r.id;
            return (
              <li key={r.id}>
                <button type="button" onClick={() => setOpenId(r.id)}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 ${active ? 'bg-[var(--brand-light)] shadow-[inset_3px_0_0_var(--brand)]' : ''}`}>
                  <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-gray-100 text-xs font-bold text-gray-600">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {img ? <img src={imgUrl(img)} alt="" className="h-full w-full object-cover" /> : initials(r.buyerName)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm ${r.unread ? 'font-bold' : 'font-medium'}`}>{r.buyerName || `Venta ${r.packId}`}</span>
                      <span className={`shrink-0 text-[11px] ${r.unread ? 'font-semibold text-[var(--brand)]' : 'text-gray-400'}`}>{ago(r.lastMessageAt)}</span>
                    </span>
                    <span className={`block truncate text-xs ${r.unread ? 'text-gray-800' : 'text-gray-500'}`}>
                      {r.lastFrom === 'SELLER' ? 'Tú: ' : ''}{r.lastText || 'Sin mensajes'}
                    </span>
                    {(st || r.sale?.shippingMethod) && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {st && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>{st.label}</span>}
                        {r.sale?.shippingMethod && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">{r.sale.shippingMethod}</span>}
                      </span>
                    )}
                  </span>
                  {r.unread > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[var(--brand)] px-1.5 text-[10px] font-bold text-white">{r.unread}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
          <span>{from}–{to} de {total}</span>
          <span className="flex items-center gap-1">
            {([['«', 1, 'Primera página'], ['‹', page - 1, 'Página anterior'], ['›', page + 1, 'Página siguiente'], ['»', pages, 'Última página']] as const).map(([l, p, aria]) => (
              <button key={aria} type="button" aria-label={aria} title={aria} onClick={() => setPage(p)}
                disabled={p < 1 || p > pages || p === page}
                className="grid h-7 min-w-7 place-items-center rounded-md border border-gray-200 bg-white px-1.5 font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                {l}
              </button>
            ))}
            <span className="ml-1">Pág. {page}/{pages}</span>
          </span>
        </div>
      </div>

      {/* Chat con el historial completo */}
      <div className="ui-card flex h-[680px] flex-col p-4">
        {!openId ? (
          <p className="m-auto text-sm text-gray-400">Elige una conversación para verla y responder.</p>
        ) : loading && !conv ? (
          <p className="m-auto text-sm text-gray-400">Cargando mensajes…</p>
        ) : conv ? (
          <>
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-xs font-bold text-white">{initials(conv.buyerName)}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{conv.buyerName || `Venta ${conv.packId}`}</p>
                  <p className="truncate text-xs text-gray-500">Venta {conv.sale?.externalId || conv.packId} · {conv.connection.name}</p>
                </div>
              </div>
              <button type="button" onClick={() => markUnread(conv.id)}
                className="shrink-0 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
                Marcar no leído
              </button>
            </div>
            <div className="min-h-0 flex-1"><MlChat conversation={conv} onChange={(c) => { setConv(c); load(); }} /></div>
          </>
        ) : (
          <p className="m-auto text-sm text-gray-400">No se pudo abrir la conversación.</p>
        )}
      </div>

      {/* Ficha de la venta */}
      <div className="flex flex-col gap-3 lg:col-span-2 xl:col-span-1">
        {conv && openId ? <SaleCard conv={conv} /> : (
          <div className="ui-card p-4 text-sm text-gray-400">La ficha de la venta aparece al abrir una conversación.</div>
        )}
      </div>
    </div>
  );
}

function SaleCard({ conv }: { conv: MlConversationFull }) {
  const sale = conv.sale;
  if (!sale) return <div className="ui-card p-4 text-sm text-gray-400">Esta conversación no está vinculada a una venta del panel.</div>;
  const order = sale.order;
  const st = order?.status ? ORDER_STATUS[order.status] : null;
  const inv = sale.invoices[0];
  const invoiced = !!inv && ['ISSUED', 'ACCEPTED'].includes(inv.status);
  const steps: Array<{ label: string; date: string | null; done: boolean }> = [
    { label: 'Venta recibida', date: sale.createdAt, done: true },
    { label: inv ? `Boleta ${inv.folio ? `N° ${inv.folio}` : ''}`.trim() : 'Boleta', date: invoiced ? inv!.createdAt : null, done: invoiced },
    { label: 'Despachada', date: order?.dispatchedAt || null, done: !!order?.dispatchedAt || ['IN_TRANSIT', 'DELIVERED'].includes(order?.status || '') },
    { label: 'Entregada', date: order?.deliveredAt || null, done: order?.status === 'DELIVERED' },
  ];
  const current = steps.findIndex((s) => !s.done);
  const title = 'text-[11px] font-bold uppercase tracking-wide text-gray-500';

  return (
    <>
      <div className="ui-card space-y-3 p-4">
        <p className={title}>Venta</p>
        <div className="space-y-2">
          {sale.items.map((it, i) => {
            const img = it.product?.images?.[0]?.url;
            return (
              <div key={i} className="flex items-center gap-2.5">
                <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {img ? <img src={imgUrl(img)} alt="" className="h-full w-full object-cover" /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{it.product?.name || 'Producto'}</span>
                  <span className="block text-xs text-gray-500">{it.quantity} u.{it.product?.sku ? ` · SKU ${it.product.sku}` : ''}</span>
                </span>
              </div>
            );
          })}
        </div>
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <div><dt className="text-gray-500">Total</dt><dd className="font-bold">{clp(sale.total)}</dd></div>
          <div><dt className="text-gray-500">Envío</dt><dd className="font-bold">{sale.shippingMethod || '—'}</dd></div>
          <div><dt className="text-gray-500">Boleta</dt><dd className="font-bold">{inv ? INVOICE_STATUS[inv.status] || inv.status : 'Sin emitir'}</dd></div>
          <div><dt className="text-gray-500">Estado</dt><dd>{st ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.label}</span> : '—'}</dd></div>
          {order?.trackingCode && <div className="col-span-2"><dt className="text-gray-500">Seguimiento</dt><dd className="font-bold">{order.courier ? `${order.courier} · ` : ''}{order.trackingCode}</dd></div>}
        </dl>
        {order?.id && <Link href={`/dashboard/orders/${order.id}`} className="inline-block text-sm font-semibold text-[var(--brand)] hover:underline">Ver orden →</Link>}
      </div>

      <div className="ui-card space-y-2.5 p-4">
        <p className={title}>Recorrido</p>
        {order?.status === 'CANCELLED' ? <p className="text-xs text-gray-500">Orden cancelada.</p> : (
          <ol className="space-y-2.5">
            {steps.map((s, i) => (
              <li key={s.label} className={`flex items-center gap-2 text-xs ${i === current ? 'font-semibold text-gray-900' : s.done ? 'text-gray-700' : 'text-gray-400'}`}>
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.done ? 'bg-green-600' : i === current ? 'bg-[var(--brand)] ring-[3px] ring-[var(--brand-light)]' : 'border-2 border-gray-300'}`} />
                <span className="flex-1">{s.label}</span>
                {s.date && s.done && <span className="text-[11px] font-normal text-gray-400">{when(s.date)}</span>}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="ui-card space-y-2 p-4">
        <p className={title}>Mensajes automáticos</p>
        {sale.mlMessageLogs.length === 0
          ? <p className="text-xs text-gray-400">Ningún mensaje programado se ha procesado para esta venta.</p>
          : sale.mlMessageLogs.map((l, i) => {
            const s = LOG_STATUS[l.status] || { label: l.status, cls: 'text-gray-500' };
            return (
              <div key={i} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{l.rule.name}</span>
                <span className={`shrink-0 font-semibold ${s.cls}`}>{s.label}</span>
              </div>
            );
          })}
      </div>
    </>
  );
}

const TRIGGERS: Record<MlMessageRule['trigger'], string> = {
  SALE_CREATED: 'Cuando entra la venta',
  INVOICE_ISSUED: 'Cuando se emite la boleta o factura',
  ORDER_DISPATCHED: 'Cuando la orden se despacha',
  ORDER_DELIVERED: 'Cuando la orden se entrega',
};
const VARS = ['{nombre}', '{producto}', '{productos}', '{numero_venta}', '{boleta}', '{link_boleta}', '{tienda}'];
const delayLabel = (m: number) => (!m ? 'al instante' : m % 1440 === 0 ? `${m / 1440} día(s) después` : m % 60 === 0 ? `${m / 60} h después` : `${m} min después`);

// «hace 5 min», «hace 3 h», «hace 2 días».
function timeAgo(iso: string) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} día${d === 1 ? '' : 's'}`;
}

function Rules({ companyId }: { companyId?: string }) {
  const [rules, setRules] = useState<MlMessageRule[]>([]);
  const [conns, setConns] = useState<Array<{ id: string; name: string }>>([]);
  const [editing, setEditing] = useState<MlMessageRule | 'new' | null>(null);
  // Nombres de los productos usados en las condiciones (para mostrarlos en vez del id).
  const [productNames, setProductNames] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    const t = getToken()!;
    api.marketplace.messages.rules(t, companyId).then(setRules).catch(() => setRules([]));
    api.marketplace.connections(t, companyId).then((c: Array<{ id: string; name: string }>) => setConns(c.map((x) => ({ id: x.id, name: x.name })))).catch(() => setConns([]));
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  // Activar / pausar desde la tarjeta. Si hay envíos en espera (al pausar) o acumulados durante la
  // pausa (al activar), se pregunta qué hacer con ellos antes de cambiar.
  const [asking, setAsking] = useState<MlMessageRule | null>(null);
  const [busyId, setBusyId] = useState('');
  const [toast, setToast] = useState('');

  async function applyActive(r: MlMessageRule, active: boolean, pending?: 'cancel' | 'keep' | 'skip' | 'send') {
    setAsking(null);
    setBusyId(r.id);
    // Cambio inmediato en pantalla; si falla, se recarga el estado real.
    setRules((list) => list.map((x) => (x.id === r.id ? { ...x, active } : x)));
    try {
      const res = await api.marketplace.messages.setRuleActive(r.id, active, pending, getToken()!);
      const extra = res.skipped ? ` · ${res.skipped} ${active ? 'venta(s) acumulada(s) omitida(s)' : 'envío(s) en espera cancelado(s)'}` : '';
      setToast(active ? `«${r.name}» activo: se enviará a las ventas nuevas${extra}` : `«${r.name}» pausado: no se enviará a ventas nuevas${extra}`);
    } catch (e) {
      setToast((e as Error).message || 'No se pudo cambiar el estado');
    } finally {
      setBusyId('');
      load();
    }
  }

  function toggle(r: MlMessageRule) {
    const pendingWhenPausing = (r.waitingCount || 0) + (r.dueCount || 0);
    if (r.active && pendingWhenPausing > 0) { setAsking(r); return; }
    if (!r.active && (r.dueCount || 0) > 0) { setAsking(r); return; }
    applyActive(r, !r.active);
  }

  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(h);
  }, [toast]);
  async function remove(r: MlMessageRule) {
    if (!(await confirmDialog(`¿Eliminar "${r.name}"?`, { danger: true }))) return;
    await api.marketplace.messages.deleteRule(r.id, getToken()!).catch(() => null);
    load();
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-xs leading-relaxed text-gray-500">
          Cada mensaje se envía una sola vez por venta de Mercado Libre, cuando la venta cumple el momento elegido y pasa la espera. Solo aplica a ventas nuevas desde que lo creas. Mercado Libre permite hasta 350 caracteres y modera los mensajes promocionales.
        </p>
        <button type="button" onClick={() => setEditing('new')} className={btnPrimary}>+ Nuevo mensaje programado</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {rules.length === 0 && <p className="text-sm text-gray-400">Aún no tienes mensajes programados.</p>}
        {rules.map((r) => (
          <div key={r.id} className={`ui-card p-4 ${r.active ? '' : 'opacity-60'}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">{r.name}</p>
                <p className="text-xs text-gray-500">{TRIGGERS[r.trigger]} · {delayLabel(r.delayMinutes)}</p>
              </div>
              <label className="flex shrink-0 cursor-pointer items-center gap-2">
                <span className={`text-[11px] font-semibold ${r.active ? 'text-green-700' : 'text-gray-500'}`}>{r.active ? 'Activo' : 'Pausado'}</span>
                <button type="button" role="switch" aria-checked={r.active} aria-label={r.active ? `Pausar «${r.name}»` : `Activar «${r.name}»`}
                  disabled={busyId === r.id} onClick={() => toggle(r)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${r.active ? 'bg-green-500' : 'bg-gray-300'}`}>
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${r.active ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </label>
            </div>
            <p className="mt-2 rounded-lg bg-[var(--page-bg)] px-3 py-2 text-xs text-gray-700">{r.text}</p>
            {!!r.images?.length && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {r.images.map((img) => (
                  <img key={img.url} src={imgUrl(img.url)} alt={img.name} className="h-10 w-10 rounded-md border border-gray-200 object-cover" />
                ))}
              </div>
            )}
            {(!!r.waitingCount || (!r.active && !!r.dueCount) || r.lastSentAt) && (
              <p className="mt-2 text-[11px] text-gray-500">
                {!!r.waitingCount && <span className="font-medium text-blue-700">⏳ {r.waitingCount}{r.queueCapped ? '+' : ''} envío(s) en espera</span>}
                {!r.active && !!r.dueCount && <span className={`font-medium text-amber-700 ${r.waitingCount ? 'before:mx-1 before:content-["·"]' : ''}`}>{r.dueCount}{r.queueCapped ? '+' : ''} venta(s) acumulada(s) en la pausa</span>}
                {r.lastSentAt && <span className={(r.waitingCount || (!r.active && r.dueCount)) ? 'before:mx-1 before:content-["·"]' : ''}>último envío {timeAgo(r.lastSentAt)}</span>}
              </p>
            )}
            <div className="mt-2 flex items-center justify-between text-[11px] text-gray-400">
              <span>
                {describe(r, conns, productNames)}
                {r.markVerification ? ' · marca verificación' : ''}
                {r._count ? ` · ${r._count.logs} procesada(s)` : ''}
              </span>
              <span className="flex gap-3 font-medium">
                <button type="button" onClick={() => setEditing(r)} className="text-[var(--brand)] hover:underline">Editar</button>
                <button type="button" onClick={() => remove(r)} className="text-red-500 hover:underline">Eliminar</button>
              </span>
            </div>
          </div>
        ))}
      </div>
      {toast && (
        <div role="status" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg">{toast}</div>
      )}
      {asking && (
        <Modal title={asking.active ? `Pausar «${asking.name}»` : `Activar «${asking.name}»`} onClose={() => setAsking(null)}
          footer={asking.active ? (
            <>
              <button type="button" onClick={() => setAsking(null)} className={btnSecondary}>Volver</button>
              <button type="button" onClick={() => applyActive(asking, false, 'keep')} className={btnSecondary}>Conservarlos</button>
              <button type="button" onClick={() => applyActive(asking, false, 'cancel')} className={btnPrimary}>Cancelarlos y pausar</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setAsking(null)} className={btnSecondary}>Volver</button>
              <button type="button" onClick={() => applyActive(asking, true, 'send')} className={btnSecondary}>Enviarles también</button>
              <button type="button" onClick={() => applyActive(asking, true, 'skip')} className={btnPrimary}>Solo ventas nuevas</button>
            </>
          )}>
          {asking.active ? (
            <p className="text-sm text-gray-700">
              Hay <strong>{(asking.waitingCount || 0) + (asking.dueCount || 0)}{asking.queueCapped ? '+' : ''}</strong> venta(s) esperando este mensaje.
              Mientras esté pausado no se envía nada. ¿Cancelamos esos envíos o los conservamos? Al reactivarlo podrás elegir si enviárselos.
            </p>
          ) : (
            <p className="text-sm text-gray-700">
              Mientras estuvo pausado, a <strong>{asking.dueCount}{asking.queueCapped ? '+' : ''}</strong> venta(s) ya les correspondía este mensaje.
              ¿Se los enviamos ahora o lo dejamos solo para las ventas nuevas?
            </p>
          )}
        </Modal>
      )}
      {editing && <RuleForm rule={editing === 'new' ? null : editing} conns={conns} companyId={companyId}
        productNames={productNames} onProductName={(id, name) => setProductNames((m) => ({ ...m, [id]: name }))}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

const COND_FIELDS: Record<MlRuleCondition['field'], string> = {
  category: 'Categoría del catálogo',
  product: 'Producto específico',
  shipping: 'Tipo de envío',
  total: 'Monto de la venta',
  account: 'Cuenta de Mercado Libre',
};
const SHIPPING: Array<[string, string]> = [
  ['FLEX', 'Flex'], ['TURBO', 'Turbo'], ['COLECTA', 'Colecta'], ['FULL', 'Full'], ['COORDINAR', 'A coordinar / retiro'],
];
const TEMPLATES: Array<{ label: string; name: string; trigger: MlMessageRule['trigger']; text: string; verify: boolean }> = [
  { label: 'Confirmación de compra', name: 'Confirmación de compra', trigger: 'SALE_CREATED', verify: false,
    text: 'Hola {nombre}, confirmamos tu compra de {productos}. Te avisaremos cuando tu pedido salga. ¡Gracias!' },
  { label: 'Solicitud de datos para verificar', name: 'Verificación de compra', trigger: 'SALE_CREATED', verify: true,
    text: 'Hola {nombre}, para despachar tu compra de {producto} necesitamos verificar tus datos. ¿Nos confirmas tu RUT y un teléfono de contacto?' },
  { label: 'Envío de boleta', name: 'Envío de boleta', trigger: 'INVOICE_ISSUED', verify: false,
    text: 'Hola {nombre}, gracias por tu compra. Tu boleta {boleta}: {link_boleta}' },
];

// Condiciones guardadas + las antiguas (cuenta y monto mínimo) convertidas al nuevo formato.
const ruleConditions = (r: MlMessageRule | null): MlRuleCondition[] => {
  const out: MlRuleCondition[] = [...(r?.conditions || [])];
  if (r?.connectionId && !out.some((c) => c.field === 'account')) out.push({ field: 'account', values: [r.connectionId] });
  if (r?.minTotal != null && !out.some((c) => c.field === 'total')) out.push({ field: 'total', values: [String(Number(r.minTotal))] });
  return out;
};

function describe(r: MlMessageRule, conns: Array<{ id: string; name: string }>, products: Record<string, string>) {
  const conds = ruleConditions(r);
  if (!conds.length) return 'Todas las ventas';
  const parts = conds.map((c) => {
    if (c.field === 'total') return `monto desde $${Number(c.values[0]).toLocaleString('es-CL')}`;
    if (c.field === 'account') return `cuenta ${c.values.map((v) => conns.find((x) => x.id === v)?.name || '—').join(' o ')}`;
    if (c.field === 'shipping') return `envío ${c.values.map((v) => SHIPPING.find(([k]) => k === v)?.[1] || v).join(' o ')}`;
    if (c.field === 'product') return `producto ${c.values.map((v) => c.labels?.[v] || products[v] || 'seleccionado').join(' o ')}`;
    return `categoría ${c.values.join(' o ')}`;
  });
  return parts.join(r.match === 'ANY' ? ' O ' : ' Y ');
}

function ValuePicker({ cond, onChange, conns, categories, companyId, productNames, onProductName }: {
  cond: MlRuleCondition; onChange: (values: string[], labels?: Record<string, string>) => void; conns: Array<{ id: string; name: string }>;
  categories: string[]; companyId?: string; productNames: Record<string, string>; onProductName: (id: string, name: string) => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Array<{ id: string; name: string; sku: string }>>([]);
  useEffect(() => {
    if (cond.field !== 'product' || q.trim().length < 2) return;
    const t = setTimeout(() => {
      api.catalog.search({ search: q.trim(), pageSize: 8, companyId }, getToken()!)
        .then((r) => setResults((r.products || []).map((p: { id: string; name: string; sku: string }) => ({ id: p.id, name: p.name, sku: p.sku }))))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, cond.field, companyId]);

  const chips = (label: (v: string) => string) => (
    <div className="flex flex-wrap gap-1">
      {cond.values.map((v) => (
        <span key={v} className="flex items-center gap-1 rounded-full bg-[var(--brand-light)] px-2 py-0.5 text-[11px] font-medium text-[var(--brand-ink)]">
          {label(v)}
          <button type="button" onClick={() => onChange(cond.values.filter((x) => x !== v))} aria-label="Quitar" className="opacity-60 hover:opacity-100">×</button>
        </span>
      ))}
    </div>
  );
  const toggle = (v: string) => onChange(cond.values.includes(v) ? cond.values.filter((x) => x !== v) : [...cond.values, v]);

  if (cond.field === 'total') {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-600">
        <span>mayor o igual a $</span>
        <input type="number" min={0} value={cond.values[0] || ''} onChange={(e) => onChange(e.target.value ? [e.target.value] : [])} className={`${inputCls} w-32`} />
      </div>
    );
  }
  if (cond.field === 'shipping' || cond.field === 'account') {
    const opts = cond.field === 'shipping' ? SHIPPING : conns.map((c) => [c.id, c.name] as [string, string]);
    return (
      <div className="flex flex-wrap gap-1">
        {opts.map(([k, l]) => (
          <button key={k} type="button" onClick={() => toggle(k)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${cond.values.includes(k) ? 'border-[var(--navy)] bg-[var(--navy)] text-white' : 'border-gray-200 bg-white text-gray-600'}`}>
            {l}
          </button>
        ))}
      </div>
    );
  }
  if (cond.field === 'category') {
    return (
      <div className="space-y-1.5">
        {chips((v) => v)}
        <select value="" onChange={(e) => e.target.value && toggle(e.target.value)} className={inputCls}>
          <option value="">+ Agregar categoría…</option>
          {categories.filter((c) => !cond.values.includes(c)).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
    );
  }
  return (
    <div className="relative space-y-1.5">
      {chips((v) => cond.labels?.[v] || productNames[v] || 'Producto')}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto por nombre o SKU…" className={inputCls} />
      {q.trim().length >= 2 && results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {results.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => { onProductName(p.id, p.name); if (!cond.values.includes(p.id)) onChange([...cond.values, p.id], { ...(cond.labels || {}), [p.id]: p.name }); setQ(''); setResults([]); }}
                className="block w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50">
                <span className="font-medium">{p.name}</span> <span className="text-gray-400">· {p.sku}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RuleForm({ rule, conns, companyId, productNames, onProductName, onClose, onSaved }: {
  rule: MlMessageRule | null; conns: Array<{ id: string; name: string }>; companyId?: string;
  productNames: Record<string, string>; onProductName: (id: string, name: string) => void;
  onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: rule?.name || '',
    trigger: rule?.trigger || 'SALE_CREATED',
    delayValue: rule ? String(rule.delayMinutes % 1440 === 0 && rule.delayMinutes ? rule.delayMinutes / 1440 : rule.delayMinutes % 60 === 0 && rule.delayMinutes ? rule.delayMinutes / 60 : rule.delayMinutes) : '0',
    delayUnit: rule ? (rule.delayMinutes % 1440 === 0 && rule.delayMinutes ? 'd' : rule.delayMinutes % 60 === 0 && rule.delayMinutes ? 'h' : 'm') : 'm',
    text: rule?.text || TEMPLATES[0].text,
    match: (rule?.match || 'ALL') as 'ALL' | 'ANY',
    markVerification: rule?.markVerification ?? false,
    active: rule?.active ?? true,
  });
  const [conds, setConds] = useState<MlRuleCondition[]>(() => ruleConditions(rule));
  const [images, setImages] = useState<MlRuleImage[]>(() => (Array.isArray(rule?.images) ? rule!.images! : []));
  const [uploading, setUploading] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.catalog.categories(getToken()!, companyId).then(setCategories).catch(() => setCategories([]));
  }, [companyId]);

  const setCond = (i: number, c: MlRuleCondition) => setConds((cs) => cs.map((x, j) => (j === i ? c : x)));

  // Imágenes del mensaje: se suben al sistema y se envían junto al texto a cada comprador.
  async function addImages(list: FileList | null) {
    const files = Array.from(list || []).filter((f) => f.type.startsWith('image/'));
    const room = MAX_RULE_IMAGES - images.length;
    if (!files.length) return;
    if (room <= 0) { setError(`Puedes agregar hasta ${MAX_RULE_IMAGES} imágenes`); return; }
    setError('');
    setUploading((n) => n + Math.min(room, files.length));
    for (const file of files.slice(0, room)) {
      try {
        if (file.size > 10 * 1024 * 1024) throw new Error(`"${file.name}" pesa más de 10 MB`);
        const img = await api.marketplace.messages.uploadRuleImage(file, getToken()!, companyId);
        setImages((prev) => [...prev, img].slice(0, MAX_RULE_IMAGES));
      } catch (err) {
        setError((err as Error).message || `No se pudo subir "${file.name}"`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const mult = form.delayUnit === 'd' ? 1440 : form.delayUnit === 'h' ? 60 : 1;
    const data = {
      name: form.name, trigger: form.trigger as MlMessageRule['trigger'], text: form.text, active: form.active, images,
      delayMinutes: Math.max(0, Math.round(Number(form.delayValue) || 0) * mult),
      match: form.match, markVerification: form.markVerification,
      conditions: conds.filter((c) => c.values.length),
      // Las condiciones reemplazan a los campos antiguos de cuenta y monto.
      connectionId: null, minTotal: null,
    };
    try {
      if (rule) await api.marketplace.messages.updateRule(rule.id, data, getToken()!);
      else await api.marketplace.messages.createRule({ ...data, companyId }, getToken()!);
      onSaved();
    } catch (err) {
      setError((err as Error).message || 'No se pudo guardar');
      setBusy(false);
    }
  }

  return (
    <Modal title={rule ? 'Editar mensaje programado' : 'Nuevo mensaje programado'} size="xl" busy={busy} onClose={onClose} onSubmit={save}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className={btnSecondary}>Cancelar</button>
          <button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </>
      )}>
      <div className="space-y-5">
        {!rule && (
          <div>
            <p className={labelCls}>Partir de una plantilla</p>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES.map((t) => (
                <button key={t.label} type="button"
                  onClick={() => setForm((f) => ({ ...f, name: t.name, trigger: t.trigger, text: t.text, markVerification: t.verify }))}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr_auto_auto]">
          <div>
            <label className={labelCls}>Nombre</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Confirmación de compra" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Cuándo se envía</label>
            <select value={form.trigger} onChange={(e) => setForm((f) => ({ ...f, trigger: e.target.value as MlMessageRule['trigger'] }))} className={inputCls}>
              {Object.entries(TRIGGERS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Espera</label>
            <input type="number" min={0} value={form.delayValue} onChange={(e) => setForm((f) => ({ ...f, delayValue: e.target.value }))} className={`${inputCls} w-20`} />
          </div>
          <div>
            <label className={labelCls}>&nbsp;</label>
            <select value={form.delayUnit} onChange={(e) => setForm((f) => ({ ...f, delayUnit: e.target.value }))} className={inputCls}>
              <option value="m">minutos</option><option value="h">horas</option><option value="d">días</option>
            </select>
          </div>
        </div>

        {/* Condiciones con Y / O */}
        <div className="rounded-xl border border-gray-200 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-gray-800">Condiciones de la venta</p>
            <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-0.5 text-[11px] font-semibold">
              {([['ALL', 'Cumplir todas (Y)'], ['ANY', 'Cumplir cualquiera (O)']] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setForm((f) => ({ ...f, match: k }))}
                  className={`rounded-md px-2.5 py-1 ${form.match === k ? 'bg-white shadow-sm' : 'text-gray-500'}`}>{l}</button>
              ))}
            </div>
          </div>
          {conds.length === 0 && <p className="mb-2 text-xs text-gray-400">Sin condiciones: se envía a todas las ventas de Mercado Libre.</p>}
          <div className="space-y-2">
            {conds.map((c, i) => (
              <div key={i} className="grid gap-2 rounded-lg bg-[var(--page-bg)] p-2 sm:grid-cols-[200px_1fr_auto] sm:items-start">
                <select value={c.field} onChange={(e) => setCond(i, { field: e.target.value as MlRuleCondition['field'], values: [] })} className={inputCls}>
                  {Object.entries(COND_FIELDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <ValuePicker cond={c} onChange={(values, labels) => setCond(i, { ...c, values, ...(labels ? { labels } : {}) })} conns={conns} categories={categories}
                  companyId={companyId} productNames={productNames} onProductName={onProductName} />
                <button type="button" onClick={() => setConds((cs) => cs.filter((_, j) => j !== i))} className="px-2 py-1.5 text-xs text-red-500 hover:underline">Quitar</button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setConds((cs) => [...cs, { field: 'category', values: [] }])}
            className="mt-2 text-xs font-medium text-[var(--brand)] hover:underline">+ Agregar condición</button>
          <p className="mt-1 text-[11px] text-gray-400">Categoría y producto se cumplen si la venta incluye al menos uno de los elegidos.</p>
        </div>

        <div>
          <label className={labelCls}>Mensaje ({form.text.length}/350)</label>
          <textarea value={form.text} onChange={(e) => setForm((f) => ({ ...f, text: e.target.value.slice(0, 350) }))} rows={4} className={`${inputCls} resize-none`} />
          <div className="mt-1 flex flex-wrap gap-1">
            {VARS.map((v) => (
              <button key={v} type="button" onClick={() => setForm((f) => ({ ...f, text: `${f.text}${f.text.endsWith(' ') || !f.text ? '' : ' '}${v}`.slice(0, 350) }))}
                className="rounded-full border border-gray-200 bg-white px-2 py-0.5 font-mono text-[11px] text-gray-600 hover:bg-gray-50">{v}</button>
            ))}
          </div>
        </div>

        <div>
          <label className={labelCls}>Imágenes ({images.length}/{MAX_RULE_IMAGES})</label>
          <div className="flex flex-wrap items-center gap-2"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); addImages(e.dataTransfer.files); }}>
            {images.map((img, i) => (
              <div key={img.url} className="relative h-20 w-20 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                <img src={imgUrl(img.url)} alt={img.name} className="h-full w-full object-cover" />
                <button type="button" onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={`Quitar ${img.name}`}
                  className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-white/90 text-sm font-bold text-gray-700 shadow hover:bg-white">×</button>
              </div>
            ))}
            {Array.from({ length: uploading }).map((_, i) => (
              <div key={`up-${i}`} className="grid h-20 w-20 place-items-center rounded-lg border border-dashed border-gray-300 text-[11px] text-gray-400">Subiendo…</div>
            ))}
            {images.length + uploading < MAX_RULE_IMAGES && (
              <label className="grid h-20 w-20 cursor-pointer place-items-center rounded-lg border border-dashed border-gray-300 text-center text-[11px] text-gray-500 hover:bg-gray-50">
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="sr-only"
                  onChange={(e) => { addImages(e.target.files); e.target.value = ''; }} />
                + Agregar
              </label>
            )}
          </div>
          <p className="mt-1 text-[11px] text-gray-400">JPG, PNG, WEBP o GIF, hasta 10 MB cada una. Se envían junto al texto a cada comprador. También puedes arrastrarlas aquí.</p>
        </div>

        <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <input type="checkbox" checked={form.markVerification} onChange={(e) => setForm((f) => ({ ...f, markVerification: e.target.checked }))} className="mt-0.5 accent-amber-600" />
          <span>
            <strong>Marcar la orden como &quot;Pendiente de verificación&quot;</strong>
            <span className="block text-xs text-amber-800">Útil para la solicitud de datos: la orden queda con aviso hasta que alguien la marque como verificada. No bloquea la preparación.</span>
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} className="accent-blue-600" />
          Activo
        </label>
        <FormError message={error} />
      </div>
    </Modal>
  );
}

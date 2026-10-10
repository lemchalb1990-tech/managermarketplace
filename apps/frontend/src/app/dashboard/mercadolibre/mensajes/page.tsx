'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { api, imgUrl, type MlConversationFull, type MlConversationRow, type MlMessageRule } from '@/lib/api';
import { useMlCompany } from '../MlCompanyContext';
import { onActivity } from '@/lib/activityBus';
import { MlChat } from '@/components/MlChat';
import { Modal, btnPrimary, btnSecondary, inputCls, labelCls, FormError } from '@/components/ui/Modal';
import { confirmDialog } from '../../ConfirmDialog';

type Tab = 'inbox' | 'rules';

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

  return (
    <div className="max-w-6xl">
      <h1 className="ui-page-title mb-1">Mensajes</h1>
      <p className="ui-page-subtitle mb-4">Conversaciones con los compradores de tus ventas de Mercado Libre y mensajes que se envían solos.</p>
      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {([['inbox', 'Bandeja'], ['rules', 'Mensajes programados']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === k ? 'border-[var(--brand)] text-[var(--brand-ink)]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'inbox' ? <Inbox companyId={companyId} initialId={params.get('c')} /> : <Rules companyId={companyId} />}
    </div>
  );
}

function Inbox({ companyId, initialId }: { companyId?: string; initialId: string | null }) {
  const [rows, setRows] = useState<MlConversationRow[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(initialId);
  const [conv, setConv] = useState<MlConversationFull | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    api.marketplace.messages.list(getToken()!, { companyId, unread: unreadOnly, search: search.trim() || undefined })
      .then(setRows).catch(() => setRows([]));
  }, [companyId, unreadOnly, search]);
  useEffect(() => {
    const id = setTimeout(load, 250);
    return () => clearTimeout(id);
  }, [load]);
  useEffect(() => onActivity(['message'], load), [load]);

  useEffect(() => {
    if (!openId) return;
    let alive = true;
    const id = requestAnimationFrame(() => {
      setLoading(true);
      api.marketplace.messages.open(openId, getToken()!)
        .then((c) => { if (alive) { setConv(c); setRows((r) => r.map((x) => (x.id === c.id ? { ...x, unread: 0 } : x))); } })
        .catch(() => { if (alive) setConv(null); })
        .finally(() => { if (alive) setLoading(false); });
    });
    return () => { alive = false; cancelAnimationFrame(id); };
  }, [openId]);

  const unread = rows.filter((r) => r.unread > 0).length;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
      <div className="ui-card flex min-h-[520px] flex-col overflow-hidden">
        <div className="space-y-2 border-b border-gray-100 p-3">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por comprador o mensaje…" className={inputCls} />
          <div className="flex gap-1 text-xs font-semibold">
            {[false, true].map((v) => (
              <button key={String(v)} type="button" onClick={() => setUnreadOnly(v)}
                className={`rounded-full px-3 py-1 ${unreadOnly === v ? 'bg-[var(--navy)] text-white' : 'bg-gray-100 text-gray-600'}`}>
                {v ? `Sin leer${unread ? ` (${unread})` : ''}` : 'Todos'}
              </button>
            ))}
          </div>
        </div>
        <ul className="flex-1 divide-y divide-gray-100 overflow-y-auto">
          {rows.length === 0 && <li className="p-6 text-center text-sm text-gray-400">Sin conversaciones. Aparecen cuando un comprador escribe o cuando escribes desde una venta.</li>}
          {rows.map((r) => {
            const img = r.sale?.items[0]?.product?.images?.[0]?.url;
            return (
              <li key={r.id}>
                <button type="button" onClick={() => setOpenId(r.id)}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 ${openId === r.id ? 'bg-[var(--brand-light)]' : ''}`}>
                  <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {img ? <img src={imgUrl(img)} alt="" className="h-full w-full object-cover" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm ${r.unread ? 'font-bold' : 'font-medium'}`}>{r.buyerName || `Venta ${r.packId}`}</span>
                      <span className="shrink-0 text-[11px] text-gray-400">{ago(r.lastMessageAt)}</span>
                    </span>
                    <span className="block truncate text-xs text-gray-500">{r.sale?.items[0]?.product?.name || r.connection.name}</span>
                    <span className={`block truncate text-xs ${r.unread ? 'text-gray-800' : 'text-gray-400'}`}>
                      {r.lastFrom === 'SELLER' ? 'Tú: ' : ''}{r.lastText || 'Sin mensajes'}
                    </span>
                  </span>
                  {r.unread > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[var(--brand)] px-1.5 text-[10px] font-bold text-white">{r.unread}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="ui-card flex min-h-[520px] flex-col p-4">
        {!openId ? (
          <p className="m-auto text-sm text-gray-400">Elige una conversación para verla y responder.</p>
        ) : loading && !conv ? (
          <p className="m-auto text-sm text-gray-400">Cargando mensajes…</p>
        ) : conv ? (
          <>
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{conv.buyerName || `Venta ${conv.packId}`}</p>
                <p className="truncate text-xs text-gray-500">
                  {conv.connection.name} · Venta {conv.sale?.externalId || conv.packId}
                  {conv.sale?.items?.[0]?.product?.name ? ` · ${conv.sale.items[0].product.name}` : ''}
                </p>
              </div>
              {conv.sale?.order?.id && (
                <Link href={`/dashboard/orders/${conv.sale.order.id}`} className="shrink-0 text-xs font-medium text-[var(--brand)] hover:underline">Ver orden →</Link>
              )}
            </div>
            <div className="min-h-0 flex-1"><MlChat conversation={conv} onChange={(c) => { setConv(c); load(); }} /></div>
          </>
        ) : (
          <p className="m-auto text-sm text-gray-400">No se pudo abrir la conversación.</p>
        )}
      </div>
    </div>
  );
}

const TRIGGERS: Record<MlMessageRule['trigger'], string> = {
  SALE_CREATED: 'Cuando entra la venta',
  INVOICE_ISSUED: 'Cuando se emite la boleta o factura',
  ORDER_DISPATCHED: 'Cuando la orden se despacha',
  ORDER_DELIVERED: 'Cuando la orden se entrega',
};
const VARS = ['{nombre}', '{producto}', '{numero_venta}', '{boleta}', '{link_boleta}', '{tienda}'];
const delayLabel = (m: number) => (!m ? 'al instante' : m % 1440 === 0 ? `${m / 1440} día(s) después` : m % 60 === 0 ? `${m / 60} h después` : `${m} min después`);

function Rules({ companyId }: { companyId?: string }) {
  const [rules, setRules] = useState<MlMessageRule[]>([]);
  const [conns, setConns] = useState<Array<{ id: string; name: string }>>([]);
  const [editing, setEditing] = useState<MlMessageRule | 'new' | null>(null);

  const load = useCallback(() => {
    const t = getToken()!;
    api.marketplace.messages.rules(t, companyId).then(setRules).catch(() => setRules([]));
    api.marketplace.connections(t, companyId).then((c: Array<{ id: string; name: string }>) => setConns(c.map((x) => ({ id: x.id, name: x.name })))).catch(() => setConns([]));
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  async function toggle(r: MlMessageRule) {
    await api.marketplace.messages.updateRule(r.id, { active: !r.active }, getToken()!).catch(() => null);
    load();
  }
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
              <button type="button" onClick={() => toggle(r)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${r.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {r.active ? 'Activo' : 'Pausado'}
              </button>
            </div>
            <p className="mt-2 rounded-lg bg-[var(--page-bg)] px-3 py-2 text-xs text-gray-700">{r.text}</p>
            <div className="mt-2 flex items-center justify-between text-[11px] text-gray-400">
              <span>
                {r.connectionId ? `Cuenta: ${conns.find((c) => c.id === r.connectionId)?.name || '—'}` : 'Todas las cuentas'}
                {r.minTotal != null ? ` · ventas desde $${Number(r.minTotal).toLocaleString('es-CL')}` : ''}
                {r._count ? ` · ${r._count.logs} enviado(s)` : ''}
              </span>
              <span className="flex gap-3 font-medium">
                <button type="button" onClick={() => setEditing(r)} className="text-[var(--brand)] hover:underline">Editar</button>
                <button type="button" onClick={() => remove(r)} className="text-red-500 hover:underline">Eliminar</button>
              </span>
            </div>
          </div>
        ))}
      </div>
      {editing && <RuleForm rule={editing === 'new' ? null : editing} conns={conns} companyId={companyId}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function RuleForm({ rule, conns, companyId, onClose, onSaved }: {
  rule: MlMessageRule | null; conns: Array<{ id: string; name: string }>; companyId?: string; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: rule?.name || '',
    trigger: rule?.trigger || 'INVOICE_ISSUED',
    delayValue: rule ? String(rule.delayMinutes % 1440 === 0 && rule.delayMinutes ? rule.delayMinutes / 1440 : rule.delayMinutes % 60 === 0 && rule.delayMinutes ? rule.delayMinutes / 60 : rule.delayMinutes) : '0',
    delayUnit: rule ? (rule.delayMinutes % 1440 === 0 && rule.delayMinutes ? 'd' : rule.delayMinutes % 60 === 0 && rule.delayMinutes ? 'h' : 'm') : 'm',
    text: rule?.text || 'Hola {nombre}, gracias por tu compra. Tu boleta {boleta}: {link_boleta}',
    connectionId: rule?.connectionId || '',
    minTotal: rule?.minTotal != null ? String(Number(rule.minTotal)) : '',
    active: rule?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const mult = form.delayUnit === 'd' ? 1440 : form.delayUnit === 'h' ? 60 : 1;
    const data = {
      name: form.name, trigger: form.trigger as MlMessageRule['trigger'], text: form.text, active: form.active,
      delayMinutes: Math.max(0, Math.round(Number(form.delayValue) || 0) * mult),
      connectionId: form.connectionId || null, minTotal: form.minTotal !== '' ? Number(form.minTotal) : null,
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
    <Modal title={rule ? 'Editar mensaje programado' : 'Nuevo mensaje programado'} size="lg" busy={busy} onClose={onClose} onSubmit={save}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className={btnSecondary}>Cancelar</button>
          <button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </>
      )}>
      <div className="space-y-4">
        <div>
          <label className={labelCls}>Nombre</label>
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Envío de boleta" className={inputCls} />
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <div>
            <label className={labelCls}>Cuándo se envía</label>
            <select value={form.trigger} onChange={(e) => setForm((f) => ({ ...f, trigger: e.target.value as MlMessageRule['trigger'] }))} className={inputCls}>
              {Object.entries(TRIGGERS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Espera</label>
            <input type="number" min={0} value={form.delayValue} onChange={(e) => setForm((f) => ({ ...f, delayValue: e.target.value }))} className={`${inputCls} w-24`} />
          </div>
          <div>
            <label className={labelCls}>&nbsp;</label>
            <select value={form.delayUnit} onChange={(e) => setForm((f) => ({ ...f, delayUnit: e.target.value }))} className={inputCls}>
              <option value="m">minutos</option><option value="h">horas</option><option value="d">días</option>
            </select>
          </div>
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
          <p className="mt-1 text-[11px] text-gray-400">Las variables se reemplazan con los datos de cada venta.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Cuenta de Mercado Libre</label>
            <select value={form.connectionId} onChange={(e) => setForm((f) => ({ ...f, connectionId: e.target.value }))} className={inputCls}>
              <option value="">Todas las cuentas</option>
              {conns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Solo ventas desde (monto)</label>
            <input type="number" min={0} value={form.minTotal} onChange={(e) => setForm((f) => ({ ...f, minTotal: e.target.value }))} placeholder="Cualquier monto" className={inputCls} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} className="accent-blue-600" />
          Activo
        </label>
        <FormError message={error} />
      </div>
    </Modal>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import {
  api, type PaymentRequestInfo, type RecurringChargeInfo, type RecurringFrequency, type RecurringLine,
  type RecurringSubscriptionInfo, type RecurringSummary,
} from '@/lib/api';
import { useAdminCompany } from '../AdminCompanyContext';
import { confirmDialog } from '../ConfirmDialog';
import { SkeletonRows } from '@/components/Skeleton';
import { Modal, btnPrimary, btnSecondary, inputCls, labelCls, FormError } from '@/components/ui/Modal';
import { PaymentLinkModal } from '@/components/PaymentLinkModal';

type Tab = 'charges' | 'subscriptions' | 'statement';
type ClientLite = { id: string; name: string; rut?: string | null; email?: string | null };

const FREQ: Array<[RecurringFrequency, string]> = [
  ['MONTHLY', 'Mensual'], ['BIMONTHLY', 'Bimestral'], ['QUARTERLY', 'Trimestral'], ['SEMIANNUAL', 'Semestral'], ['ANNUAL', 'Anual'], ['WEEKLY', 'Semanal'],
];
const DTE: Array<[string, string]> = [['', 'Sin documento'], ['BOLETA', 'Boleta'], ['FACTURA', 'Factura'], ['FACTURA_EXENTA', 'Factura exenta']];
const PAY: Record<string, string> = { CASH: 'Efectivo', CARD: 'Tarjeta', TRANSFER: 'Transferencia', OTHER: 'Otro', FLOW: 'Flow', MERCADO_PAGO: 'Mercado Pago' };
const SUB_STATUS: Record<string, [string, string]> = {
  ACTIVE: ['Activa', 'bg-green-100 text-green-700'], PAUSED: ['En pausa', 'bg-amber-100 text-amber-800'],
  CANCELLED: ['Cancelada', 'bg-gray-100 text-gray-500'], ENDED: ['Terminada', 'bg-gray-100 text-gray-500'],
};

const fmt = (n: number | null | undefined) => `$${Math.round(Number(n || 0)).toLocaleString('es-CL')}`;
const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('es-CL', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const todayKey = () => new Date().toISOString().slice(0, 10);

function chargeBadge(c: RecurringChargeInfo) {
  if (c.status === 'PAID') return <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">Pagada</span>;
  if (c.status === 'CANCELLED') return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">Anulada</span>;
  if (c.overdue) return <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">Vencida</span>;
  return <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">Pendiente</span>;
}

export default function RecurringPage() {
  const { companyId, selectedCompanyId } = useAdminCompany();
  const [tab, setTab] = useState<Tab>('charges');
  const [summary, setSummary] = useState<RecurringSummary | null>(null);
  const [noCompany, setNoCompany] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const u = getUser();
      setNoCompany(u?.role === 'SUPER_ADMIN' && !selectedCompanyId);
      setCanManage(['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'].includes(u?.role || ''));
    });
    return () => cancelAnimationFrame(id);
  }, [selectedCompanyId]);

  useEffect(() => {
    const t = getToken();
    if (!t || noCompany) return;
    api.recurring.summary(t, companyId).then((s) => { setSummary(s); setError(''); }).catch((e) => setError(e.message));
    api.clients.list(t, companyId).then((c: ClientLite[]) => setClients(c)).catch(() => setClients([]));
  }, [companyId, noCompany, reload]);

  const refresh = () => setReload((r) => r + 1);

  return (
    <div className="max-w-6xl">
      <h1 className="ui-page-title mb-1">Cobranza recurrente</h1>
      <p className="ui-page-subtitle mb-4">Servicios que se cobran cada período: las cuotas se generan solas en su fecha de facturación, se avisan por correo con link de pago y, al pagarse, quedan como venta con su boleta o factura.</p>
      {noCompany && <p className="text-sm text-gray-500">Selecciona una empresa en la barra superior.</p>}
      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {!noCompany && (
        <>
          {summary && (
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Vencido', v: summary.overdue, cls: summary.overdue.count ? 'text-red-600' : 'text-gray-900' },
                { label: 'Vence en 7 días', v: summary.upcomingWeek, cls: 'text-blue-700' },
                { label: 'Cobrado este mes', v: summary.paidThisMonth, cls: 'text-green-700' },
                { label: 'Suscripciones activas', v: null, n: summary.activeSubscriptions, cls: 'text-gray-900' },
              ].map((k) => (
                <div key={k.label} className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                  <p className="text-xs text-gray-500">{k.label}</p>
                  <p className={`text-xl font-bold ${k.cls}`}>{k.v ? fmt(k.v.amount) : k.n}</p>
                  {k.v && <p className="text-[11px] text-gray-400">{k.v.count} cuota(s)</p>}
                </div>
              ))}
            </div>
          )}

          <div className="mb-4 flex gap-1 border-b border-gray-200">
            {([['charges', 'Cuotas'], ['subscriptions', 'Suscripciones'], ['statement', 'Estado de cuenta']] as Array<[Tab, string]>).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={`border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{l}</button>
            ))}
          </div>

          {tab === 'charges' && <ChargesTab companyId={companyId} reload={reload} onChanged={refresh} />}
          {tab === 'subscriptions' && <SubscriptionsTab companyId={companyId} clients={clients} canManage={canManage} reload={reload} onChanged={refresh} />}
          {tab === 'statement' && <StatementTab companyId={companyId} clients={clients} reload={reload} onChanged={refresh} />}
        </>
      )}
    </div>
  );
}

// ── Cuotas ─────────────────────────────────────────────────────────────

function ChargesTab({ companyId, reload, onChanged }: { companyId?: string; reload: number; onChanged: () => void }) {
  const [status, setStatus] = useState('PENDING');
  const [data, setData] = useState<{ items: RecurringChargeInfo[]; page: number; pages: number; total: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback((page = 1) => {
    const t = getToken();
    if (!t) return;
    setLoading(true);
    api.recurring.charges(t, { companyId, status: status || undefined, page })
      .then(setData).catch(() => setData({ items: [], page: 1, pages: 1, total: 0 })).finally(() => setLoading(false));
  }, [companyId, status]);

  useEffect(() => {
    const id = requestAnimationFrame(() => load(1));
    return () => cancelAnimationFrame(id);
  }, [load, reload]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {[['PENDING', 'Pendientes'], ['OVERDUE', 'Vencidas'], ['UPCOMING', 'Por vencer'], ['PAID', 'Pagadas'], ['CANCELLED', 'Anuladas'], ['', 'Todas']].map(([v, l]) => (
          <button key={v} onClick={() => setStatus(v)} className={`rounded-full px-3 py-1 text-xs font-medium ${status === v ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'}`}>{l}</button>
        ))}
      </div>
      <ChargesTable items={data?.items || []} loading={loading} onChanged={() => { load(data?.page || 1); onChanged(); }} />
      {data && data.pages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-2 text-sm">
          <button onClick={() => load(data.page - 1)} disabled={data.page <= 1} className="rounded-lg border border-gray-300 px-3 py-1.5 disabled:opacity-40">Anterior</button>
          <span className="text-gray-500">{data.page} / {data.pages}</span>
          <button onClick={() => load(data.page + 1)} disabled={data.page >= data.pages} className="rounded-lg border border-gray-300 px-3 py-1.5 disabled:opacity-40">Siguiente</button>
        </div>
      )}
    </div>
  );
}

function ChargesTable({ items, loading, onChanged, hideClient }: { items: RecurringChargeInfo[]; loading?: boolean; onChanged: () => void; hideClient?: boolean }) {
  const [paying, setPaying] = useState<RecurringChargeInfo | null>(null);
  const [linkReq, setLinkReq] = useState<PaymentRequestInfo | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const t = () => getToken()!;

  async function act(c: RecurringChargeInfo, kind: 'remind' | 'cancel' | 'link' | 'retry') {
    setMsg(null);
    if (kind === 'cancel') {
      const reason = window.prompt('Motivo de la anulación (opcional):');
      if (reason === null) return;
      setBusy(c.id);
      try { await api.recurring.cancel(c.id, reason, t()); onChanged(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(''); }
      return;
    }
    setBusy(c.id);
    try {
      if (kind === 'remind') { await api.recurring.remind(c.id, t()); setMsg({ ok: true, text: `Aviso enviado a ${c.client?.email}` }); onChanged(); }
      if (kind === 'link') setLinkReq(await api.recurring.link(c.id, c.subscription?.paymentProvider || undefined, t()));
      if (kind === 'retry') { const r = await api.recurring.retry(c.id, t()); setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: 'Venta y documento registrados' }); onChanged(); }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      {msg && <div className={`mb-3 rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{msg.text}</div>}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
            <tr>
              {!hideClient && <th className="px-3 py-2 text-left font-medium">Cliente</th>}
              <th className="px-3 py-2 text-left font-medium">Servicio</th>
              <th className="px-3 py-2 text-left font-medium">Facturación</th>
              <th className="px-3 py-2 text-left font-medium">Vence</th>
              <th className="px-3 py-2 text-right font-medium">Monto</th>
              <th className="px-3 py-2 text-left font-medium">Estado</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && <SkeletonRows cols={hideClient ? 6 : 7} />}
            {!loading && items.map((c) => (
              <tr key={c.id} className="align-top">
                {!hideClient && <td className="px-3 py-2"><p className="font-medium text-gray-900">{c.client?.name}</p>{c.client?.email && <p className="text-[11px] text-gray-400">{c.client.email}</p>}</td>}
                <td className="px-3 py-2"><p className="text-gray-800">{c.subscription?.name}</p><p className="text-[11px] text-gray-400">Cuota {c.number}</p></td>
                <td className="px-3 py-2 text-xs text-gray-600">{fmtDate(c.issueDate)}</td>
                <td className={`px-3 py-2 text-xs ${c.overdue ? 'font-semibold text-red-600' : 'text-gray-600'}`}>{fmtDate(c.dueDate)}</td>
                <td className="px-3 py-2 text-right font-semibold text-gray-900">{fmt(c.amount)}</td>
                <td className="px-3 py-2">
                  {chargeBadge(c)}
                  {c.status === 'PAID' && <p className="mt-1 text-[11px] text-gray-500">{fmtDate(c.paidAt)} · {PAY[c.paymentMethod || ''] || c.paymentMethod}</p>}
                  {c.status === 'PENDING' && c.remindersSent > 0 && <p className="mt-1 text-[11px] text-gray-400">{c.remindersSent} aviso(s)</p>}
                  {c.error && <p className="mt-1 max-w-[220px] text-[11px] text-amber-700">{c.error}</p>}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-xs font-medium">
                    {c.status === 'PENDING' && (
                      <>
                        <button onClick={() => setPaying(c)} disabled={busy === c.id} className="text-green-600 hover:text-green-800">Registrar pago</button>
                        {c.subscription?.paymentProvider && <button onClick={() => act(c, 'link')} disabled={busy === c.id} className="text-blue-600 hover:text-blue-800">Link de pago</button>}
                        {c.client?.email && <button onClick={() => act(c, 'remind')} disabled={busy === c.id} className="text-gray-600 hover:text-gray-800">Enviar aviso</button>}
                        <button onClick={() => act(c, 'cancel')} disabled={busy === c.id} className="text-red-500 hover:text-red-700">Anular</button>
                      </>
                    )}
                    {c.status === 'PAID' && c.error && <button onClick={() => act(c, 'retry')} disabled={busy === c.id} className="text-amber-700 hover:text-amber-900">Reintentar</button>}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">Sin cuotas.</td></tr>}
          </tbody>
        </table>
      </div>
      {paying && <PayModal charge={paying} onClose={() => setPaying(null)} onPaid={(r) => { setPaying(null); setMsg(r.error ? { ok: false, text: `Pago registrado, pero: ${r.error}` } : { ok: true, text: 'Pago registrado' }); onChanged(); }} />}
      {linkReq && <PaymentLinkModal request={linkReq} onClose={() => { setLinkReq(null); onChanged(); }} onPaid={() => onChanged()} />}
    </>
  );
}

function PayModal({ charge, onClose, onPaid }: { charge: RecurringChargeInfo; onClose: () => void; onPaid: (r: RecurringChargeInfo) => void }) {
  const [method, setMethod] = useState('TRANSFER');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { onPaid(await api.recurring.pay(charge.id, { method, reference }, getToken()!)); } catch (err) { setError((err as Error).message); setBusy(false); }
  }
  return (
    <Modal title={`Registrar pago · ${charge.subscription?.name}`} busy={busy} onClose={onClose} onSubmit={save}
      footer={<><button type="button" onClick={onClose} className={btnSecondary}>Cancelar</button><button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Registrando…' : `Registrar ${fmt(charge.amount)}`}</button></>}>
      <div className="space-y-3">
        <p className="text-sm text-gray-600">{charge.client?.name} · cuota {charge.number} · {fmt(charge.amount)}. Se registra la venta y, si la suscripción lo indica, se emite la boleta o factura.</p>
        <div><label className={labelCls}>Medio de pago</label>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>
            {['TRANSFER', 'CASH', 'CARD', 'OTHER'].map((m) => <option key={m} value={m}>{PAY[m]}</option>)}
          </select>
        </div>
        <div><label className={labelCls}>Referencia (opcional)</label><input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="N° de transferencia, voucher…" className={inputCls} /></div>
        <FormError message={error} />
      </div>
    </Modal>
  );
}

// ── Suscripciones ──────────────────────────────────────────────────────

function SubscriptionsTab({ companyId, clients, canManage, reload, onChanged }: { companyId?: string; clients: ClientLite[]; canManage: boolean; reload: number; onChanged: () => void }) {
  const [items, setItems] = useState<RecurringSubscriptionInfo[] | null>(null);
  const [status, setStatus] = useState('ACTIVE');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<RecurringSubscriptionInfo | 'new' | null>(null);
  const [detail, setDetail] = useState<RecurringSubscriptionInfo | null>(null);

  const load = useCallback(() => {
    const t = getToken();
    if (!t) return;
    api.recurring.subscriptions(t, { companyId, status: status || undefined, search: search || undefined }).then(setItems).catch(() => setItems([]));
  }, [companyId, status, search]);

  useEffect(() => {
    const id = requestAnimationFrame(load);
    return () => cancelAnimationFrame(id);
  }, [load, reload]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm">
          <option value="ACTIVE">Activas</option><option value="PAUSED">En pausa</option><option value="ENDED">Terminadas</option><option value="CANCELLED">Canceladas</option><option value="">Todas</option>
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar servicio o cliente…" className="min-w-[200px] flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        {canManage && <button onClick={() => setEditing('new')} className={btnPrimary}>+ Nueva suscripción</button>}
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Servicio</th>
              <th className="px-3 py-2 text-left font-medium">Cliente</th>
              <th className="px-3 py-2 text-left font-medium">Frecuencia</th>
              <th className="px-3 py-2 text-left font-medium">Próxima facturación</th>
              <th className="px-3 py-2 text-right font-medium">Monto</th>
              <th className="px-3 py-2 text-left font-medium">Deuda</th>
              <th className="px-3 py-2 text-left font-medium">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items === null && <SkeletonRows cols={7} />}
            {items?.map((s) => (
              <tr key={s.id} onClick={() => setDetail(s)} className="cursor-pointer hover:bg-gray-50">
                <td className="px-3 py-2"><p className="font-medium text-gray-900">{s.name}</p>{s.dteType && <p className="text-[11px] text-gray-400">{DTE.find(([v]) => v === s.dteType)?.[1]} al pagar</p>}</td>
                <td className="px-3 py-2 text-gray-700">{s.client?.name}</td>
                <td className="px-3 py-2 text-xs text-gray-600">{s.frequencyLabel} · día {s.billingDay}</td>
                <td className="px-3 py-2 text-xs text-gray-600">{s.status === 'ACTIVE' ? fmtDate(s.nextBillingDate) : '—'}</td>
                <td className="px-3 py-2 text-right font-semibold">{fmt(s.amount)}</td>
                <td className="px-3 py-2 text-xs">{s.pendingCount ? <span className={s.overdueCount ? 'font-semibold text-red-600' : 'text-gray-700'}>{fmt(s.pendingAmount)} ({s.pendingCount})</span> : <span className="text-gray-400">Al día</span>}</td>
                <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${SUB_STATUS[s.status][1]}`}>{SUB_STATUS[s.status][0]}</span></td>
              </tr>
            ))}
            {items?.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">Sin suscripciones.</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && (
        <SubscriptionModal companyId={companyId} clients={clients} sub={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setDetail(null); onChanged(); load(); }} />
      )}
      {detail && !editing && (
        <SubscriptionDetail subId={detail.id} canManage={canManage} onClose={() => setDetail(null)}
          onEdit={(s) => setEditing(s)} onChanged={() => { onChanged(); load(); }} />
      )}
    </div>
  );
}

function SubscriptionDetail({ subId, canManage, onClose, onEdit, onChanged }: { subId: string; canManage: boolean; onClose: () => void; onEdit: (s: RecurringSubscriptionInfo) => void; onChanged: () => void }) {
  const [sub, setSub] = useState<RecurringSubscriptionInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    api.recurring.subscription(subId, getToken()!).then(setSub).catch((e) => setError(e.message));
  }, [subId]);
  useEffect(() => {
    const id = requestAnimationFrame(load);
    return () => cancelAnimationFrame(id);
  }, [load]);

  async function run(fn: () => Promise<RecurringSubscriptionInfo>, confirm?: string) {
    if (confirm && !(await confirmDialog(confirm))) return;
    setBusy(true);
    setError('');
    try { setSub(await fn()); onChanged(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Modal title={sub?.name || 'Suscripción'} subtitle={sub?.client?.name} size="xl" busy={busy} onClose={onClose}
      footer={sub && canManage && sub.status !== 'CANCELLED' && sub.status !== 'ENDED' ? (
        <>
          <button type="button" onClick={() => run(() => api.recurring.setStatus(sub.id, 'CANCELLED', getToken()!), '¿Cancelar la suscripción? No se generarán más cuotas (las pendientes siguen vigentes).')} className="mr-auto rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">Cancelar suscripción</button>
          {sub.status === 'ACTIVE'
            ? <button type="button" onClick={() => run(() => api.recurring.setStatus(sub.id, 'PAUSED', getToken()!))} className={btnSecondary}>Pausar</button>
            : <button type="button" onClick={() => run(() => api.recurring.setStatus(sub.id, 'ACTIVE', getToken()!))} className={btnSecondary}>Reanudar</button>}
          {sub.status === 'ACTIVE' && <button type="button" onClick={() => run(() => api.recurring.generate(sub.id, getToken()!), '¿Generar ahora la próxima cuota?')} className={btnSecondary}>Generar próxima cuota</button>}
          <button type="button" onClick={() => onEdit(sub)} className={btnPrimary}>Editar</button>
        </>
      ) : undefined}>
      {!sub ? <p className="text-sm text-gray-400">Cargando…</p> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><p className="text-xs text-gray-500">Monto</p><p className="font-semibold">{fmt(sub.amount)}</p></div>
            <div><p className="text-xs text-gray-500">Frecuencia</p><p>{sub.frequencyLabel} · día {sub.billingDay}</p></div>
            <div><p className="text-xs text-gray-500">Próxima facturación</p><p>{sub.status === 'ACTIVE' ? fmtDate(sub.nextBillingDate) : SUB_STATUS[sub.status][0]}</p></div>
            <div><p className="text-xs text-gray-500">Paga dentro de</p><p>{sub.dueDays} día(s)</p></div>
            <div><p className="text-xs text-gray-500">Documento</p><p>{DTE.find(([v]) => v === (sub.dteType || ''))?.[1]}</p></div>
            <div><p className="text-xs text-gray-500">Link de pago</p><p>{sub.paymentProvider ? PAY[sub.paymentProvider] : 'Sin link'}</p></div>
            <div><p className="text-xs text-gray-500">Avisos por correo</p><p>{sub.sendReminders ? `${sub.remindBeforeDays} día(s) antes · cada ${sub.remindEveryDays} día(s) vencida` : 'No'}</p></div>
            <div><p className="text-xs text-gray-500">Vigencia</p><p>{fmtDate(sub.startDate)}{sub.endDate ? ` → ${fmtDate(sub.endDate)}` : ' → sin término'}</p></div>
          </div>
          {sub.description && <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{sub.description}</p>}
          <ul className="text-sm text-gray-700">
            {sub.lines.map((l, i) => <li key={i}>{l.quantity} × {l.description} · {fmt(l.unitPrice)}</li>)}
          </ul>
          <FormError message={error} />
          <h3 className="text-sm font-semibold text-gray-800">Cuotas</h3>
          <ChargesTable items={sub.charges || []} hideClient onChanged={() => { load(); onChanged(); }} />
        </div>
      )}
    </Modal>
  );
}

function SubscriptionModal({ companyId, clients, sub, onClose, onSaved }: { companyId?: string; clients: ClientLite[]; sub: RecurringSubscriptionInfo | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    clientId: sub?.client?.id || '', name: sub?.name || '', description: sub?.description || '',
    frequency: (sub?.frequency || 'MONTHLY') as RecurringFrequency,
    startDate: sub ? sub.startDate.slice(0, 10) : todayKey(), billingDay: String(sub?.billingDay ?? Math.min(28, new Date().getDate())),
    endDate: sub?.endDate ? sub.endDate.slice(0, 10) : '', dueDays: String(sub?.dueDays ?? 5),
    dteType: sub?.dteType || '', billingConnectionId: sub?.billingConnectionId || '', paymentProvider: sub?.paymentProvider || '',
    sendReminders: sub?.sendReminders ?? true, remindBeforeDays: String(sub?.remindBeforeDays ?? 3), remindEveryDays: String(sub?.remindEveryDays ?? 3), notes: sub?.notes || '',
  });
  const [lines, setLines] = useState<Array<{ description: string; quantity: string; unitPrice: string; productId?: string | null }>>(
    sub?.lines?.length ? sub.lines.map((l: RecurringLine) => ({ description: l.description, quantity: String(l.quantity), unitPrice: String(l.unitPrice), productId: l.productId })) : [{ description: '', quantity: '1', unitPrice: '' }],
  );
  const [billingConns, setBillingConns] = useState<Array<{ id: string; name: string; provider: string }>>([]);
  const [providers, setProviders] = useState<Array<{ provider: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = getToken();
    if (!t) return;
    api.billing.connections.list(t, companyId ? { companyId } : undefined).then((c: Array<{ id: string; name: string; provider: string }>) => setBillingConns(c)).catch(() => setBillingConns([]));
    api.payments.available(t, companyId).then(setProviders).catch(() => setProviders([]));
  }, [companyId]);

  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const payload = {
      companyId, ...form,
      billingDay: Number(form.billingDay) || 1, dueDays: Number(form.dueDays) || 0,
      remindBeforeDays: Number(form.remindBeforeDays) || 0, remindEveryDays: Number(form.remindEveryDays) || 1,
      endDate: form.endDate || null, dteType: form.dteType || null, billingConnectionId: form.billingConnectionId || null, paymentProvider: form.paymentProvider || null,
      lines: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), productId: l.productId || null })),
    };
    try {
      if (sub) await api.recurring.updateSubscription(sub.id, payload, getToken()!);
      else await api.recurring.createSubscription(payload, getToken()!);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={sub ? `Editar «${sub.name}»` : 'Nueva suscripción'} size="xl" busy={busy} onClose={onClose} onSubmit={save}
      footer={<><button type="button" onClick={onClose} className={btnSecondary}>Cancelar</button><button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Guardando…' : 'Guardar'}</button></>}>
      <div className="space-y-5">
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Cliente</label>
            <select value={form.clientId} onChange={set('clientId')} required disabled={!!sub} className={inputCls}>
              <option value="">Elegir cliente…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.rut ? ` · ${c.rut}` : ''}</option>)}
            </select>
            {clients.length === 0 && <p className="mt-0.5 text-[11px] text-gray-400">Crea el cliente en Registro de Clientes.</p>}
          </div>
          <div><label className={labelCls}>Nombre del servicio</label><input value={form.name} onChange={set('name')} required placeholder="Ej.: Mantención mensual, Arriendo de bodega" className={inputCls} /></div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Descripción (va en la boleta/factura y en el aviso)</label>
            <textarea value={form.description} onChange={set('description')} rows={2} placeholder="Ej.: Servicio de mantención preventiva de equipos — período mensual" className={`${inputCls} resize-none`} />
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">Detalle · total {fmt(total)}</h3>
            <button type="button" onClick={() => setLines((l) => [...l, { description: '', quantity: '1', unitPrice: '' }])} className="text-xs font-semibold text-blue-600 hover:underline">+ Agregar línea</button>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <input value={l.description} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} placeholder="Descripción" className={`${inputCls} col-span-6`} />
                <input type="number" min="0.01" step="any" value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} placeholder="Cant." className={`${inputCls} col-span-2`} />
                <input type="number" min="1" value={l.unitPrice} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)))} placeholder="Precio" className={`${inputCls} col-span-3`} />
                <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} disabled={lines.length === 1} className="col-span-1 text-red-400 hover:text-red-600 disabled:opacity-30" aria-label="Quitar línea">✕</button>
              </div>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><label className={labelCls}>Frecuencia</label>
            <select value={form.frequency} onChange={set('frequency')} className={inputCls}>{FREQ.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </div>
          <div><label className={labelCls}>Fecha de facturación (primera)</label><input type="date" value={form.startDate} onChange={set('startDate')} required className={inputCls} /></div>
          {form.frequency !== 'WEEKLY' && (
            <div><label className={labelCls}>Día de facturación</label><input type="number" min="1" max="28" value={form.billingDay} onChange={set('billingDay')} className={inputCls} /></div>
          )}
          <div><label className={labelCls}>Días para pagar</label><input type="number" min="0" max="90" value={form.dueDays} onChange={set('dueDays')} className={inputCls} /></div>
          <div><label className={labelCls}>Fecha de término (opcional)</label><input type="date" value={form.endDate} onChange={set('endDate')} className={inputCls} /></div>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><label className={labelCls}>Documento al pagar</label>
            <select value={form.dteType} onChange={set('dteType')} className={inputCls}>{DTE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </div>
          {form.dteType && (
            <div><label className={labelCls}>Conexión de facturación</label>
              <select value={form.billingConnectionId} onChange={set('billingConnectionId')} className={inputCls}>
                <option value="">Elegir…</option>
                {billingConns.map((c) => <option key={c.id} value={c.id}>{c.name || c.provider}</option>)}
              </select>
            </div>
          )}
          <div><label className={labelCls}>Link de pago en los avisos</label>
            <select value={form.paymentProvider} onChange={set('paymentProvider')} className={inputCls}>
              <option value="">Sin link</option>
              {providers.map((p) => <option key={p.provider} value={p.provider}>{p.name}</option>)}
            </select>
          </div>
        </section>

        <section className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.sendReminders} onChange={(e) => setForm((f) => ({ ...f, sendReminders: e.target.checked }))} className="accent-blue-600" />
            Enviar avisos por correo al cliente
          </label>
          {form.sendReminders && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
              <input type="number" min="0" max="30" value={form.remindBeforeDays} onChange={set('remindBeforeDays')} className="w-16 rounded-lg border border-gray-300 px-2 py-1" />
              días antes del vencimiento y, si vence, cada
              <input type="number" min="1" max="30" value={form.remindEveryDays} onChange={set('remindEveryDays')} className="w-16 rounded-lg border border-gray-300 px-2 py-1" />
              días (hasta 6 avisos).
            </div>
          )}
        </section>

        <div><label className={labelCls}>Notas internas</label><textarea value={form.notes} onChange={set('notes')} rows={2} className={`${inputCls} resize-none`} /></div>
        <FormError message={error} />
      </div>
    </Modal>
  );
}

// ── Estado de cuenta ───────────────────────────────────────────────────

function StatementTab({ companyId, clients, reload, onChanged }: { companyId?: string; clients: ClientLite[]; reload: number; onChanged: () => void }) {
  const [clientId, setClientId] = useState('');
  const [data, setData] = useState<Awaited<ReturnType<typeof api.recurring.statement>> | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    if (!clientId) return;
    api.recurring.statement(clientId, getToken()!, companyId).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message));
  }, [clientId, companyId]);
  useEffect(() => {
    const id = requestAnimationFrame(load);
    return () => cancelAnimationFrame(id);
  }, [load, reload]);

  return (
    <div className="space-y-4">
      <select value={clientId} onChange={(e) => { setClientId(e.target.value); setData(null); }} className="w-full max-w-md rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
        <option value="">Elegir cliente…</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.rut ? ` · ${c.rut}` : ''}</option>)}
      </select>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {data && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3"><p className="text-xs text-gray-500">Deuda</p><p className="text-xl font-bold text-gray-900">{fmt(data.totals.debt)}</p></div>
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3"><p className="text-xs text-gray-500">Vencido</p><p className={`text-xl font-bold ${data.totals.overdue ? 'text-red-600' : 'text-gray-900'}`}>{fmt(data.totals.overdue)}</p></div>
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3"><p className="text-xs text-gray-500">Pagado (histórico)</p><p className="text-xl font-bold text-green-700">{fmt(data.totals.paid)}</p></div>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-800">Suscripciones</h3>
            <ul className="space-y-1 text-sm">
              {data.subscriptions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2">
                  <span><span className="font-medium">{s.name}</span> · {s.frequencyLabel} · {fmt(s.amount)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${SUB_STATUS[s.status][1]}`}>{SUB_STATUS[s.status][0]}</span>
                </li>
              ))}
              {data.subscriptions.length === 0 && <li className="text-gray-400">Sin suscripciones.</li>}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-800">Cuotas y pagos</h3>
            <ChargesTable items={data.charges} hideClient onChanged={() => { load(); onChanged(); }} />
          </div>
        </>
      )}
    </div>
  );
}

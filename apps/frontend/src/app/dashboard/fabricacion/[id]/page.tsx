'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getToken, getUser } from '@/lib/auth';
import { api, type PaymentProviderKey, type PaymentRequestInfo, type ProductionOrderDetail, type ProductionOrderStage, type SpecField } from '@/lib/api';
import { useAdminCompany } from '../../AdminCompanyContext';
import { confirmDialog } from '../../ConfirmDialog';
import { SkeletonDetail } from '@/components/Skeleton';
import { Modal, btnPrimary, btnSecondary, inputCls, labelCls, FormError } from '@/components/ui/Modal';
import { PaymentLinkModal } from '@/components/PaymentLinkModal';
import {
  Badge, KIND_CLS, ORDER_STATUS_CLS, ORDER_STATUS_LABEL, PRIORITY_LABEL, REPAIR_FIELDS, STAGE_STATUS_CLS, STAGE_STATUS_LABEL,
  SpecInputs, fmtCLP, fmtDate, fmtDateTime, ofNumber, trackingUrl, waPhone,
} from '../shared';

const PAY_LABELS: Record<string, string> = { CASH: 'Efectivo', CARD: 'Tarjeta', TRANSFER: 'Transferencia', OTHER: 'Otro', FLOW: 'Flow', MERCADO_PAGO: 'Mercado Pago', MIXED: 'Mixto' };

type Tab = 'stages' | 'materials' | 'time' | 'files' | 'log';

export default function ProductionOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { companyId } = useAdminCompany();
  const [order, setOrder] = useState<ProductionOrderDetail | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [tab, setTab] = useState<Tab>('stages');
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([]);
  const [editSpecs, setEditSpecs] = useState(false);
  const [payModal, setPayModal] = useState(false);
  const [payReq, setPayReq] = useState<PaymentRequestInfo | null>(null);
  const [online, setOnline] = useState<Array<{ provider: PaymentProviderKey; name: string }>>([]);
  const [copied, setCopied] = useState(false);
  const [canConfig, setCanConfig] = useState(false);

  const load = useCallback(() => {
    const t = getToken();
    if (!t) return;
    api.production.get(id, t).then((o) => { setOrder(o); setError(''); }).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    const t = getToken();
    const id2 = requestAnimationFrame(() => {
      load();
      setCanConfig(['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'].includes(getUser()?.role || ''));
    });
    if (t) {
      // Super Admin recibe todos los usuarios: se dejan los de la empresa elegida.
      api.users.list(t).then((u: Array<{ id: string; name: string; active?: boolean; companyId?: string | null }>) => setUsers((u || []).filter((x) => x.active !== false && (!companyId || x.companyId === companyId)).map((x) => ({ id: x.id, name: x.name })))).catch(() => {});
      api.payments.available(t, companyId).then(setOnline).catch(() => setOnline([]));
    }
    return () => cancelAnimationFrame(id2);
  }, [load, companyId]);

  async function run(key: string, fn: () => Promise<ProductionOrderDetail | void>, ok?: string) {
    setBusy(key);
    setNotice(null);
    try {
      const r = await fn();
      if (r) setOrder(r);
      if (ok) setNotice({ ok: true, text: ok });
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy('');
    }
  }

  if (error) return <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
  if (!order) return <SkeletonDetail />;

  const t = () => getToken()!;
  const open = !['DONE', 'CANCELLED'].includes(order.status);
  const link = trackingUrl(order.trackingToken);
  const waText = encodeURIComponent(`Hola${order.customerName ? ` ${order.customerName}` : ''}, puedes seguir el avance de tu pedido ${ofNumber(order.number)} (${order.productName}) aquí: ${link}`);
  const specFields: SpecField[] = order.product?.specFields?.length
    ? order.product.specFields
    : Object.keys(order.specs || {}).map((k) => ({ key: k, label: k }));

  async function copyLink() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* sin portapapeles */ }
  }

  async function action(a: 'complete' | 'cancel' | 'hold' | 'resume') {
    let body: Record<string, unknown> = {};
    if (a === 'complete' && !(await confirmDialog('¿Terminar la orden? Las etapas pendientes quedan listas y se descuentan los materiales que falten.'))) return;
    if (a === 'cancel') {
      const reason = window.prompt('Motivo de la anulación (opcional):');
      if (reason === null) return;
      body = { reason };
    }
    if (a === 'hold') {
      const reason = window.prompt('Motivo de la pausa (opcional):');
      if (reason === null) return;
      body = { reason };
    }
    await run(a, () => api.production.action(id, a, t(), body));
  }

  async function warranty() {
    const reason = window.prompt('Motivo de la garantía:');
    if (!reason?.trim()) return;
    setBusy('warranty');
    try {
      const r = await api.production.warranty(id, reason, t());
      router.push(`/dashboard/fabricacion/${r.id}`);
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
      setBusy('');
    }
  }

  const tabs: Array<[Tab, string]> = [
    ['stages', `Etapas (${order.stages.length})`],
    ['materials', `Materiales (${order.materials.length})`],
    ['time', `Horas (${order.timeEntries.length})`],
    ['files', `Fotos y archivos (${order.attachments.length})`],
    ['log', 'Bitácora'],
  ];

  return (
    <div className="max-w-6xl">
      <Link href="/dashboard/fabricacion" className="text-xs text-gray-500 hover:text-gray-700">← Fabricación</Link>

      {/* Encabezado */}
      <div className="mt-2 mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="ui-page-title">{ofNumber(order.number)}</h1>
            <Badge cls={ORDER_STATUS_CLS[order.status]}>{ORDER_STATUS_LABEL[order.status]}</Badge>
            <Badge cls={KIND_CLS[order.kind]}>{order.kindLabel}</Badge>
            {order.priority > 0 && <Badge cls={order.priority === 2 ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}>{PRIORITY_LABEL[order.priority]}</Badge>}
            {order.overdue && <Badge cls="bg-red-100 text-red-700">Atrasada</Badge>}
          </div>
          <p className="mt-1 text-lg font-semibold text-gray-900">{order.productName}{order.quantity > 1 && <span className="font-normal text-gray-500"> × {order.quantity}</span>}</p>
          <p className="text-sm text-gray-500">
            {order.customerName || (order.kind === 'FOR_STOCK' ? 'Lote para stock' : 'Sin cliente')}
            {order.customerPhone && ` · ${order.customerPhone}`}
            {order.process && ` · Proceso: ${order.process.name}`}
          </p>
          {order.reopenedFrom && (
            <p className="mt-1 text-xs text-purple-700">Garantía de <Link href={`/dashboard/fabricacion/${order.reopenedFrom.id}`} className="underline">{ofNumber(order.reopenedFrom.number)}</Link>{order.warrantyReason && `: ${order.warrantyReason}`}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {open && order.status !== 'ON_HOLD' && <button onClick={() => action('complete')} disabled={!!busy} className="rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">Terminar orden</button>}
          {open && order.status !== 'ON_HOLD' && <button onClick={() => action('hold')} disabled={!!busy} className={btnSecondary}>Pausar</button>}
          {order.status === 'ON_HOLD' && <button onClick={() => action('resume')} disabled={!!busy} className={btnPrimary}>Reanudar</button>}
          {open && <button onClick={() => action('cancel')} disabled={!!busy} className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">Anular</button>}
          {order.status === 'DONE' && order.kind !== 'FOR_STOCK' && <button onClick={warranty} disabled={!!busy} className={btnSecondary}>Abrir garantía</button>}
        </div>
      </div>

      {notice && <div className={`mb-4 rounded-lg px-4 py-2.5 text-sm ${notice.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{notice.text}</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Columna principal */}
        <div className="space-y-4 lg:col-span-2">
          <div className="flex gap-1 overflow-x-auto border-b border-gray-200">
            {tabs.map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{l}</button>
            ))}
          </div>

          {tab === 'stages' && (
            <StagesTab order={order} users={users} busy={busy} run={run} />
          )}
          {tab === 'materials' && <MaterialsTab order={order} busy={busy} run={run} companyId={companyId} />}
          {tab === 'time' && <TimeTab order={order} users={users} busy={busy} run={run} />}
          {tab === 'files' && <FilesTab order={order} busy={busy} run={run} />}
          {tab === 'log' && <LogTab order={order} busy={busy} run={run} />}
        </div>

        {/* Columna lateral */}
        <div className="space-y-4">
          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <h2 className="ui-section-title mb-3">Resumen</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-2"><dt className="text-gray-500">Avance</dt><dd className="font-medium">{order.stagesCount ? `${order.progress}%` : '—'}</dd></div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-gray-500">Entrega</dt>
                <dd>
                  <input type="date" disabled={!open} value={order.dueDate ? order.dueDate.slice(0, 10) : ''}
                    onChange={(e) => run('due', () => api.production.update(id, { dueDate: e.target.value || null }, t()))}
                    className={`rounded border border-gray-200 px-1.5 py-0.5 text-sm ${order.overdue ? 'text-red-600' : ''}`} />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-gray-500">Prioridad</dt>
                <dd>
                  <select disabled={!open} value={order.priority} onChange={(e) => run('prio', () => api.production.update(id, { priority: Number(e.target.value) }, t()))} className="rounded border border-gray-200 px-1.5 py-0.5 text-sm">
                    {PRIORITY_LABEL.map((l, i) => <option key={l} value={i}>{l}</option>)}
                  </select>
                </dd>
              </div>
              <div className="flex justify-between gap-2"><dt className="text-gray-500">Creada</dt><dd>{fmtDateTime(order.createdAt)}</dd></div>
              {order.completedAt && <div className="flex justify-between gap-2"><dt className="text-gray-500">Terminada</dt><dd>{fmtDateTime(order.completedAt)}</dd></div>}
              {order.sale && (
                <div className="flex justify-between gap-2"><dt className="text-gray-500">Venta</dt><dd><Link href="/dashboard/sales" className="text-blue-600 hover:underline">N° {order.sale.saleNumber}</Link></dd></div>
              )}
              {order.sale?.orderId && (
                <div className="flex justify-between gap-2"><dt className="text-gray-500">Despacho</dt><dd><Link href={`/dashboard/orders/${order.sale.orderId}`} className="text-blue-600 hover:underline">Ver orden</Link></dd></div>
              )}
            </dl>
            {order.kind !== 'FOR_STOCK' && (
              <div className="mt-4 space-y-2 border-t border-gray-100 pt-3">
                <p className="text-xs font-semibold text-gray-600">Seguimiento del cliente</p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={copyLink} className={btnSecondary}>{copied ? '¡Copiado!' : 'Copiar link'}</button>
                  <a href={`https://wa.me/${waPhone(order.customerPhone)}?text=${waText}`} target="_blank" rel="noopener noreferrer"
                    className="rounded-lg bg-[#25D366] px-3 py-2 text-center text-sm font-semibold text-white hover:bg-[#1ebe5b]">WhatsApp</a>
                </div>
                <a href={link} target="_blank" rel="noopener noreferrer" className="block text-center text-xs text-blue-600 hover:underline">Ver lo que ve el cliente</a>
              </div>
            )}
          </section>

          {(specFields.length > 0 || order.repairInfo) && (
            <section className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="ui-section-title">{order.repairInfo ? 'Especificaciones y equipo' : 'Especificaciones'}</h2>
                {open && <button onClick={() => setEditSpecs(true)} className="text-xs font-medium text-blue-600 hover:underline">Editar</button>}
              </div>
              <dl className="space-y-1.5 text-sm">
                {specFields.map((f) => (
                  <div key={f.key}><dt className="text-xs text-gray-500">{f.label}</dt><dd className="whitespace-pre-wrap text-gray-900">{order.specs?.[f.key] || '—'}</dd></div>
                ))}
                {order.repairInfo && REPAIR_FIELDS.filter((f) => order.repairInfo?.[f.key]).map((f) => (
                  <div key={f.key}><dt className="text-xs text-gray-500">{f.label}</dt><dd className="whitespace-pre-wrap text-gray-900">{order.repairInfo?.[f.key]}</dd></div>
                ))}
              </dl>
              {order.notes && <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 whitespace-pre-wrap">{order.notes}</p>}
            </section>
          )}

          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <h2 className="ui-section-title mb-3">Costos</h2>
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-gray-400"><th className="text-left font-normal" /><th className="text-right font-normal">Estimado</th><th className="text-right font-normal">Real</th></tr></thead>
              <tbody>
                <tr><td className="py-1 text-gray-600">Materiales</td><td className="text-right text-gray-500">{fmtCLP(order.costs.estimatedMaterials)}</td><td className="text-right font-medium">{fmtCLP(order.costs.materials)}</td></tr>
                <tr><td className="py-1 text-gray-600">Mano de obra</td><td className="text-right text-gray-500">{fmtCLP(order.costs.estimatedLabor)}</td><td className="text-right font-medium">{fmtCLP(order.costs.labor)}</td></tr>
                <tr className="border-t border-gray-100"><td className="py-1 font-semibold">Total</td><td className="text-right text-gray-500">{fmtCLP(order.costs.estimatedTotal)}</td><td className="text-right font-semibold">{fmtCLP(order.costs.total)}</td></tr>
              </tbody>
            </table>
            {order.costs.salePrice != null && (
              <div className="mt-3 space-y-1 border-t border-gray-100 pt-3 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Precio de venta</span><span>{fmtCLP(order.costs.salePrice)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Margen</span><span className={`font-semibold ${Number(order.costs.margin) < 0 ? 'text-red-600' : 'text-green-700'}`}>{fmtCLP(order.costs.margin)}</span></div>
              </div>
            )}
            {order.kind === 'FOR_STOCK' && order.quantity > 0 && (
              <p className="mt-2 text-xs text-gray-500">Costo por unidad: {fmtCLP(order.costs.total / order.quantity)}</p>
            )}
          </section>

          {order.sale && (
            <section className="rounded-2xl border border-gray-200 bg-white p-4">
              <h2 className="ui-section-title mb-3">Cobro</h2>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Total de la venta</span><span>{fmtCLP(order.sale.total)}</span></div>
                {order.sale.payments.map((p) => (
                  <div key={p.id} className="flex justify-between text-xs text-gray-500">
                    <span>{p.isBalance ? 'Pago de saldo' : 'Pago'} · {PAY_LABELS[p.method] || p.method} · {fmtDate(p.createdAt)}</span><span>{fmtCLP(p.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-gray-100 pt-1">
                  <span className="font-semibold">Saldo por cobrar</span>
                  <span className={`font-semibold ${order.sale.balanceDue > 0 ? 'text-amber-700' : 'text-green-700'}`}>{order.sale.balanceDue > 0 ? fmtCLP(order.sale.balanceDue) : 'Pagado'}</span>
                </div>
              </div>
              {order.sale.balanceDue > 0 && (
                <div className="mt-3 grid grid-cols-1 gap-2">
                  <button onClick={() => setPayModal(true)} className={btnPrimary}>Registrar pago</button>
                  {online.map((o) => (
                    <button key={o.provider} disabled={busy === `link-${o.provider}`}
                      onClick={async () => {
                        setBusy(`link-${o.provider}`);
                        try { setPayReq(await api.payments.createForSaleBalance(order.sale!.id, { provider: o.provider }, t())); }
                        catch (e) { setNotice({ ok: false, text: (e as Error).message }); }
                        finally { setBusy(''); }
                      }}
                      className={btnSecondary}>
                      Link de pago {o.name}
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {order.warrantyOrders.length > 0 && (
            <section className="rounded-2xl border border-gray-200 bg-white p-4">
              <h2 className="ui-section-title mb-2">Garantías</h2>
              {order.warrantyOrders.map((w) => (
                <Link key={w.id} href={`/dashboard/fabricacion/${w.id}`} className="block text-sm text-blue-600 hover:underline">{ofNumber(w.number)} · {ORDER_STATUS_LABEL[w.status]}{w.warrantyReason && ` · ${w.warrantyReason}`}</Link>
              ))}
            </section>
          )}
          {canConfig && order.process && (
            <p className="text-center text-xs text-gray-400">Las etapas vienen del proceso «{order.process.name}». <Link href="/dashboard/fabricacion/configuracion" className="underline">Editar procesos</Link></p>
          )}
        </div>
      </div>

      {editSpecs && (
        <SpecsModal order={order} fields={specFields} onClose={() => setEditSpecs(false)}
          onSaved={(o) => { setOrder(o); setEditSpecs(false); }} />
      )}
      {payModal && order.sale && (
        <BalanceModal order={order} onClose={() => setPayModal(false)} onSaved={(o) => { setOrder(o); setPayModal(false); setNotice({ ok: true, text: 'Pago registrado' }); }} />
      )}
      {payReq && (
        <PaymentLinkModal request={payReq} onClose={() => { setPayReq(null); load(); }} onPaid={() => load()} />
      )}
    </div>
  );
}

type RunFn = (key: string, fn: () => Promise<ProductionOrderDetail | void>, ok?: string) => Promise<void>;

function StagesTab({ order, users, busy, run }: { order: ProductionOrderDetail; users: Array<{ id: string; name: string }>; busy: string; run: RunFn }) {
  const t = () => getToken()!;
  const open = !['DONE', 'CANCELLED'].includes(order.status);
  const current = order.stages.find((s) => s.status !== 'DONE' && s.status !== 'SKIPPED');
  if (!order.stages.length) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
        Esta orden no tiene proceso con etapas. Usa «Terminar orden» cuando esté lista, o asígnale un proceso al producto para las próximas.
      </div>
    );
  }
  async function approval(stage: ProductionOrderStage, approved: boolean) {
    const note = window.prompt(approved ? 'Comentario del cliente (opcional):' : '¿Qué cambios pidió el cliente?');
    if (note === null) return;
    if (!approved && !note.trim()) return;
    await run(`appr-${stage.id}`, () => api.production.stageAction(order.id, stage.id, 'approval', t(), { approved, note }));
  }
  return (
    <ol className="space-y-3">
      {order.stages.map((s) => {
        const isCurrent = current?.id === s.id;
        const done = s.checklist.filter((c) => c.done).length;
        return (
          <li key={s.id} className={`rounded-2xl border bg-white p-4 ${isCurrent && open ? 'border-blue-300 shadow-sm' : 'border-gray-200'}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${s.status === 'DONE' ? 'bg-green-500 text-white' : isCurrent ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
                    {s.status === 'DONE' ? '✓' : s.position + 1}
                  </span>
                  <h3 className="font-semibold text-gray-900">{s.name}</h3>
                  <Badge cls={STAGE_STATUS_CLS[s.status]}>{STAGE_STATUS_LABEL[s.status]}</Badge>
                  {s.requiresApproval && <Badge cls="bg-amber-50 text-amber-700">Aprobación del cliente</Badge>}
                  {!s.customerVisible && <Badge cls="bg-gray-100 text-gray-500">Interna</Badge>}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {s.areaName ? `${s.areaName} · ` : ''}{s.estimatedHours != null ? `${s.estimatedHours * order.quantity} h estimadas · ` : ''}
                  {s.completedAt ? `Lista ${fmtDateTime(s.completedAt)}` : s.startedAt ? `Iniciada ${fmtDateTime(s.startedAt)}` : s.dueDate ? `Para el ${fmtDate(s.dueDate)}` : 'Sin fecha'}
                </p>
                {s.approvalStatus && s.approvalStatus !== 'PENDING' && (
                  <p className={`mt-1 text-xs ${s.approvalStatus === 'APPROVED' ? 'text-green-700' : 'text-amber-700'}`}>
                    {s.approvalStatus === 'APPROVED' ? 'Aprobado por el cliente' : 'El cliente pidió cambios'}{s.approvalNote && `: ${s.approvalNote}`}
                  </p>
                )}
              </div>
              <select value={s.assignedToId || ''} disabled={!open || s.status === 'DONE'}
                onChange={(e) => run(`assign-${s.id}`, () => api.production.stageAction(order.id, s.id, 'assign', t(), { userId: e.target.value || null }))}
                className="max-w-[160px] rounded-lg border border-gray-200 px-2 py-1 text-xs">
                <option value="">Sin responsable</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>

            {s.checklist.length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="text-[11px] font-semibold text-gray-500">Lista de verificación ({done}/{s.checklist.length})</p>
                {s.checklist.map((c, i) => (
                  <label key={i} className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={c.done} disabled={!open}
                      onChange={() => run(`check-${s.id}`, () => api.production.updateStage(order.id, s.id, { checklist: s.checklist.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) }, t()))}
                      className="accent-blue-600" />
                    <span className={c.done ? 'text-gray-400 line-through' : ''}>{c.label}</span>
                  </label>
                ))}
              </div>
            )}

            {open && (
              <div className="mt-3 flex flex-wrap gap-2">
                {s.status === 'PENDING' && order.status !== 'ON_HOLD' && (
                  <button onClick={() => run(`start-${s.id}`, () => api.production.stageAction(order.id, s.id, 'start', t()))} disabled={!!busy} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">Iniciar</button>
                )}
                {(s.status === 'IN_PROGRESS' || (s.status === 'PENDING' && isCurrent)) && order.status !== 'ON_HOLD' && (
                  <button onClick={() => run(`done-${s.id}`, () => api.production.stageAction(order.id, s.id, 'complete', t()))} disabled={!!busy}
                    className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50">
                    {s.requiresApproval && s.approvalStatus !== 'APPROVED' ? 'Enviar a aprobación del cliente' : 'Marcar lista'}
                  </button>
                )}
                {s.status === 'WAITING_APPROVAL' && (
                  <>
                    <button onClick={() => approval(s, true)} disabled={!!busy} className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50">Registrar aprobación</button>
                    <button onClick={() => approval(s, false)} disabled={!!busy} className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50">Pidió cambios</button>
                  </>
                )}
                {(s.status === 'PENDING' || s.status === 'IN_PROGRESS') && (
                  <button onClick={() => run(`skip-${s.id}`, () => api.production.stageAction(order.id, s.id, 'skip', t()))} disabled={!!busy} className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-50">Omitir</button>
                )}
                {(s.status === 'DONE' || s.status === 'SKIPPED' || s.status === 'WAITING_APPROVAL') && (
                  <button onClick={() => run(`reopen-${s.id}`, () => api.production.stageAction(order.id, s.id, 'reopen', t()))} disabled={!!busy} className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-50">Reabrir</button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function MaterialsTab({ order, busy, run, companyId }: { order: ProductionOrderDetail; busy: string; run: RunFn; companyId?: string }) {
  const t = () => getToken()!;
  const open = !['DONE', 'CANCELLED'].includes(order.status);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Array<{ id: string; name: string; sku: string; stock: number }>>([]);
  const [qty, setQty] = useState('1');
  const [stage, setStage] = useState('');
  useEffect(() => {
    const tok = getToken();
    if (!tok || q.trim().length < 2) return;
    const h = setTimeout(() => {
      api.catalog.search({ search: q.trim(), pageSize: 8, companyId, type: 'ARTICULO' }, tok).then((r) => setResults(r.products)).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(h);
  }, [q, companyId]);

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Material</th>
              <th className="px-3 py-2 text-right font-medium">Planificado</th>
              <th className="px-3 py-2 text-right font-medium">Reservado</th>
              <th className="px-3 py-2 text-right font-medium">Consumido</th>
              <th className="px-3 py-2 text-right font-medium">Stock</th>
              <th className="px-3 py-2 text-right font-medium">Costo</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {order.materials.map((m) => {
              const pending = Math.max(0, m.plannedQty - m.consumedQty);
              const short = pending > 0 && m.stock < Math.ceil(pending);
              return (
                <tr key={m.id}>
                  <td className="px-3 py-2"><p className="font-medium text-gray-900">{m.name}</p><p className="text-[11px] text-gray-400">{m.sku}{m.stageName && ` · se usa en «${m.stageName}»`}</p></td>
                  <td className="px-3 py-2 text-right">{m.plannedQty}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{m.reservedQty || '—'}</td>
                  <td className="px-3 py-2 text-right">{m.consumedQty || '—'}</td>
                  <td className={`px-3 py-2 text-right ${short ? 'font-semibold text-red-600' : 'text-gray-500'}`}>{m.stock}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{fmtCLP(m.unitCost * (m.consumedQty || m.plannedQty))}</td>
                  <td className="px-3 py-2 text-right">
                    {open && m.consumedQty === 0 && (
                      <button onClick={() => run(`rm-${m.id}`, () => api.production.removeMaterial(order.id, m.id, t()))} className="text-xs text-red-500 hover:text-red-700" aria-label="Quitar material">✕</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {order.materials.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">Sin materiales. Defínelos en la ficha del producto (pestaña Fabricación) o agrégalos aquí.</td></tr>}
          </tbody>
        </table>
      </div>
      {open && order.materials.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => run('reserve', async () => {
            const r = await api.production.action(order.id, 'materials/reserve', t());
            return r;
          }, 'Materiales reservados en bodega')} disabled={!!busy} className={btnSecondary}>Reservar en bodega</button>
          <button onClick={async () => { if (await confirmDialog('¿Descontar ahora del inventario todos los materiales pendientes?')) run('consume', () => api.production.action(order.id, 'materials/consume', t()), 'Materiales descontados'); }} disabled={!!busy} className={btnSecondary}>Descontar ahora</button>
        </div>
      )}
      {open && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-800">Agregar material a esta orden</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-6">
            <div className="relative sm:col-span-3">
              <input value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value.trim().length < 2) setResults([]); }} placeholder="Buscar insumo…" className={inputCls} />
              {results.length > 0 && (
                <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                  {results.map((r) => (
                    <button key={r.id} type="button"
                      onClick={() => { run('addmat', () => api.production.setMaterial(order.id, { materialId: r.id, plannedQty: Number(qty) || 1, stageName: stage || null }, t())); setQ(''); setResults([]); }}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50">
                      {r.name} <span className="text-xs text-gray-400">{r.sku} · stock {r.stock}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input type="number" min="0.001" step="any" value={qty} onChange={(e) => setQty(e.target.value)} className={inputCls} aria-label="Cantidad" />
            <select value={stage} onChange={(e) => setStage(e.target.value)} className={`${inputCls} sm:col-span-2`}>
              <option value="">Se usa al iniciar</option>
              {order.stages.map((s) => <option key={s.id} value={s.name}>En «{s.name}»</option>)}
            </select>
          </div>
          <p className="mt-1 text-[11px] text-gray-400">Elige la cantidad y la etapa, y luego el insumo en la búsqueda.</p>
        </div>
      )}
    </div>
  );
}

function TimeTab({ order, users, busy, run }: { order: ProductionOrderDetail; users: Array<{ id: string; name: string }>; busy: string; run: RunFn }) {
  const t = () => getToken()!;
  const [form, setForm] = useState({ stageId: order.stages.find((s) => s.status === 'IN_PROGRESS')?.id || '', hours: '', minutes: '', note: '', userId: '', workDate: '' });
  const totalMin = order.timeEntries.reduce((s, e) => s + e.minutes, 0);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const minutes = (Number(form.hours) || 0) * 60 + (Number(form.minutes) || 0);
    run('time', () => api.production.addTime(order.id, { stageId: form.stageId || null, minutes, note: form.note, userId: form.userId || null, workDate: form.workDate || undefined }, t()), 'Horas registradas')
      .then(() => setForm((f) => ({ ...f, hours: '', minutes: '', note: '' })));
  };
  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="grid grid-cols-2 gap-2 rounded-2xl border border-gray-200 bg-white p-4 sm:grid-cols-6">
        <select value={form.stageId} onChange={(e) => setForm({ ...form, stageId: e.target.value })} className={`${inputCls} col-span-2`}>
          <option value="">Sin etapa</option>
          {order.stages.map((s) => <option key={s.id} value={s.id}>{s.name}{s.areaName ? ` (${s.areaName})` : ''}</option>)}
        </select>
        <input type="number" min="0" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} placeholder="Horas" className={inputCls} />
        <input type="number" min="0" max="59" value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} placeholder="Min" className={inputCls} />
        <select value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} className={`${inputCls} col-span-2`}>
          <option value="">Yo</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <input type="date" value={form.workDate} onChange={(e) => setForm({ ...form, workDate: e.target.value })} className={`${inputCls} col-span-2`} />
        <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Nota (opcional)" className={`${inputCls} col-span-2 sm:col-span-3`} />
        <button type="submit" disabled={!!busy} className={`${btnPrimary} col-span-2 sm:col-span-1`}>Registrar</button>
      </form>
      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
            <tr><th className="px-3 py-2 text-left font-medium">Fecha</th><th className="px-3 py-2 text-left font-medium">Persona</th><th className="px-3 py-2 text-left font-medium">Etapa</th><th className="px-3 py-2 text-right font-medium">Tiempo</th><th className="px-3 py-2 text-right font-medium">Costo</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {order.timeEntries.map((e) => (
              <tr key={e.id}>
                <td className="px-3 py-2 text-xs text-gray-500">{fmtDate(e.workDate)}</td>
                <td className="px-3 py-2">{e.userName || '—'}{e.note && <p className="text-[11px] text-gray-400">{e.note}</p>}</td>
                <td className="px-3 py-2 text-xs text-gray-600">{e.stageName || '—'}</td>
                <td className="px-3 py-2 text-right">{Math.floor(e.minutes / 60)}h {e.minutes % 60}m</td>
                <td className="px-3 py-2 text-right text-gray-500">{fmtCLP(e.cost)}</td>
                <td className="px-3 py-2 text-right"><button onClick={() => run(`rmt-${e.id}`, () => api.production.removeTime(order.id, e.id, t()))} className="text-xs text-red-500 hover:text-red-700" aria-label="Quitar registro">✕</button></td>
              </tr>
            ))}
            {order.timeEntries.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">Sin horas registradas. El costo por hora se define en cada área.</td></tr>}
          </tbody>
          {order.timeEntries.length > 0 && (
            <tfoot className="border-t border-gray-100 text-sm font-semibold"><tr><td className="px-3 py-2" colSpan={3}>Total</td><td className="px-3 py-2 text-right">{Math.floor(totalMin / 60)}h {totalMin % 60}m</td><td className="px-3 py-2 text-right">{fmtCLP(order.costs.labor)}</td><td /></tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function FilesTab({ order, busy, run }: { order: ProductionOrderDetail; busy: string; run: RunFn }) {
  const t = () => getToken()!;
  const input = useRef<HTMLInputElement>(null);
  const [stageName, setStageName] = useState(order.stages.find((s) => s.status === 'IN_PROGRESS')?.name || '');
  const [visible, setVisible] = useState(true);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      await run('upload', () => api.production.addAttachment(order.id, f, { stageName: stageName || undefined, customerVisible: visible }, t()));
    }
    if (input.current) input.current.value = '';
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white p-4">
        <select value={stageName} onChange={(e) => setStageName(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-2 text-sm">
          <option value="">General</option>
          {order.stages.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} className="accent-blue-600" />
          Visible para el cliente
        </label>
        <input ref={input} type="file" multiple accept="image/*,application/pdf" onChange={(e) => upload(e.target.files)} className="hidden" />
        <button onClick={() => input.current?.click()} disabled={busy === 'upload'} className={`${btnPrimary} ml-auto`}>{busy === 'upload' ? 'Subiendo…' : 'Subir fotos o archivos'}</button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {order.attachments.map((a) => (
          <div key={a.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <a href={a.url} target="_blank" rel="noopener noreferrer" className="block aspect-[4/3] bg-gray-50">
              {a.mimeType?.startsWith('image/')
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={a.url} alt={a.name} className="h-full w-full object-cover" />
                : <span className="flex h-full items-center justify-center text-xs text-gray-500">{a.name}</span>}
            </a>
            <div className="space-y-1 p-2 text-[11px]">
              <p className="truncate text-gray-600">{a.stageName || 'General'} · {fmtDate(a.createdAt)}</p>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1 text-gray-600">
                  <input type="checkbox" checked={a.customerVisible} onChange={() => run(`vis-${a.id}`, () => api.production.updateAttachment(order.id, a.id, !a.customerVisible, t()))} className="accent-blue-600" />
                  Cliente
                </label>
                <button onClick={async () => { if (await confirmDialog('¿Eliminar este archivo?', { danger: true })) run(`rma-${a.id}`, () => api.production.removeAttachment(order.id, a.id, t())); }} className="text-red-500 hover:text-red-700">Eliminar</button>
              </div>
            </div>
          </div>
        ))}
        {order.attachments.length === 0 && <p className="col-span-full py-6 text-center text-sm text-gray-400">Sin fotos ni archivos.</p>}
      </div>
    </div>
  );
}

function LogTab({ order, busy, run }: { order: ProductionOrderDetail; busy: string; run: RunFn }) {
  const t = () => getToken()!;
  const [note, setNote] = useState('');
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-4">
      <form onSubmit={(e) => { e.preventDefault(); if (note.trim()) run('note', () => api.production.action(order.id, 'notes', t(), { message: note, customerVisible: visible })).then(() => setNote('')); }}
        className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Agregar una nota…" className={`${inputCls} resize-none`} />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} className="accent-blue-600" />
            El cliente la ve en su seguimiento
          </label>
          <button type="submit" disabled={!!busy || !note.trim()} className={btnPrimary}>Agregar</button>
        </div>
      </form>
      <ol className="space-y-2">
        {order.events.map((e) => (
          <li key={e.id} className="rounded-xl border border-gray-100 bg-white px-4 py-2.5 text-sm">
            <div className="flex items-start justify-between gap-2">
              <p className="text-gray-800">{e.message}</p>
              {e.customerVisible && <Badge cls="bg-blue-50 text-blue-700">Cliente</Badge>}
            </div>
            <p className="mt-0.5 text-[11px] text-gray-400">{fmtDateTime(e.createdAt)}{e.actorName && ` · ${e.actorName}`}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SpecsModal({ order, fields, onClose, onSaved }: { order: ProductionOrderDetail; fields: SpecField[]; onClose: () => void; onSaved: (o: ProductionOrderDetail) => void }) {
  const [specs, setSpecs] = useState<Record<string, string>>(order.specs || {});
  const [repair, setRepair] = useState<Record<string, string>>(order.repairInfo || {});
  const [notes, setNotes] = useState(order.notes || '');
  const [customer, setCustomer] = useState({ customerName: order.customerName || '', customerPhone: order.customerPhone || '', customerEmail: order.customerEmail || '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onSaved(await api.production.update(order.id, { specs, ...(order.repairInfo ? { repairInfo: repair } : {}), notes, ...customer }, getToken()!));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal title="Editar especificaciones" size="lg" busy={busy} onClose={onClose} onSubmit={save}
      footer={<><button type="button" onClick={onClose} className={btnSecondary}>Cancelar</button><button type="submit" disabled={busy} className={btnPrimary}>Guardar</button></>}>
      <div className="space-y-4">
        {fields.length > 0 && <SpecInputs fields={fields} value={specs} onChange={setSpecs} />}
        {order.repairInfo && (<><h3 className="text-sm font-semibold text-gray-800">Equipo recibido</h3><SpecInputs fields={REPAIR_FIELDS} value={repair} onChange={setRepair} /></>)}
        {order.kind !== 'FOR_STOCK' && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input value={customer.customerName} onChange={(e) => setCustomer({ ...customer, customerName: e.target.value })} placeholder="Cliente" className={inputCls} />
            <input value={customer.customerPhone} onChange={(e) => setCustomer({ ...customer, customerPhone: e.target.value })} placeholder="Teléfono" className={inputCls} />
            <input value={customer.customerEmail} onChange={(e) => setCustomer({ ...customer, customerEmail: e.target.value })} placeholder="Correo" className={inputCls} />
          </div>
        )}
        <div><label className={labelCls}>Notas internas</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={`${inputCls} resize-none`} /></div>
        <FormError message={error} />
      </div>
    </Modal>
  );
}

function BalanceModal({ order, onClose, onSaved }: { order: ProductionOrderDetail; onClose: () => void; onSaved: (o: ProductionOrderDetail) => void }) {
  const [method, setMethod] = useState('CASH');
  const [amount, setAmount] = useState(String(Math.round(order.sale?.balanceDue || 0)));
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onSaved(await api.production.payBalance(order.id, { method, amount: Number(amount), reference }, getToken()!));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal title="Registrar pago del saldo" busy={busy} onClose={onClose} onSubmit={save}
      footer={<><button type="button" onClick={onClose} className={btnSecondary}>Cancelar</button><button type="submit" disabled={busy} className={btnPrimary}>Registrar</button></>}>
      <div className="space-y-3">
        <p className="text-sm text-gray-600">Saldo por cobrar: <strong>{fmtCLP(order.sale?.balanceDue)}</strong>. El pago entra al cierre de caja de quien lo registra.</p>
        <div><label className={labelCls}>Medio de pago</label>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>
            {['CASH', 'CARD', 'TRANSFER', 'OTHER'].map((m) => <option key={m} value={m}>{PAY_LABELS[m]}</option>)}
          </select>
        </div>
        <div><label className={labelCls}>Monto</label><input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Referencia (opcional)</label><input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="N° de transferencia, voucher…" className={inputCls} /></div>
        <FormError message={error} />
      </div>
    </Modal>
  );
}

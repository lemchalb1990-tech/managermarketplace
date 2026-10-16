'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getToken, getUser } from '@/lib/auth';
import { api, type ProductionOrderSummary, type ProductionProcess } from '@/lib/api';
import { useAdminCompany } from '../AdminCompanyContext';
import { SkeletonCards } from '@/components/Skeleton';
import {
  Badge, KIND_CLS, NewOrderModal, ORDER_STATUS_CLS, ORDER_STATUS_LABEL, PRIORITY_LABEL, fmtDate, ofNumber,
} from './shared';

type Column = { key: string; title: string; items: ProductionOrderSummary[]; dropStageName?: string };

export default function ProductionBoardPage() {
  const router = useRouter();
  const { companyId, selectedCompanyId } = useAdminCompany();
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [view, setView] = useState<'board' | 'list'>('board');
  const [processes, setProcesses] = useState<ProductionProcess[]>([]);
  const [processId, setProcessId] = useState('');
  const [items, setItems] = useState<ProductionOrderSummary[]>([]);
  const [stats, setStats] = useState({ open: 0, overdue: 0, waitingApproval: 0, doneWeek: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  // Lista
  const [list, setList] = useState<{ items: ProductionOrderSummary[]; total: number; page: number; pages: number }>({ items: [], total: 0, page: 1, pages: 1 });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setIsSuperAdmin(getUser()?.role === 'SUPER_ADMIN');
      try { const v = localStorage.getItem('production_view'); if (v === 'list' || v === 'board') setView(v); } catch { /* sin almacenamiento */ }
    });
    return () => cancelAnimationFrame(id);
  }, []);
  const noCompany = isSuperAdmin && !selectedCompanyId;

  const loadBoard = useCallback(() => {
    const t = getToken();
    if (!t || noCompany) return;
    setLoading(true);
    api.production.board(t, { companyId, processId: processId || undefined })
      .then((r) => { setItems(r.items); setStats(r.stats); setError(''); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [companyId, processId, noCompany]);

  const loadList = useCallback((page = 1) => {
    const t = getToken();
    if (!t || noCompany) return;
    setLoading(true);
    api.production.list(t, { companyId, processId: processId || undefined, search: search || undefined, status: status || undefined, kind: kind || undefined, page })
      .then((r) => { setList(r); setError(''); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [companyId, processId, search, status, kind, noCompany]);

  useEffect(() => {
    const t = getToken();
    if (!t || noCompany) return;
    api.production.processes(t, companyId).then((p) => setProcesses(p.filter((x) => x.active))).catch(() => {});
  }, [companyId, noCompany]);

  useEffect(() => {
    const id = requestAnimationFrame(() => (view === 'board' ? loadBoard() : loadList(1)));
    return () => cancelAnimationFrame(id);
  }, [view, loadBoard, loadList]);

  function changeView(v: 'board' | 'list') {
    setView(v);
    try { localStorage.setItem('production_view', v); } catch { /* sin almacenamiento */ }
  }

  const process = processes.find((p) => p.id === processId) || null;

  const columns: Column[] = useMemo(() => {
    const open = items.filter((i) => i.status !== 'DONE' && i.status !== 'CANCELLED');
    const done = items.filter((i) => i.status === 'DONE');
    if (process) {
      // Columnas por etapa del proceso: cada orden en su etapa actual.
      const cols: Column[] = [{ key: '__start', title: 'Por iniciar', items: open.filter((o) => o.status === 'PENDING' && (!o.currentStage || o.currentStage.status === 'PENDING') && o.progress === 0) }];
      for (const st of process.stages) {
        cols.push({
          key: st.name, title: st.name, dropStageName: st.name,
          items: open.filter((o) => !(o.status === 'PENDING' && o.progress === 0) && o.currentStage?.name === st.name),
        });
      }
      cols.push({ key: '__done', title: 'Terminadas (7 días)', items: done });
      return cols;
    }
    return [
      { key: 'PENDING', title: ORDER_STATUS_LABEL.PENDING, items: open.filter((o) => o.status === 'PENDING') },
      { key: 'IN_PROGRESS', title: ORDER_STATUS_LABEL.IN_PROGRESS, items: open.filter((o) => o.status === 'IN_PROGRESS') },
      { key: 'WAITING_APPROVAL', title: ORDER_STATUS_LABEL.WAITING_APPROVAL, items: open.filter((o) => o.status === 'WAITING_APPROVAL') },
      { key: 'ON_HOLD', title: ORDER_STATUS_LABEL.ON_HOLD, items: open.filter((o) => o.status === 'ON_HOLD') },
      { key: '__done', title: 'Terminadas (7 días)', items: done },
    ];
  }, [items, process]);

  // Arrastrar una orden a la columna siguiente termina su etapa actual (o la inicia, desde «Por iniciar»).
  async function drop(col: Column) {
    const order = items.find((i) => i.id === dragId);
    setDragId(null);
    if (!order || !process || !order.currentStage) return;
    const fromIdx = columns.findIndex((c) => c.items.some((i) => i.id === order.id));
    const toIdx = columns.findIndex((c) => c.key === col.key);
    if (toIdx === fromIdx) return;
    const t = getToken()!;
    try {
      if (columns[fromIdx]?.key === '__start' && toIdx === fromIdx + 1) {
        await api.production.stageAction(order.id, order.currentStage.id, 'start', t);
      } else if (toIdx === fromIdx + 1) {
        if (order.currentStage.status === 'PENDING') await api.production.stageAction(order.id, order.currentStage.id, 'start', t);
        const r = await api.production.stageAction(order.id, order.currentStage.id, 'complete', t);
        if (r.status === 'WAITING_APPROVAL') setNotice(`${ofNumber(order.number)}: «${order.currentStage.name}» quedó esperando la aprobación del cliente`);
      } else {
        setNotice('Mueve la orden a la columna siguiente, o ábrela para avanzar varias etapas');
        return;
      }
      loadBoard();
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  const Card = ({ o }: { o: ProductionOrderSummary }) => (
    <Link href={`/dashboard/fabricacion/${o.id}`} draggable={!!process && o.status !== 'DONE'}
      onDragStart={() => setDragId(o.id)} onDragEnd={() => setDragId(null)}
      className={`block rounded-xl border bg-white p-3 shadow-sm transition hover:shadow-md ${o.overdue ? 'border-red-200' : 'border-gray-200'} ${dragId === o.id ? 'opacity-50' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold text-gray-500">{ofNumber(o.number)}</span>
        <div className="flex gap-1">
          {o.priority > 0 && <Badge cls={o.priority === 2 ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}>{PRIORITY_LABEL[o.priority]}</Badge>}
          <Badge cls={KIND_CLS[o.kind]}>{o.kindLabel}</Badge>
        </div>
      </div>
      <p className="mt-1 text-sm font-semibold text-gray-900 leading-snug">{o.productName}{o.quantity > 1 && <span className="font-normal text-gray-500"> × {o.quantity}</span>}</p>
      {o.customerName && <p className="text-xs text-gray-500">{o.customerName}</p>}
      {o.currentStage && o.status !== 'DONE' && (
        <p className="mt-1.5 text-xs text-gray-600">
          <span className="font-medium">{o.currentStage.name}</span>
          {o.currentStage.assignedToName && <span className="text-gray-400"> · {o.currentStage.assignedToName}</span>}
        </p>
      )}
      {o.stagesCount > 0 && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
          <div className={`h-full rounded-full ${o.status === 'DONE' ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${o.progress}%` }} />
        </div>
      )}
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className={o.overdue ? 'font-semibold text-red-600' : 'text-gray-400'}>{o.dueDate ? `Entrega ${fmtDate(o.dueDate)}` : 'Sin fecha'}</span>
        {o.balanceDue ? <span className="font-medium text-amber-700">Saldo ${Math.round(o.balanceDue).toLocaleString('es-CL')}</span> : null}
      </div>
    </Link>
  );

  return (
    <div className="max-w-[1400px]">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="ui-page-title mb-1">Fabricación</h1>
          <p className="ui-page-subtitle">Órdenes de fabricación a pedido, lotes para stock y reparaciones, con su avance por etapa.</p>
        </div>
        {!noCompany && (
          <button onClick={() => setShowNew(true)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">+ Nueva orden</button>
        )}
      </div>

      {noCompany && <p className="text-sm text-gray-500">Selecciona una empresa en la barra superior.</p>}
      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {notice && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg bg-blue-50 px-4 py-2.5 text-sm text-blue-800">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="text-blue-500 hover:text-blue-700" aria-label="Cerrar">✕</button>
        </div>
      )}

      {!noCompany && (
        <>
          {view === 'board' && (
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'En curso', value: stats.open, cls: 'text-gray-900' },
                { label: 'Atrasadas', value: stats.overdue, cls: stats.overdue ? 'text-red-600' : 'text-gray-900' },
                { label: 'Esperando al cliente', value: stats.waitingApproval, cls: stats.waitingApproval ? 'text-amber-700' : 'text-gray-900' },
                { label: 'Terminadas (7 días)', value: stats.doneWeek, cls: 'text-green-700' },
              ].map((k) => (
                <div key={k.label} className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                  <p className="text-xs text-gray-500">{k.label}</p>
                  <p className={`text-2xl font-bold ${k.cls}`}>{k.value}</p>
                </div>
              ))}
            </div>
          )}

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 text-xs font-semibold">
              {(['board', 'list'] as const).map((v) => (
                <button key={v} onClick={() => changeView(v)} className={`rounded-md px-3 py-1.5 ${view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                  {v === 'board' ? 'Tablero' : 'Lista'}
                </button>
              ))}
            </div>
            <select value={processId} onChange={(e) => setProcessId(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm">
              <option value="">Todos los procesos (por estado)</option>
              {processes.map((p) => <option key={p.id} value={p.id}>{p.name} (por etapa)</option>)}
            </select>
            {view === 'list' && (
              <>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar OF, producto o cliente…" className="min-w-[200px] flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm">
                  <option value="">Todos los estados</option>
                  {Object.entries(ORDER_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm">
                  <option value="">Todos los tipos</option>
                  <option value="MADE_TO_ORDER">A pedido</option>
                  <option value="FOR_STOCK">Para stock</option>
                  <option value="REPAIR">Reparación</option>
                </select>
              </>
            )}
            {view === 'board' && process && <span className="text-xs text-gray-400">Arrastra una orden a la columna siguiente para avanzarla.</span>}
          </div>

          {loading && !items.length && !list.items.length ? <SkeletonCards /> : view === 'board' ? (
            <div className="flex gap-3 overflow-x-auto pb-4">
              {columns.map((col) => (
                <div key={col.key}
                  onDragOver={(e) => { if (dragId && process) e.preventDefault(); }}
                  onDrop={() => drop(col)}
                  className={`flex w-72 shrink-0 flex-col rounded-2xl bg-gray-50 p-2 ${dragId && process ? 'ring-1 ring-dashed ring-gray-300' : ''}`}>
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{col.title}</h2>
                    <span className="rounded-full bg-white px-2 text-xs font-semibold text-gray-500">{col.items.length}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {col.items.map((o) => <Card key={o.id} o={o} />)}
                    {col.items.length === 0 && <p className="px-2 py-6 text-center text-xs text-gray-300">Sin órdenes</p>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-200 bg-gray-50">
                  <tr>
                    {['OF', 'Producto', 'Cliente', 'Etapa', 'Avance', 'Entrega', 'Estado'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left font-medium text-gray-600">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {list.items.map((o) => (
                    <tr key={o.id} onClick={() => router.push(`/dashboard/fabricacion/${o.id}`)} className="cursor-pointer hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-gray-600">{ofNumber(o.number)}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{o.productName}{o.quantity > 1 && ` × ${o.quantity}`}</p>
                        <Badge cls={KIND_CLS[o.kind]}>{o.kindLabel}</Badge>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{o.customerName || '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">{o.status === 'DONE' ? '—' : o.currentStage?.name || '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">{o.stagesCount ? `${o.progress}%` : '—'}</td>
                      <td className={`px-4 py-3 text-xs ${o.overdue ? 'font-semibold text-red-600' : 'text-gray-600'}`}>{fmtDate(o.dueDate)}</td>
                      <td className="px-4 py-3"><Badge cls={ORDER_STATUS_CLS[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge></td>
                    </tr>
                  ))}
                  {!loading && list.items.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Sin órdenes de fabricación.</td></tr>}
                </tbody>
              </table>
              {list.pages > 1 && (
                <div className="flex items-center justify-center gap-2 border-t border-gray-100 py-3 text-sm">
                  <button onClick={() => loadList(list.page - 1)} disabled={list.page <= 1} className="rounded-lg border border-gray-300 px-3 py-1.5 disabled:opacity-40">Anterior</button>
                  <span className="text-gray-500">{list.page} / {list.pages}</span>
                  <button onClick={() => loadList(list.page + 1)} disabled={list.page >= list.pages} className="rounded-lg border border-gray-300 px-3 py-1.5 disabled:opacity-40">Siguiente</button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {showNew && (
        <NewOrderModal companyId={companyId} onClose={() => setShowNew(false)} onCreated={(id) => { setShowNew(false); router.push(`/dashboard/fabricacion/${id}`); }} />
      )}
    </div>
  );
}

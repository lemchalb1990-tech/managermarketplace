'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getToken, getUser } from '@/lib/auth';
import { api, type ProductionTask } from '@/lib/api';
import { useAdminCompany } from '../../AdminCompanyContext';
import { SkeletonRows } from '@/components/Skeleton';
import { Badge, PRIORITY_LABEL, STAGE_STATUS_CLS, STAGE_STATUS_LABEL, fmtDate, ofNumber } from '../shared';

// Etapas en curso o por iniciar: las asignadas a mí y las que no tienen responsable.
export default function ProductionTasksPage() {
  const { companyId, selectedCompanyId } = useAdminCompany();
  const [tasks, setTasks] = useState<ProductionTask[]>([]);
  const [all, setAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const load = useCallback(() => {
    const t = getToken();
    if (!t) return;
    if (getUser()?.role === 'SUPER_ADMIN' && !selectedCompanyId) { setLoading(false); return; }
    api.production.tasks(t, { companyId, all: all ? 'true' : undefined })
      .then((r) => { setTasks(r); setError(''); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [companyId, selectedCompanyId, all]);

  useEffect(() => {
    const id = requestAnimationFrame(() => { setIsSuperAdmin(getUser()?.role === 'SUPER_ADMIN'); load(); });
    return () => cancelAnimationFrame(id);
  }, [load]);

  async function act(task: ProductionTask, action: 'start' | 'complete') {
    setBusy(task.stage.id);
    try {
      await api.production.stageAction(task.orderId, task.stage.id, action, getToken()!);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  const mine = tasks.filter((t) => t.mine);
  const others = tasks.filter((t) => !t.mine);

  const Row = ({ task }: { task: ProductionTask }) => (
    <li className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white px-4 py-3 ${task.overdue ? 'border-red-200' : 'border-gray-200'}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/dashboard/fabricacion/${task.orderId}`} className="font-mono text-xs font-semibold text-blue-600 hover:underline">{ofNumber(task.number)}</Link>
          <Badge cls={STAGE_STATUS_CLS[task.stage.status]}>{STAGE_STATUS_LABEL[task.stage.status]}</Badge>
          {task.priority > 0 && <Badge cls={task.priority === 2 ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}>{PRIORITY_LABEL[task.priority]}</Badge>}
        </div>
        <p className="mt-0.5 text-sm font-semibold text-gray-900">{task.stage.name}<span className="font-normal text-gray-500"> · {task.productName}{task.quantity > 1 && ` × ${task.quantity}`}</span></p>
        <p className="text-xs text-gray-500">
          {task.stage.areaName ? `${task.stage.areaName} · ` : ''}{task.customerName ? `${task.customerName} · ` : ''}
          <span className={task.overdue ? 'font-semibold text-red-600' : ''}>{task.dueDate ? `Para el ${fmtDate(task.dueDate)}` : 'Sin fecha'}</span>
          {task.stage.assignedToName && !task.mine && ` · ${task.stage.assignedToName}`}
        </p>
      </div>
      <div className="flex gap-2">
        {task.stage.status === 'PENDING' && (
          <button onClick={() => act(task, 'start')} disabled={busy === task.stage.id} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">Iniciar</button>
        )}
        {task.stage.status === 'IN_PROGRESS' && (
          <button onClick={() => act(task, 'complete')} disabled={busy === task.stage.id} className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50">Marcar lista</button>
        )}
        <Link href={`/dashboard/fabricacion/${task.orderId}`} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">Abrir</Link>
      </div>
    </li>
  );

  return (
    <div className="max-w-4xl">
      <h1 className="ui-page-title mb-1">Mis tareas</h1>
      <p className="ui-page-subtitle mb-4">La etapa actual de cada orden de fabricación: las tuyas y las que aún no tienen responsable.</p>
      {isSuperAdmin && !selectedCompanyId && <p className="text-sm text-gray-500">Selecciona una empresa en la barra superior.</p>}
      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <label className="mb-4 flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="accent-blue-600" />
        Ver también las asignadas a otras personas
      </label>
      {loading ? <SkeletonRows cols={1} /> : (
        <div className="space-y-6">
          <section>
            <h2 className="ui-section-title mb-2">Asignadas a mí ({mine.length})</h2>
            <ul className="space-y-2">{mine.map((t) => <Row key={t.stage.id} task={t} />)}</ul>
            {mine.length === 0 && <p className="text-sm text-gray-400">No tienes etapas asignadas.</p>}
          </section>
          <section>
            <h2 className="ui-section-title mb-2">{all ? 'De otras personas y sin responsable' : 'Sin responsable'} ({others.length})</h2>
            <ul className="space-y-2">{others.map((t) => <Row key={t.stage.id} task={t} />)}</ul>
            {others.length === 0 && <p className="text-sm text-gray-400">Nada pendiente.</p>}
          </section>
        </div>
      )}
    </div>
  );
}

'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getToken, getUser } from '@/lib/auth';
import { api, ActivityFilters, ActivityItem } from '@/lib/api';
import { PageHeader, Badge } from '@/components/ui';
import { useAdminCompany } from '../AdminCompanyContext';
import { SkeletonRows } from '@/components/Skeleton';

const inputCls = 'border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

// Color del tipo de acción: eliminaciones y alertas en rojo.
function actionTone(action: string): 'ok' | 'warn' | 'danger' | 'info' | 'neutral' {
  if (['ELIMINAR', 'BLOQUEADO', 'ALERTA', 'SESION_FALLIDA'].includes(action)) return 'danger';
  if (action === 'CREAR' || action === 'EMITIR') return 'ok';
  if (action === 'EDITAR' || action === 'ESTADO' || action === 'UNIFICAR') return 'warn';
  if (action === 'SESION') return 'neutral';
  return 'info';
}

function fmt(v: any) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  return String(v);
}

export default function ActivityPage() {
  const token = getToken() || '';
  const [user, setUser] = useState<any>(null);
  const { selectedCompanyId } = useAdminCompany();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const companyId = isSuperAdmin ? selectedCompanyId || undefined : undefined;

  const [options, setOptions] = useState<{ users: { id: string; name: string; email: string }[]; modules: string[]; actions: { id: string; label: string }[] }>({ users: [], modules: [], actions: [] });
  const [userId, setUserId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [module, setModule] = useState('');
  const [action, setAction] = useState('');
  const [automatic, setAutomatic] = useState(false);

  const [data, setData] = useState<{ items: ActivityItem[]; total: number; page: number; pages: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { setUser(getUser()); }, []);

  const needsCompany = isSuperAdmin && !selectedCompanyId;
  const filters: ActivityFilters = { companyId, userId, from, to, module, action, automatic };

  useEffect(() => {
    if (!user || needsCompany) return;
    api.activity.filters(token, companyId).then(setOptions).catch(() => {});
    setUserId('');
  }, [user, companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async (page = 1) => {
    if (!user || needsCompany) return;
    setLoading(true);
    setError('');
    try {
      setData(await api.activity.list(token, { ...filters, page }));
    } catch (e: any) {
      setError(e.message || 'No se pudo cargar el historial');
    } finally {
      setLoading(false);
    }
  }, [user, companyId, userId, from, to, module, action, automatic]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(1); }, [load]);

  async function handleExport() {
    setExporting(true);
    try { await api.activity.export(token, filters); } catch (e: any) { setError(e.message || 'No se pudo exportar'); } finally { setExporting(false); }
  }

  const actionLabel = (id: string) => options.actions.find((a) => a.id === id)?.label || id;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Historial de actividad"
        crumbs={[{ label: 'Administración' }, { label: 'Historial de actividad' }]}
        actions={
          <button onClick={handleExport} disabled={exporting || needsCompany || !data?.total}
            className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm hover:bg-gray-50 disabled:opacity-50">
            {exporting ? 'Exportando…' : 'Exportar Excel'}
          </button>
        }
      />

      {needsCompany ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center text-sm text-gray-500">
          Selecciona una empresa en la barra superior para ver su historial.
        </div>
      ) : (
        <>
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Usuario</label>
                <select value={userId} onChange={(e) => setUserId(e.target.value)} className={inputCls}>
                  <option value="">Todos</option>
                  {options.users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
                  <option value="system">Sistema (acciones automáticas)</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Desde</label>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Hasta</label>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Módulo</label>
                <select value={module} onChange={(e) => setModule(e.target.value)} className={inputCls}>
                  <option value="">Todos</option>
                  {options.modules.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Tipo de acción</label>
                <select value={action} onChange={(e) => setAction(e.target.value)} className={inputCls}>
                  <option value="">Todas</option>
                  {options.actions.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 pb-1.5 cursor-pointer select-none">
                <input type="checkbox" checked={automatic || userId === 'system'} disabled={userId === 'system'}
                  onChange={(e) => setAutomatic(e.target.checked)} />
                Mostrar acciones automáticas
              </label>
            </div>
          </div>

          {error && <div className="text-sm text-[var(--danger)]">{error}</div>}

          <div className="bg-white border border-gray-200 rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="text-left px-4 py-2.5 whitespace-nowrap">Fecha</th>
                  <th className="text-left px-4 py-2.5">Usuario</th>
                  <th className="text-left px-4 py-2.5">Módulo</th>
                  <th className="text-left px-4 py-2.5">Acción</th>
                  <th className="text-left px-4 py-2.5">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {loading && !data && (
                  <SkeletonRows cols={5} />
                )}
                {data && data.items.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No hay actividad con estos filtros.</td></tr>
                )}
                {data?.items.map((r) => {
                  const hasChanges = Array.isArray(r.changes) && r.changes.length > 0;
                  const open = expanded === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr className={`border-t border-gray-100 ${loading ? 'opacity-60' : ''}`}>
                        <td className="px-4 py-2.5 whitespace-nowrap text-gray-600">
                          {new Date(r.createdAt).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span>{r.actorName || (r.automatic ? 'Sistema' : <span className="text-gray-400">Sin usuario registrado</span>)}</span>
                            {r.automatic && <Badge tone="info">Automático</Badge>}
                          </div>
                          {r.ip && <div className="text-[11px] text-gray-400">IP {r.ip}</div>}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">{r.module}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap"><Badge tone={actionTone(r.action)}>{actionLabel(r.action)}</Badge></td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-start gap-2">
                            <span className="flex-1">
                              {r.href ? <Link href={r.href} className="hover:underline text-blue-700">{r.summary}</Link> : r.summary}
                              {r.origin === 'history' && <span className="ml-1.5 text-[11px] text-gray-400">(reconstruido)</span>}
                            </span>
                            {hasChanges && (
                              <button onClick={() => setExpanded(open ? null : r.id)} className="text-xs text-blue-700 hover:underline whitespace-nowrap">
                                {open ? 'Ocultar cambios' : `Ver cambios (${r.changes!.length})`}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {open && hasChanges && (
                        <tr className="bg-gray-50/60">
                          <td colSpan={5} className="px-4 py-3">
                            <table className="text-xs">
                              <thead className="text-gray-500"><tr><th className="text-left pr-6 pb-1">Campo</th><th className="text-left pr-6 pb-1">Antes</th><th className="text-left pb-1">Después</th></tr></thead>
                              <tbody>
                                {r.changes!.map((c, i) => (
                                  <tr key={i}>
                                    <td className="pr-6 py-0.5 font-medium">{c.field}</td>
                                    <td className="pr-6 py-0.5 text-[var(--danger)] line-through decoration-1">{fmt(c.before)}</td>
                                    <td className="py-0.5 text-[var(--ok)]">{fmt(c.after)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {data && data.pages > 1 && (
            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>{data.total.toLocaleString('es-CL')} registros</span>
              <div className="flex items-center gap-2">
                <button disabled={data.page <= 1 || loading} onClick={() => load(data.page - 1)} className="px-3 py-1 rounded-lg border border-gray-300 disabled:opacity-40">Anterior</button>
                <span>Página {data.page} de {data.pages}</span>
                <button disabled={data.page >= data.pages || loading} onClick={() => load(data.page + 1)} className="px-3 py-1 rounded-lg border border-gray-300 disabled:opacity-40">Siguiente</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

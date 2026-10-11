'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getToken } from '@/lib/auth';
import { api, type OrderAuditIssue, type OrderAuditRun, type OrderAuditSummary } from '@/lib/api';
import { FilterBar, FilterCount, FilterField, filterSelectCls } from '@/components/FilterBar';
import { btnPrimary, btnSecondary } from '@/components/ui/Modal';

type Tab = 'issues' | 'captured' | 'connections' | 'runs';

const CHANNEL: Record<string, string> = {
  MERCADO_LIBRE: 'Mercado Libre', PARIS: 'Paris', RIPLEY: 'Ripley', FALABELLA: 'Falabella', WALMART: 'Walmart', JUMPSELLER: 'JumpSeller',
};
const TYPE: Record<string, string> = {
  IMPORTED: 'Venta captada', UNLINKED: 'Productos sin vincular', IMPORT_ERROR: 'Error al importar', CONNECTION_ERROR: 'Conexión con error',
  DUPLICATE: 'Venta duplicada', LATE: 'Sin despachar a tiempo', NO_INVOICE: 'Sin boleta o factura',
};
const KIND: Record<string, string> = { QUICK: 'Rápida (48 h)', FULL: 'Completa (7 días)', MANUAL: 'Manual' };

const when = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const ago = (d: string | null | undefined) => {
  if (!d) return '—';
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return 'recién';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
};
const clp = (v: string | number | null) => (v == null ? '' : `$${Math.round(Number(v)).toLocaleString('es-CL')}`);

export default function VerificadorPage() {
  const [summary, setSummary] = useState<OrderAuditSummary | null>(null);
  const [tab, setTab] = useState<Tab>('issues');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  const load = useCallback(() => {
    api.orderAudit.summary(getToken()!).then(setSummary).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => { load(); }, [load, reload]);
  // Mientras corre, se refresca solo.
  useEffect(() => {
    if (!summary?.running) return;
    const t = setInterval(() => setReload((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [summary?.running]);

  async function run(full: boolean) {
    setStarting(true);
    setError('');
    try {
      await api.orderAudit.run(full, getToken()!);
      setReload((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  const s = summary;
  const busy = starting || !!s?.running;
  return (
    <div className="max-w-7xl">
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="ui-page-title mr-1">Verificador de órdenes</h1>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {s?.running && <span className="ui-badge ui-badge--info">Verificando…</span>}
          <button type="button" onClick={() => run(false)} disabled={busy} className={btnSecondary}>Verificar ahora (48 h)</button>
          <button type="button" onClick={() => run(true)} disabled={busy} className={btnPrimary}>Verificación completa (7 días)</button>
        </div>
      </div>
      <p className="ui-page-subtitle mb-4">
        Cada 30 minutos (últimas 48 h) y cada noche (últimos 7 días) compara las ventas de cada marketplace activo con las del sistema.
        Las que faltan se importan solas con su orden y descuento de stock; lo que no se puede corregir queda como incidencia.
        Solo revisa empresas con la sincronización con marketplaces activa.
      </p>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Última verificación" value={ago(s?.lastDone?.finishedAt)} hint={s?.lastDone ? `${KIND[s.lastDone.kind]} · ${s.lastDone.ordersChecked} ventas revisadas` : 'Aún no corre'} />
        <Stat label="Ventas captadas hoy" value={s?.captured.today ?? '—'} tone={s?.captured.today ? 'warn' : undefined} hint={s ? `${s.captured.week} en 7 días · ${s.captured.month} en 30` : undefined} onClick={() => setTab('captured')} />
        <Stat label="Incidencias críticas" value={s?.open.critical ?? '—'} tone={s?.open.critical ? 'danger' : 'ok'} onClick={() => setTab('issues')} />
        <Stat label="Advertencias" value={s?.open.warning ?? '—'} tone={s?.open.warning ? 'warn' : undefined} onClick={() => setTab('issues')} />
        <Stat label="Empresas con incidencias" value={s?.open.companies ?? '—'} onClick={() => setTab('connections')} />
      </div>

      {s && Object.keys(s.open.byType).length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5 text-xs">
          {Object.entries(s.open.byType).map(([t, n]) => (
            <span key={t} className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700">{TYPE[t] || t}: <b>{n}</b></span>
          ))}
        </div>
      )}

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-gray-200">
        {([['issues', 'Incidencias'], ['captured', 'Ventas captadas'], ['connections', 'Por cuenta'], ['runs', 'Historial']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`-mb-px shrink-0 border-b-2 px-4 py-2 text-sm font-medium ${tab === k ? 'border-[var(--brand)] text-[var(--brand-ink)]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'issues' && <IssuesTab reload={reload} onChanged={() => setReload((n) => n + 1)} />}
      {tab === 'captured' && <IssuesTab reload={reload} captured onChanged={() => setReload((n) => n + 1)} />}
      {tab === 'connections' && <ConnectionsTab summary={s} />}
      {tab === 'runs' && <RunsTab reload={reload} />}
    </div>
  );
}

function Stat({ label, value, hint, tone, onClick }: { label: string; value: React.ReactNode; hint?: string; tone?: 'ok' | 'warn' | 'danger'; onClick?: () => void }) {
  const cls = tone === 'ok' ? 'text-[var(--ok)]' : tone === 'warn' ? 'text-[var(--warn)]' : tone === 'danger' ? 'text-[var(--danger)]' : '';
  const body = (
    <>
      <div className={`ui-stat-value ${cls}`}>{value}</div>
      <div className="ui-stat-label">{label}</div>
      {hint && <div className="mt-1 text-xs text-[var(--text-muted)]">{hint}</div>}
    </>
  );
  return onClick
    ? <button type="button" onClick={onClick} className="ui-stat text-left transition hover:shadow-sm">{body}</button>
    : <div className="ui-stat">{body}</div>;
}

function IssuesTab({ reload, captured = false, onChanged }: { reload: number; captured?: boolean; onChanged: () => void }) {
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [f, setF] = useState({ status: captured ? '' : 'OPEN', type: captured ? 'IMPORTED' : '', severity: '', channel: '', companyId: '', search: '' });
  const [applied, setApplied] = useState(f);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; pageSize: number; rows: OrderAuditIssue[] } | null>(null);

  useEffect(() => {
    api.companies.list(getToken()!).then((c) => setCompanies(c.map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })))).catch(() => setCompanies([]));
  }, []);
  useEffect(() => {
    api.orderAudit.issues(getToken()!, { ...applied, page: String(page) }).then(setData).catch(() => setData(null));
  }, [applied, page, reload]);

  async function setStatus(i: OrderAuditIssue, status: 'OPEN' | 'RESOLVED' | 'IGNORED') {
    await api.orderAudit.setStatus(i.id, status, getToken()!).catch(() => null);
    onChanged();
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const sev = (s: string) => (s === 'CRITICAL' ? 'danger' : s === 'WARNING' ? 'warn' : 'info');

  return (
    <div>
      <FilterBar
        search={{ label: 'Buscar', value: f.search, onChange: (v) => setF((x) => ({ ...x, search: v })), placeholder: 'N° de venta o texto…' }}
        primary={!captured ? (
          <FilterField label="Estado">
            <select value={f.status} onChange={(e) => { const n = { ...f, status: e.target.value }; setF(n); setApplied(n); setPage(1); }} className={filterSelectCls}>
              <option value="OPEN">Abiertas</option><option value="RESOLVED">Resueltas</option><option value="IGNORED">Ignoradas</option><option value="">Todas</option>
            </select>
          </FilterField>
        ) : undefined}
        activeCount={[f.type && !captured, f.severity, f.channel, f.companyId].filter(Boolean).length}
        onApply={() => { setApplied(f); setPage(1); }}
        onClear={() => { const n = { status: captured ? '' : 'OPEN', type: captured ? 'IMPORTED' : '', severity: '', channel: '', companyId: '', search: '' }; setF(n); setApplied(n); setPage(1); }}
        summary={data ? <FilterCount n={data.total} label={captured ? 'ventas captadas' : 'incidencias'} /> : null}
      >
        <FilterField label="Empresa">
          <select value={f.companyId} onChange={(e) => setF((x) => ({ ...x, companyId: e.target.value }))} className={filterSelectCls}>
            <option value="">Todas</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </FilterField>
        <FilterField label="Canal">
          <select value={f.channel} onChange={(e) => setF((x) => ({ ...x, channel: e.target.value }))} className={filterSelectCls}>
            <option value="">Todos</option>
            {Object.entries(CHANNEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </FilterField>
        {!captured && (
          <>
            <FilterField label="Tipo">
              <select value={f.type} onChange={(e) => setF((x) => ({ ...x, type: e.target.value }))} className={filterSelectCls}>
                <option value="">Todos</option>
                {Object.entries(TYPE).filter(([k]) => k !== 'IMPORTED').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </FilterField>
            <FilterField label="Gravedad">
              <select value={f.severity} onChange={(e) => setF((x) => ({ ...x, severity: e.target.value }))} className={filterSelectCls}>
                <option value="">Todas</option><option value="CRITICAL">Crítica</option><option value="WARNING">Advertencia</option>
              </select>
            </FilterField>
          </>
        )}
      </FilterBar>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">{captured ? 'Venta' : 'Incidencia'}</th>
              <th className="px-3 py-2">Empresa · cuenta</th>
              <th className="px-3 py-2 text-right">Monto</th>
              <th className="px-3 py-2">{captured ? 'Captada' : 'Detectada'}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {!data && <tr><td colSpan={5} className="p-6 text-center text-gray-400">Cargando…</td></tr>}
            {data && !data.rows.length && (
              <tr><td colSpan={5} className="p-6 text-center text-gray-400">
                {captured ? 'El verificador aún no ha tenido que captar ventas: todas entraron por el camino normal.' : 'Sin incidencias con estos filtros. 🎉'}
              </td></tr>
            )}
            {data?.rows.map((i) => (
              <tr key={i.id} className="align-top hover:bg-gray-50">
                <td className="max-w-[460px] px-3 py-2">
                  <div className="mb-0.5 flex flex-wrap items-center gap-1">
                    {!captured && <span className={`ui-badge ui-badge--${sev(i.severity)}`}>{TYPE[i.type] || i.type}</span>}
                    {i.channel && <span className="ui-badge ui-badge--neutral">{CHANNEL[i.channel] || i.channel}</span>}
                    {i.status !== 'OPEN' && !captured && <span className="ui-badge ui-badge--ok">{i.status === 'RESOLVED' ? 'Resuelta' : 'Ignorada'}</span>}
                  </div>
                  <p className="font-medium text-gray-900">{i.title}</p>
                  {i.detail && <p className="text-xs text-gray-500">{i.detail}</p>}
                  {i.resolvedByName && i.status !== 'OPEN' && !captured && <p className="text-[11px] text-gray-400">{i.status === 'RESOLVED' ? 'Resuelta' : 'Ignorada'} por {i.resolvedByName} · {when(i.resolvedAt)}</p>}
                </td>
                <td className="px-3 py-2 text-xs">
                  <span className="block font-medium text-gray-800">{i.company.name}</span>
                  <span className="text-gray-500">{i.connection?.name || '—'}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{clp(i.amount)}</td>
                <td className="px-3 py-2 text-xs text-gray-600">
                  {when(i.firstSeenAt)}
                  {!captured && i.lastSeenAt !== i.firstSeenAt && <span className="block text-gray-400">visto {ago(i.lastSeenAt)}</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs font-medium">
                  <span className="flex flex-col items-end gap-1">
                    {i.orderId && <Link href={`/dashboard/orders/${i.orderId}`} className="text-[var(--brand)] hover:underline">Ver orden →</Link>}
                    {!captured && i.status === 'OPEN' && (
                      <>
                        <button type="button" onClick={() => setStatus(i, 'RESOLVED')} className="text-green-700 hover:underline">Marcar resuelta</button>
                        <button type="button" onClick={() => setStatus(i, 'IGNORED')} className="text-gray-500 hover:underline">Ignorar</button>
                      </>
                    )}
                    {!captured && i.status !== 'OPEN' && <button type="button" onClick={() => setStatus(i, 'OPEN')} className="text-gray-500 hover:underline">Reabrir</button>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-gray-400">
        Para ver una orden de otra empresa, primero elige esa empresa en &quot;Gestionando empresa&quot;. Las incidencias se cierran solas cuando dejan de ocurrir.
      </p>
      {pages > 1 && (
        <div className="mt-2 flex items-center justify-end gap-2 text-xs">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className={btnSecondary}>Anterior</button>
          <span className="text-gray-500">Página {page} de {pages}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className={btnSecondary}>Siguiente</button>
        </div>
      )}
    </div>
  );
}

function ConnectionsTab({ summary }: { summary: OrderAuditSummary | null }) {
  const rows = summary?.connections || [];
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full min-w-[860px] text-sm">
        <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-3 py-2">Empresa · cuenta</th>
            <th className="px-3 py-2">Canal</th>
            <th className="px-3 py-2 text-right">Revisadas</th>
            <th className="px-3 py-2 text-right">Captadas</th>
            <th className="px-3 py-2 text-right">Sin vincular</th>
            <th className="px-3 py-2 text-right">Estados corregidos</th>
            <th className="px-3 py-2 text-right">Captadas 30 días</th>
            <th className="px-3 py-2 text-right">Incidencias abiertas</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {!rows.length && <tr><td colSpan={8} className="p-6 text-center text-gray-400">Aún no hay una verificación terminada.</td></tr>}
          {rows.map((r) => (
            <tr key={r.connectionId} className={r.error ? 'bg-red-50/40' : ''}>
              <td className="px-3 py-2">
                <span className="block font-medium text-gray-900">{r.company}</span>
                <span className="text-xs text-gray-500">{r.connection}</span>
                {r.error && <span className="block text-xs text-red-600">⛔ {r.error}</span>}
                {r.truncated && <span className="block text-[11px] text-amber-600">Muchas ventas: se revisaron las más recientes</span>}
              </td>
              <td className="px-3 py-2 text-xs">{CHANNEL[r.marketplace] || r.marketplace}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.checked}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${r.imported ? 'font-semibold text-amber-700' : ''}`}>{r.imported}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${r.unlinked ? 'font-semibold text-red-600' : ''}`}>{r.unlinked}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.statusFixed}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.captured30d}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${r.openIssues ? 'font-semibold text-red-600' : 'text-green-700'}`}>{r.openIssues || '✓'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {summary?.lastDone && <p className="px-3 py-2 text-[11px] text-gray-400">Datos de la verificación del {when(summary.lastDone.finishedAt)} ({KIND[summary.lastDone.kind]}).</p>}
    </div>
  );
}

function RunsTab({ reload }: { reload: number }) {
  const [runs, setRuns] = useState<OrderAuditRun[] | null>(null);
  useEffect(() => {
    api.orderAudit.runs(getToken()!).then(setRuns).catch(() => setRuns([]));
  }, [reload]);
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-3 py-2">Inicio</th>
            <th className="px-3 py-2">Tipo</th>
            <th className="px-3 py-2 text-right">Cuentas</th>
            <th className="px-3 py-2 text-right">Ventas revisadas</th>
            <th className="px-3 py-2 text-right">Captadas</th>
            <th className="px-3 py-2 text-right">Estados corregidos</th>
            <th className="px-3 py-2 text-right">Incidencias nuevas</th>
            <th className="px-3 py-2 text-right">Cuentas con error</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {runs === null && <tr><td colSpan={8} className="p-6 text-center text-gray-400">Cargando…</td></tr>}
          {runs?.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-gray-400">Aún no hay verificaciones.</td></tr>}
          {runs?.map((r) => (
            <tr key={r.id}>
              <td className="px-3 py-2 text-xs">
                {when(r.startedAt)}
                {r.status === 'RUNNING' && <span className="ml-1 ui-badge ui-badge--info">En curso</span>}
                {r.status === 'FAILED' && <span className="ml-1 ui-badge ui-badge--danger">Falló</span>}
              </td>
              <td className="px-3 py-2 text-xs">{KIND[r.kind]}{r.createdByName ? ` · ${r.createdByName}` : ''}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.connections}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.ordersChecked}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${r.imported ? 'font-semibold text-amber-700' : ''}`}>{r.imported}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.statusFixed}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${r.newIssues ? 'font-semibold text-red-600' : ''}`}>{r.newIssues}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${r.errors ? 'text-red-600' : ''}`}>{r.errors}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

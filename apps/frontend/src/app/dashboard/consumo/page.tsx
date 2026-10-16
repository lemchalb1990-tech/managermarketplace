'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api, type CompanyConsumptionReport } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import { btnSecondary } from '@/components/ui/Modal';
import { SkeletonTable } from '@/components/Skeleton';

// Bytes → texto («850 KB», «12,4 MB», «2,1 GB»).
function bytes(n: number) {
  if (n < 1024 * 1024) return `${Math.round(n / 1024).toLocaleString('es-CL')} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toLocaleString('es-CL', { maximumFractionDigits: 1 })} MB`;
  return `${(n / 1024 ** 3).toLocaleString('es-CL', { maximumFractionDigits: 2 })} GB`;
}
const num = (n: number) => n.toLocaleString('es-CL');
const tableName = (t: string) => t.replace(/_/g, ' ');
type SortKey = 'totalBytes' | 'dbBytes' | 'fileBytes' | 'name';

// Consumo por empresa (Super Admin): base de datos estimada y archivos, calculado al abrir.
export default function ConsumptionPage() {
  const [report, setReport] = useState<CompanyConsumptionReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('totalBytes');
  const [q, setQ] = useState('');

  const load = useCallback(() => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    setError('');
    api.subscription.consumption(token)
      .then(setReport)
      .catch((e) => setError((e as Error).message || 'No se pudo calcular el consumo.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(load);
    return () => cancelAnimationFrame(id);
  }, [load]);

  const rows = useMemo(() => {
    const list = (report?.companies ?? []).filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()));
    return [...list].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : b[sort] - a[sort]));
  }, [report, sort, q]);

  const p = report?.platform;
  const attributedTotal = (report?.companies ?? []).reduce((s, c) => s + c.totalBytes, 0);
  const th = (key: SortKey, label: string, right = true) => (
    <th className={`px-3 py-2.5 font-medium ${right ? 'text-right' : 'text-left'}`}>
      <button type="button" onClick={() => setSort(key)} className={`hover:text-[var(--text)] ${sort === key ? 'text-[var(--text)] underline' : ''}`}>{label}</button>
    </th>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Consumo por empresa"
        crumbs={[{ label: 'Administrador de plataforma' }, { label: 'Consumo por empresa' }]}
        actions={<button type="button" onClick={load} disabled={loading} className={btnSecondary}>{loading ? 'Calculando…' : 'Recalcular'}</button>}
      />

      {p && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="ui-card p-4">
            <p className="ui-stat-label">Base de datos (total real)</p>
            <p className="ui-stat-value text-[var(--text)]">{bytes(p.dbBytes)}</p>
            <p className="text-[11px] text-[var(--text-muted)] mt-1">{bytes(p.systemBytes)} del sistema, sin empresa</p>
          </div>
          <div className="ui-card p-4">
            <p className="ui-stat-label">Archivos registrados</p>
            <p className="ui-stat-value text-[var(--text)]">{bytes(p.fileBytes)}</p>
            <p className="text-[11px] text-[var(--text-muted)] mt-1">Fotos y documentos subidos</p>
          </div>
          <div className="ui-card p-4">
            <p className="ui-stat-label">Empresas</p>
            <p className="ui-stat-value text-[var(--text)]">{num(p.companies)}</p>
          </div>
          <div className="ui-card p-4">
            <p className="ui-stat-label">Calculado</p>
            <p className="text-sm font-semibold text-[var(--text)] mt-1">{new Date(report!.generatedAt).toLocaleString('es-CL')}</p>
            <p className="text-[11px] text-[var(--text-muted)] mt-1">Compáralo con el plan de Supabase</p>
          </div>
        </div>
      )}

      <div className="ui-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-[var(--border-soft)]">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar empresa"
            className="w-full sm:w-64 px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
          <p className="text-[11px] text-[var(--text-muted)]">Base de datos estimada por proporción de filas; archivos exactos.</p>
        </div>
        {error && <p className="px-4 py-3 text-sm text-[var(--danger)]">{error}</p>}
        {!report && !error ? <SkeletonTable rows={8} cols={7} /> : report && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-xs text-[var(--text-muted)] bg-gray-50">
                <tr>
                  {th('name', 'Empresa', false)}
                  <th className="px-3 py-2.5 font-medium text-left">Plan</th>
                  {th('dbBytes', 'Base de datos')}
                  {th('fileBytes', 'Archivos')}
                  {th('totalBytes', 'Total')}
                  <th className="px-3 py-2.5 font-medium text-right">% del total</th>
                  <th className="px-3 py-2.5 font-medium text-right">Productos · Publicaciones · Ventas</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <Fragment key={c.id}>
                    <tr onClick={() => setOpen(open === c.id ? null : c.id)}
                      className="border-t border-[var(--border-soft)] cursor-pointer hover:bg-gray-50">
                      <td className="px-3 py-2.5">
                        <span className="text-[var(--text-muted)] mr-1.5">{open === c.id ? '▾' : '▸'}</span>
                        <span className="font-medium text-[var(--text)]">{c.name}</span>
                        {!c.active && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">Inactiva</span>}
                      </td>
                      <td className="px-3 py-2.5 text-[var(--text-2)]">{c.plan ?? 'Sin plan'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">~{bytes(c.dbBytes)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{bytes(c.fileBytes)}<span className="text-[11px] text-[var(--text-muted)]"> · {num(c.files)}</span></td>
                      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap font-semibold">{bytes(c.totalBytes)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{attributedTotal ? `${((c.totalBytes / attributedTotal) * 100).toLocaleString('es-CL', { maximumFractionDigits: 1 })}%` : '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-[var(--text-2)]">{num(c.products)} · {num(c.listings)} · {num(c.sales)}</td>
                    </tr>
                    {open === c.id && (
                      <tr className="bg-gray-50/60">
                        <td colSpan={7} className="px-6 py-3">
                          <p className="text-xs font-semibold text-[var(--text)] mb-2">Tablas que más pesan</p>
                          {c.topTables.length === 0 ? <p className="text-xs text-[var(--text-muted)]">Sin datos.</p> : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                              {c.topTables.map((t) => (
                                <div key={t.table} className="rounded-lg border border-[var(--border-soft)] bg-white px-3 py-2">
                                  <p className="text-xs font-medium text-[var(--text)] truncate">{tableName(t.table)}</p>
                                  <p className="text-[11px] text-[var(--text-muted)]">{num(t.rows)} filas · ~{bytes(t.bytes)}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

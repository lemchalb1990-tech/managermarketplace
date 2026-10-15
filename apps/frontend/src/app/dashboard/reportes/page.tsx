'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api, type SalesReport, type SalesReportType } from '@/lib/api';
import { PageHeader, SectionCard } from '@/components/ui';
import { SkeletonTable } from '@/components/Skeleton';
import { useAdminCompany } from '../AdminCompanyContext';
import { ReportTable } from './ReportTable';
import { ReportSchedules } from './ReportSchedules';

// Reportes de ventas listos: ocho informes que se abren con un toque y se descargan en Excel o PDF.
const REPORTS: { type: SalesReportType; icon: string; title: string; hint: string }[] = [
  { type: 'producto', icon: '📦', title: 'Ventas por producto', hint: 'Ranking por unidades, ingresos y ganancia' },
  { type: 'categoria', icon: '🗂️', title: 'Ventas por categoría', hint: 'Qué líneas de producto venden más' },
  { type: 'canal', icon: '🛒', title: 'Ventas por canal', hint: 'Comisión, envío y neto de cada canal' },
  { type: 'vendedor', icon: '👤', title: 'Ventas por vendedor', hint: 'Para comisiones del punto de venta' },
  { type: 'pago', icon: '💳', title: 'Ventas por medio de pago', hint: 'Cuadra con caja y cartolas' },
  { type: 'comuna', icon: '📍', title: 'Ventas por comuna', hint: 'Dónde están tus compradores' },
  { type: 'mes', icon: '📅', title: 'Evolución mensual', hint: 'Mes a mes en el período' },
  { type: 'libro', icon: '📒', title: 'Libro de ventas', hint: 'Detalle por venta con boleta o factura' },
];

type Preset = '7d' | '30d' | 'mes' | 'mes-ant' | '12m' | 'custom';
const PRESETS: { key: Preset; label: string }[] = [
  { key: '7d', label: '7 días' }, { key: '30d', label: '30 días' }, { key: 'mes', label: 'Este mes' },
  { key: 'mes-ant', label: 'Mes anterior' }, { key: '12m', label: '12 meses' }, { key: 'custom', label: 'Personalizado' },
];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function rangeOf(p: Preset): { from: string; to: string } | null {
  const now = new Date();
  const back = (days: number) => { const d = new Date(now); d.setDate(d.getDate() - days); return iso(d); };
  if (p === '7d') return { from: back(6), to: iso(now) };
  if (p === '30d') return { from: back(29), to: iso(now) };
  if (p === 'mes') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  if (p === 'mes-ant') return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) };
  if (p === '12m') return { from: iso(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() + 1)), to: iso(now) };
  return null;
}
const dmy = (k: string) => k.split('-').reverse().join('-');

export default function SalesReportsPage() {
  const { isSuperAdmin, selectedCompanyId, companyId } = useAdminCompany();
  const noCompany = isSuperAdmin && !selectedCompanyId;
  const [type, setType] = useState<SalesReportType>('producto');
  const [preset, setPreset] = useState<Preset>('30d');
  const [custom, setCustom] = useState(() => rangeOf('30d')!);
  const [report, setReport] = useState<SalesReport | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [page, setPage] = useState(1);

  const range = preset === 'custom' ? custom : rangeOf(preset)!;
  const params = { type, from: range.from, to: range.to, companyId: isSuperAdmin ? companyId : undefined };

  // Al cambiar de reporte o de período se vuelve a la primera página.
  const pageKey = `${type}|${range.from}|${range.to}|${companyId}`;
  const [lastKey, setLastKey] = useState(pageKey);
  if (lastKey !== pageKey) { setLastKey(pageKey); setPage(1); }

  useEffect(() => {
    const token = getToken();
    if (!token || noCompany) return;
    let alive = true;
    const t = setTimeout(() => {
      setLoading(true);
      setError('');
      api.reports.sales({ type, from: range.from, to: range.to, companyId: isSuperAdmin ? companyId : undefined, page }, token)
        .then((r) => { if (alive) setReport(r); })
        .catch((e) => { if (alive) { setReport(null); setError(e.message || 'No se pudo generar el reporte.'); } })
        .finally(() => { if (alive) setLoading(false); });
    }, 150);
    return () => { alive = false; clearTimeout(t); };
  }, [type, range.from, range.to, companyId, isSuperAdmin, noCompany, page]);

  async function downloadExcel() {
    setDownloading(true);
    try { await api.reports.salesExcel(params, getToken()!); } catch (e) { setError((e as Error).message || 'No se pudo descargar.'); }
    setDownloading(false);
  }
  function openPdf() {
    const q = new URLSearchParams({ type, from: range.from, to: range.to, ...(params.companyId ? { companyId: params.companyId } : {}) });
    window.open(`/imprimir/reporte?${q.toString()}`, '_blank');
  }

  const current = REPORTS.find((r) => r.type === type)!;

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title="Reportes Detalles de Ventas" crumbs={[{ label: 'Ventas' }, { label: 'Reportes Detalles de Ventas' }]} />

      {noCompany ? (
        <p className="text-sm text-[var(--text-muted)]">Selecciona una empresa (arriba, «Gestionando empresa») para ver sus reportes.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {REPORTS.map((r) => (
              <button key={r.type} type="button" onClick={() => setType(r.type)} aria-pressed={type === r.type}
                className={`ui-card text-left p-3.5 flex gap-3 items-start transition-colors ${type === r.type ? '!border-[var(--brand)] ring-2 ring-[var(--brand-soft)]' : 'hover:!border-[var(--brand)]'}`}>
                <span className="w-9 h-9 rounded-lg bg-[var(--brand-light)] grid place-items-center text-base shrink-0" aria-hidden="true">{r.icon}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[var(--text)]">{r.title}</span>
                  <span className="block text-xs text-[var(--text-muted)]">{r.hint}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="inline-flex flex-wrap gap-0.5 bg-[#f1efea] rounded-lg p-0.5" role="group" aria-label="Período">
              {PRESETS.map((p) => (
                <button key={p.key} type="button" onClick={() => setPreset(p.key)} aria-pressed={preset === p.key}
                  className={`px-2.5 py-1.5 rounded-md text-xs ${preset === p.key ? 'bg-white text-[var(--text)] font-semibold shadow-sm' : 'text-[var(--text-2)]'}`}>
                  {p.label}
                </button>
              ))}
            </div>
            {preset === 'custom' && (
              <div className="flex items-end gap-2">
                <label className="text-xs text-[var(--text-muted)]">Desde
                  <input type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))}
                    className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white" />
                </label>
                <label className="text-xs text-[var(--text-muted)]">Hasta
                  <input type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))}
                    className="block border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white" />
                </label>
              </div>
            )}
          </div>

          <SectionCard
            title={<>{current.title} <span className="font-normal text-[var(--text-muted)]">· {dmy(range.from)} al {dmy(range.to)}</span></>}
            actions={
              <div className="flex gap-2">
                <button type="button" onClick={downloadExcel} disabled={downloading || !report} className="ui-btn-secondary !py-1.5 text-xs disabled:opacity-50">{downloading ? 'Descargando…' : 'Excel'}</button>
                <button type="button" onClick={openPdf} disabled={!report} className="ui-btn-secondary !py-1.5 text-xs disabled:opacity-50">PDF</button>
              </div>
            }
          >
            {error ? (
              <p className="text-sm text-[var(--danger)]">{error}</p>
            ) : !report || loading ? (
              <SkeletonTable rows={6} cols={5} />
            ) : (report.rowCount ?? report.rows.length) === 0 ? (
              <p className="text-sm text-[var(--text-muted)] text-center py-8">No hay ventas en este período.</p>
            ) : (
              <>
                <div className="overflow-x-auto -mx-3 sm:-mx-5">
                  <ReportTable report={report} />
                </div>
                {(report.pages ?? 1) > 1 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 mt-3 text-xs text-[var(--text-muted)]">
                    <span>
                      {((report.page! - 1) * 25 + 1).toLocaleString('es-CL')}–{Math.min(report.page! * 25, report.rowCount!).toLocaleString('es-CL')} de {report.rowCount!.toLocaleString('es-CL')} filas · el total suma todas
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button type="button" onClick={() => setPage(1)} disabled={report.page === 1} className="ui-btn-secondary !py-1 !px-2 text-xs disabled:opacity-40" aria-label="Primera página">«</button>
                      <button type="button" onClick={() => setPage(report.page! - 1)} disabled={report.page === 1} className="ui-btn-secondary !py-1 !px-2.5 text-xs disabled:opacity-40">Anterior</button>
                      <span className="px-1 text-[var(--text-2)]">Página {report.page} de {report.pages}</span>
                      <button type="button" onClick={() => setPage(report.page! + 1)} disabled={report.page === report.pages} className="ui-btn-secondary !py-1 !px-2.5 text-xs disabled:opacity-40">Siguiente</button>
                      <button type="button" onClick={() => setPage(report.pages!)} disabled={report.page === report.pages} className="ui-btn-secondary !py-1 !px-2 text-xs disabled:opacity-40" aria-label="Última página">»</button>
                    </div>
                  </div>
                )}
                {report.truncated && <p className="text-xs text-[var(--warn)] mt-3">El período tiene demasiadas ventas: se consideraron las 50.000 más recientes. Acota las fechas para un resultado completo.</p>}
                {type !== 'libro' && type !== 'pago' && (
                  <p className="text-[11px] text-[var(--text-muted)] mt-3">
                    Ventas brutas: lo cobrado. Neto recibido: lo que queda después de comisiones, envío e impuestos de cada canal (en el punto de venta, el total).
                    {report.columns.some((c) => c.key === 'ganancia') && ' Ganancia: neto recibido menos el costo de lo vendido.'}
                  </p>
                )}
                {type === 'libro' && <p className="text-[11px] text-[var(--text-muted)] mt-3">Neto e IVA calculados sobre el total con IVA del 19 % (las facturas exentas van sin IVA).</p>}
              </>
            )}
          </SectionCard>

          <ReportSchedules type={type} titles={Object.fromEntries(REPORTS.map((r) => [r.type, r.title])) as Record<SalesReportType, string>} companyId={isSuperAdmin ? companyId : undefined} />
        </>
      )}
    </div>
  );
}

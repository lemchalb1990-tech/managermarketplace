import type { SalesReport } from '@/lib/api';

// Tabla de un reporte de ventas (pantalla y vista para PDF).
export function formatReportCell(kind: string, v: string | number | undefined) {
  if (v === undefined || v === '') return '';
  if (typeof v !== 'number') return v;
  if (kind === 'money') return `$${Math.round(v).toLocaleString('es-CL')}`;
  if (kind === 'int') return Math.round(v).toLocaleString('es-CL');
  if (kind === 'pct') return `${(v * 100).toFixed(1).replace('.', ',')} %`;
  return String(v);
}

export function ReportTable({ report, compact = false }: { report: SalesReport; compact?: boolean }) {
  const pad = compact ? 'px-2 py-1' : 'px-3 py-2';
  return (
    <table className={`w-full ${compact ? 'text-[11px]' : 'text-sm'}`}>
      <thead>
        <tr className="text-xs text-[var(--text-muted)] border-b border-[var(--border-soft)]">
          {report.columns.map((c) => (
            <th key={c.key} className={`${pad} font-medium whitespace-nowrap ${c.kind === 'text' ? 'text-left' : 'text-right'}`}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--border-soft)]">
        {report.rows.map((r, i) => (
          <tr key={i}>
            {report.columns.map((c, j) => (
              <td key={c.key} className={`${pad} tabular-nums ${c.kind === 'text' ? `text-left ${j === 0 ? 'text-[var(--text)] max-w-[320px] truncate' : 'text-[var(--text-2)] whitespace-nowrap'}` : 'text-right whitespace-nowrap'}`}
                title={j === 0 ? String(r[c.key] ?? '') : undefined}>
                {formatReportCell(c.kind, r[c.key])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-[var(--border)] font-semibold">
          {report.columns.map((c, j) => (
            <td key={c.key} className={`${pad} tabular-nums whitespace-nowrap ${c.kind === 'text' ? 'text-left' : 'text-right'}`}>
              {j === 0 ? 'Total' : formatReportCell(c.kind, report.totals[c.key])}
            </td>
          ))}
        </tr>
      </tfoot>
    </table>
  );
}

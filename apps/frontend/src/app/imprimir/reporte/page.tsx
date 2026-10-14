'use client';

import { useEffect, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api, type SalesReport, type SalesReportType } from '@/lib/api';
import { SkeletonDetail } from '@/components/Skeleton';
import { PrintButton } from '../printLayout';
import { ReportTable } from '@/app/dashboard/reportes/ReportTable';

// Reporte de ventas en hoja carta, para imprimir o guardar como PDF desde el navegador.
export default function PrintReportPage() {
  const [report, setReport] = useState<SalesReport | null>(null);
  const [company, setCompany] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    const q = new URLSearchParams(window.location.search);
    if (!token) { queueMicrotask(() => setError('Sesión no encontrada. Abre esta página desde el panel.')); return; }
    const companyId = q.get('companyId') || undefined;
    api.reports.sales({ type: (q.get('type') || 'producto') as SalesReportType, from: q.get('from') || undefined, to: q.get('to') || undefined, companyId }, token)
      .then(async (r) => {
        const user = getUser();
        let name = user?.company?.name || '';
        if (companyId) name = (await api.billing.profile.get(token, companyId).catch(() => null))?.companyName || name;
        setCompany(name);
        setReport(r);
        setTimeout(() => window.print(), 400);
      })
      .catch((e) => setError(e.message || 'No se pudo generar el reporte.'));
  }, []);

  if (error) return <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#b91c1c' }}>{error}</div>;
  if (!report) return <div style={{ padding: 40 }}><SkeletonDetail /></div>;
  const dmy = (k: string) => k.split('-').reverse().join('-');

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', color: '#0f172a', maxWidth: 960, margin: '0 auto', padding: 32, background: '#fff' }}>
      <style>{'@media print { .no-print { display: none !important; } body { margin: 0; } @page { margin: 12mm; } } table { border-collapse: collapse; }'}</style>
      <PrintButton align="right" />
      <div style={{ borderBottom: '2px solid #0f172a', paddingBottom: 12, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>{report.title}</h1>
          {company && <p style={{ margin: '4px 0 0', fontSize: 13, color: '#475569' }}>{company}</p>}
        </div>
        <p style={{ margin: 0, fontSize: 13, color: '#475569' }}>Del {dmy(report.from)} al {dmy(report.to)}</p>
      </div>
      <ReportTable report={report} compact />
      <p style={{ marginTop: 16, fontSize: 10, color: '#94a3b8' }}>Generado el {new Date().toLocaleString('es-CL')}.</p>
    </div>
  );
}

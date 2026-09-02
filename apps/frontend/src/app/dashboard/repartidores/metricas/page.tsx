'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { PageHeader, SectionCard, StatRow, StatTile, Badge } from '@/components/ui';

const OUTCOME_LABEL: Record<string, string> = {
  DELIVERED: 'Entregado', ABSENT: 'Cliente ausente', REFUSED: 'Rechazado',
  RESCHEDULED: 'Reprogramado', LOST: 'Extraviado', RETURNED: 'Devuelto a bodega', PENDING: 'Pendiente',
};

export default function MetricasPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  async function load() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      setData(await api.drivers.metrics(token, { from: from || undefined, to: to || undefined }));
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const maxWk = Math.max(1, ...((data?.weekly || []).map((w: any) => w.onTime + w.late)));

  return (
    <div>
      <PageHeader
        title="Métricas"
        crumbs={[{ label: 'Inicio', href: '/dashboard' }, { label: 'Repartidores' }, { label: 'Métricas' }]}
        actions={
          <form onSubmit={(e) => { e.preventDefault(); load(); }} className="flex gap-2">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-2 py-1.5 border border-[var(--border)] rounded-lg text-sm" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-2 py-1.5 border border-[var(--border)] rounded-lg text-sm" />
            <button className="px-3 py-1.5 border border-[var(--border)] rounded-lg text-sm text-[var(--text-2)] hover:bg-[var(--surface-soft)]">Ver</button>
          </form>
        }
      />

      {loading ? (
        <p className="text-sm text-[var(--text-muted)] py-8 text-center">Cargando…</p>
      ) : data && (
        <div className="space-y-5">
          <StatRow>
            <StatTile label="Intentos de entrega" value={data.totals.attempts} />
            <StatTile label="Entregas" value={data.totals.delivered} tone="ok" />
            <StatTile label="Con demora" value={data.totals.late} tone={data.totals.late > 0 ? 'warn' : undefined} />
            <StatTile label="A tiempo" value={data.totals.onTimeRate == null ? '—' : `${data.totals.onTimeRate}%`}
              tone={data.totals.onTimeRate != null && data.totals.onTimeRate >= 90 ? 'ok' : 'warn'} />
          </StatRow>

          <SectionCard title="Resultado de las paradas">
            <div className="flex flex-wrap gap-2">
              {Object.entries(data.byOutcome).map(([k, v]) => (
                <Badge key={k} tone={k === 'DELIVERED' ? 'ok' : k === 'PENDING' ? 'neutral' : 'warn'}>
                  {OUTCOME_LABEL[k] || k}: {v as number}
                </Badge>
              ))}
              {Object.keys(data.byOutcome).length === 0 && <p className="text-sm text-[var(--text-muted)]">Sin datos en el rango</p>}
            </div>
          </SectionCard>

          <SectionCard title="Entregas a tiempo por semana">
            {data.weekly.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">Sin semanas cerradas en el rango</p>
            ) : (
              <div className="flex items-end gap-3 h-40">
                {data.weekly.map((w: any) => {
                  const tot = w.onTime + w.late;
                  return (
                    <div key={w.week} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-xs text-[var(--text-2)]">{w.rate}%</span>
                      <div className="w-full flex flex-col justify-end rounded-md overflow-hidden bg-[var(--border-soft)]" style={{ height: `${(tot / maxWk) * 100}%`, minHeight: 6 }}>
                        <div className="bg-[var(--danger)]" style={{ height: `${tot ? (w.late / tot) * 100 : 0}%` }} />
                        <div className="bg-[var(--ok)]" style={{ height: `${tot ? (w.onTime / tot) * 100 : 100}%` }} />
                      </div>
                      <span className="text-[10px] text-[var(--text-muted)]">{w.week.slice(5)}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-[var(--text-muted)] mt-2">Verde: a tiempo · Rojo: con demora (vs. fecha programada del pedido).</p>
          </SectionCard>
        </div>
      )}
    </div>
  );
}

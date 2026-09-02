'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { PageHeader, SectionCard, Badge } from '@/components/ui';

const LEVEL: Record<string, { label: string; tone: 'danger' | 'warn' | 'neutral'; bar: string }> = {
  alta: { label: 'Alta demanda', tone: 'danger', bar: 'var(--danger)' },
  media: { label: 'Media demanda', tone: 'warn', bar: 'var(--warn)' },
  baja: { label: 'Baja demanda', tone: 'neutral', bar: 'var(--brand)' },
};

export default function ZonasPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  async function load() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      setData(await api.drivers.zones(token, { from: from || undefined, to: to || undefined }));
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const max = data?.zones?.[0]?.total || 1;

  return (
    <div>
      <PageHeader
        title="Zonas de demanda"
        crumbs={[{ label: 'Inicio', href: '/dashboard' }, { label: 'Repartidores' }, { label: 'Zonas de demanda' }]}
        actions={
          <form onSubmit={(e) => { e.preventDefault(); load(); }} className="flex gap-2">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-2 py-1.5 border border-[var(--border)] rounded-lg text-sm" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-2 py-1.5 border border-[var(--border)] rounded-lg text-sm" />
            <button className="px-3 py-1.5 border border-[var(--border)] rounded-lg text-sm text-[var(--text-2)] hover:bg-[var(--surface-soft)]">Ver</button>
          </form>
        }
      />

      {!loading && data && !data.mapsKey && (
        <div className="mb-4 px-4 py-3 rounded-lg text-sm text-[var(--warn)] bg-[var(--warn-bg)]">
          Configura la <strong>API Key de Google Maps</strong> en Configuración para habilitar el mapa. Mientras tanto ves el ranking por comuna.
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[var(--text-muted)] py-8 text-center">Cargando…</p>
      ) : (
        <SectionCard title={`Comunas por demanda (${data?.zones?.length || 0})`}>
          {(!data?.zones || data.zones.length === 0) ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-6">Sin pedidos con comuna en el rango</p>
          ) : (
            <div className="space-y-2">
              {data.zones.map((z: any) => {
                const lv = LEVEL[z.level];
                return (
                  <div key={z.commune} className="flex items-center gap-3">
                    <div className="w-40 shrink-0 text-sm text-[var(--text)] truncate">{z.commune}</div>
                    <div className="flex-1 h-5 rounded bg-[var(--border-soft)] overflow-hidden">
                      <div className="h-full rounded" style={{ width: `${(z.total / max) * 100}%`, background: lv.bar }} />
                    </div>
                    <div className="w-16 text-right text-sm text-[var(--text-2)]">{z.total}</div>
                    <Badge tone={lv.tone}>{lv.label}</Badge>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}

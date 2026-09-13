'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api, imgUrl } from '@/lib/api';
import { PageHeader, SectionCard, StatTile, StatRow, Badge } from '@/components/ui';
import { useMlCompany } from '../MlCompanyContext';
import { ProductThumb, PhotoLightbox, type LightboxImage } from '../PhotoLightbox';
import { useDashboardTimezone } from '@/lib/dashboardTimezone';

const RATING_LABEL: Record<string, { label: string; tone: 'ok' | 'warn' | 'danger' }> = {
  POSITIVE: { label: 'Positiva', tone: 'ok' },
  NEUTRAL: { label: 'Neutra', tone: 'warn' },
  NEGATIVE: { label: 'Negativa', tone: 'danger' },
};

const LEVEL_COLOR: Record<string, string> = {
  '5_green': 'var(--ok)',
  '4_light_green': 'var(--ok)',
  '3_yellow': 'var(--warn)',
  '2_orange': 'var(--warn)',
  '1_red': 'var(--danger)',
};

export default function MlCalificacionesPage() {
  const { companyId } = useMlCompany();
  const tz = useDashboardTimezone();
  const [connections, setConnections] = useState<any[]>([]);
  const [connId, setConnId] = useState('');
  const [reputation, setReputation] = useState<any>(null);
  const [feedback, setFeedback] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lightbox, setLightbox] = useState<LightboxImage>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    setError('');
    api.marketplace.connections(token, companyId).then((conns) => {
      setConnections(conns);
      setConnId(conns[0]?.id || '');
    }).catch((err: any) => setError(err.message || 'No se pudieron cargar las conexiones.'));
    api.marketplace.feedback(token, companyId).then(setFeedback)
      .catch((err: any) => setError(err.message || 'No se pudieron cargar las calificaciones.'))
      .finally(() => setLoading(false));
  }, [companyId]);

  useEffect(() => {
    if (!connId) return;
    const token = getToken();
    if (!token) return;
    api.marketplace.reputation(connId, token).then(setReputation).catch(() => setReputation(null));
  }, [connId]);

  const counts = { POSITIVE: 0, NEUTRAL: 0, NEGATIVE: 0 } as Record<string, number>;
  feedback.forEach((f) => { if (f.mlFeedbackRating) counts[f.mlFeedbackRating] = (counts[f.mlFeedbackRating] || 0) + 1; });

  return (
    <div>
      <PageHeader
        title="Calificaciones de Mercado Libre"
        crumbs={[{ label: 'Inicio', href: '/dashboard' }, { label: 'Mercado Libre' }, { label: 'Calificaciones' }]}
      />
      <p className="text-sm text-[var(--text-2)] -mt-3 mb-5 max-w-2xl">
        Reputación del vendedor y calificación que dejan los compradores tras la compra — ambas
        de solo lectura, tal como las expone Mercado Libre.
      </p>

      {error && (
        <div className="mb-4 px-4 py-2 rounded-lg text-sm text-[var(--danger)] bg-[var(--danger-bg)]">{error}</div>
      )}

      {connections.length > 1 && (
        <select value={connId} onChange={(e) => setConnId(e.target.value)}
          className="mb-4 px-2.5 py-1.5 border border-[var(--border)] rounded-lg text-xs bg-white">
          {connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}

      <SectionCard title="Termómetro de reputación" className="mb-5">
        {!reputation ? (
          <p className="text-sm text-[var(--text-muted)] py-2">Sin datos de reputación disponibles todavía.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-3">
              <span className="w-4 h-4 rounded-full shrink-0" style={{ background: LEVEL_COLOR[reputation.level_id] || 'var(--text-muted)' }} />
              <div>
                <p className="text-sm font-semibold text-[var(--text)]">{reputation.level_id || 'Sin nivel'}</p>
                <p className="text-xs text-[var(--text-muted)]">Nivel de reputación</p>
              </div>
            </div>
            {reputation.power_seller_status && (
              <Badge tone="ok">Mercado Líder {reputation.power_seller_status}</Badge>
            )}
            {reputation.metrics?.claims?.rate != null && (
              <div>
                <p className="text-sm font-semibold text-[var(--text)]">{(reputation.metrics.claims.rate * 100).toFixed(1)}%</p>
                <p className="text-xs text-[var(--text-muted)]">Reclamos</p>
              </div>
            )}
            {reputation.metrics?.cancellations?.rate != null && (
              <div>
                <p className="text-sm font-semibold text-[var(--text)]">{(reputation.metrics.cancellations.rate * 100).toFixed(1)}%</p>
                <p className="text-xs text-[var(--text-muted)]">Cancelaciones</p>
              </div>
            )}
            {reputation.transactions?.total != null && (
              <div>
                <p className="text-sm font-semibold text-[var(--text)]">{reputation.transactions.total}</p>
                <p className="text-xs text-[var(--text-muted)]">Ventas totales</p>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      <StatRow>
        <StatTile label="Positivas" value={counts.POSITIVE} tone="ok" />
        <StatTile label="Neutras" value={counts.NEUTRAL} tone="warn" />
        <StatTile label="Negativas" value={counts.NEGATIVE} tone="danger" />
      </StatRow>

      <h2 className="text-sm font-semibold text-[var(--text)] mt-6 mb-3">Calificaciones recientes de compradores</h2>
      {loading ? (
        <p className="text-sm text-[var(--text-muted)] py-8 text-center">Cargando…</p>
      ) : feedback.length === 0 ? (
        <SectionCard><p className="text-sm text-[var(--text-muted)] text-center py-6">Sin calificaciones registradas todavía</p></SectionCard>
      ) : (
        <div className="space-y-3">
          {feedback.map((f) => {
            const r = RATING_LABEL[f.mlFeedbackRating] || { label: f.mlFeedbackRating, tone: 'neutral' as const };
            const product = f.items?.[0]?.product;
            const photoUrl = product?.images?.[0]?.url ? imgUrl(product.images[0].url) : undefined;
            const cardTitle = `Orden ${f.externalId || f.id.slice(-6).toUpperCase()}`;
            return (
              <SectionCard key={f.id}
                title={
                  <span className="flex items-center gap-2.5">
                    <ProductThumb url={photoUrl} alt={product?.name || cardTitle} onClick={() => setLightbox({ url: photoUrl!, alt: product?.name || cardTitle })} />
                    {cardTitle}
                  </span>
                }
                actions={<Badge tone={r.tone}>{r.label}</Badge>}>
                <p className="text-xs text-[var(--text-muted)] -mt-2 mb-2">
                  {f.mlFeedbackAt ? new Date(f.mlFeedbackAt).toLocaleString('es-CL', { timeZone: tz }) : ''}
                </p>
                {f.mlFeedbackComment ? (
                  <p className="text-sm text-[var(--text)]">"{f.mlFeedbackComment}"</p>
                ) : (
                  <p className="text-sm text-[var(--text-muted)] italic">Sin comentario</p>
                )}
              </SectionCard>
            );
          })}
        </div>
      )}

      <PhotoLightbox image={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

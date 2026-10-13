'use client';

import { useEffect, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api, imgUrl } from '@/lib/api';
import { PageHeader, SectionCard, StatRow, StatTile, Badge, BrandButton } from '@/components/ui';
import { useMlCompany } from '../MlCompanyContext';
import { ProductThumb, PhotoLightbox, type LightboxImage } from '../PhotoLightbox';
import { useDashboardTimezone } from '@/lib/dashboardTimezone';
import { onActivity } from '@/lib/activityBus';
import { SkeletonList } from '@/components/Skeleton';

const TABS = [
  { key: 'UNANSWERED', label: 'Sin responder' },
  { key: 'ANSWERED', label: 'Respondidas' },
  { key: 'ALL', label: 'Todas' },
] as const;

export default function MlPreguntasPage() {
  const { companyId } = useMlCompany();
  const tz = useDashboardTimezone();
  const [tab, setTab] = useState<typeof TABS[number]['key']>('UNANSWERED');
  const [data, setData] = useState<{ questions: any[]; unanswered: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // "Actualizar desde Mercado Libre" es solo para administradores (empresa y Super Admin).
  const [canRefresh, setCanRefresh] = useState(false);
  useEffect(() => { const r = getUser()?.role; setCanRefresh(r === 'SUPER_ADMIN' || r === 'COMPANY_ADMIN'); }, []);
  const [flash, setFlash] = useState<{ msg: string; ok: boolean } | null>(null);
  const [lightbox, setLightbox] = useState<LightboxImage>(null);

  async function load() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      setData(await api.marketplace.questions(token, tab, companyId));
    } catch (err: any) {
      setFlash({ msg: err.message || 'No se pudieron cargar las preguntas.', ok: false });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab, companyId]);
  useEffect(() => onActivity(['question'], load), [tab, companyId]);

  // Publicación de ML: la guardada en la vinculación o, si no hay, la dirección estándar del ítem.
  function itemUrl(q: any) {
    if (q.itemUrl) return q.itemUrl;
    const m = /^([A-Z]{3})(\d+)$/.exec(q.itemId || '');
    return m ? `https://articulo.mercadolibre.cl/${m[1]}-${m[2]}-_JM` : null;
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const { refreshed } = await api.marketplace.refreshQuestions(getToken()!, companyId);
      await load();
      setFlash({ msg: refreshed ? `${refreshed} pregunta(s) actualizada(s) desde Mercado Libre` : 'Todo al día: las preguntas sin responder siguen sin respuesta en Mercado Libre', ok: true });
    } catch (err: any) {
      setFlash({ msg: err.message || 'No se pudo actualizar desde Mercado Libre.', ok: false });
    } finally {
      setRefreshing(false);
      setTimeout(() => setFlash(null), 4000);
    }
  }

  async function answer(externalId: string) {
    const text = (drafts[externalId] || '').trim();
    if (!text) return;
    setBusyId(externalId);
    try {
      await api.marketplace.answerQuestion(externalId, text, getToken()!);
      setDrafts((d) => { const n = { ...d }; delete n[externalId]; return n; });
      await load();
      setFlash({ msg: 'Respuesta enviada', ok: true });
      setTimeout(() => setFlash(null), 2000);
    } catch (err: any) {
      setFlash({ msg: err.message, ok: false });
      setTimeout(() => setFlash(null), 3000);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Preguntas de Mercado Libre"
        crumbs={[{ label: 'Inicio', href: '/dashboard' }, { label: 'Mercado Libre' }, { label: 'Preguntas' }]}
      />

      {data && (
        <StatRow>
          <StatTile label="Sin responder" value={data.unanswered} tone={data.unanswered > 0 ? 'warn' : undefined} />
        </StatRow>
      )}

      <div className="flex flex-wrap items-center gap-2 my-4">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium ${tab === t.key ? 'bg-[var(--brand-light)] text-[var(--brand-ink)]' : 'text-[var(--text-2)] hover:bg-[var(--surface-soft)]'}`}>
            {t.label}
          </button>
        ))}
        {canRefresh && (
        <button onClick={refresh} disabled={refreshing}
          className="ml-auto px-3.5 py-1.5 rounded-lg text-sm font-medium border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-soft)] disabled:opacity-60">
          {refreshing ? 'Actualizando…' : 'Actualizar desde Mercado Libre'}
        </button>
        )}
      </div>

      {flash && (
        <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${flash.ok ? 'text-[var(--ok)] bg-[var(--ok-bg)]' : 'text-[var(--danger)] bg-[var(--danger-bg)]'}`}>{flash.msg}</div>
      )}

      {loading ? (
        <SkeletonList count={5} avatar />
      ) : (data?.questions || []).length === 0 ? (
        <SectionCard><p className="text-sm text-[var(--text-muted)] text-center py-6">Sin preguntas para mostrar</p></SectionCard>
      ) : (
        <div className="space-y-3">
          {data!.questions.map((q: any) => {
            const photoUrl = q.product?.images?.[0]?.url ? imgUrl(q.product.images[0].url) : undefined;
            const productName = q.product?.name || q.itemTitle || q.itemId;
            return (
            <SectionCard key={q.id}
              title={
                <span className="flex items-center gap-2.5">
                  <ProductThumb url={photoUrl} alt={productName} onClick={() => setLightbox({ url: photoUrl!, alt: productName })} />
                  {productName}
                </span>
              }
              actions={q.status === 'UNANSWERED' ? <Badge tone="warn">Sin responder</Badge> : q.status === 'ANSWERED' ? <Badge tone="ok">Respondida</Badge> : <Badge tone="neutral">{q.status}</Badge>}>
              <p className="text-xs text-[var(--text-muted)] -mt-2 mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                {q.connection && (
                  <Badge tone="neutral">
                    {q.connection.name}{q.connection.mlNickname && q.connection.mlNickname !== q.connection.name ? ` · ${q.connection.mlNickname}` : ''}
                  </Badge>
                )}
                <span>{q.product?.sku ? `SKU ${q.product.sku} · ` : ''}{new Date(q.dateCreated).toLocaleString('es-CL', { timeZone: tz })}</span>
                {itemUrl(q) && (
                  <a href={itemUrl(q)!} target="_blank" rel="noopener noreferrer"
                    className="font-medium text-[var(--brand-ink)] hover:underline">
                    · Ir a la publicación ↗
                  </a>
                )}
              </p>
              <p className="text-sm text-[var(--text)] mb-3">"{q.text}"</p>
              {q.status === 'ANSWERED' ? (
                <p className="text-sm text-[var(--text-2)] bg-[var(--surface-soft)] rounded-lg px-3 py-2">
                  <strong className="text-[var(--text)]">Respuesta:</strong> {q.answerText}
                  {q.answeredAt && <span className="block text-xs text-[var(--text-muted)] mt-1">{new Date(q.answeredAt).toLocaleString('es-CL', { timeZone: tz })}</span>}
                </p>
              ) : (
                <div className="flex gap-2">
                  <input
                    value={drafts[q.externalId] || ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [q.externalId]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') answer(q.externalId); }}
                    placeholder="Escribe la respuesta…"
                    className="flex-1 px-3 py-2 border border-[var(--border)] rounded-lg text-sm bg-white" />
                  <BrandButton onClick={() => answer(q.externalId)} disabled={busyId === q.externalId || !(drafts[q.externalId] || '').trim()}>
                    {busyId === q.externalId ? 'Enviando…' : 'Responder'}
                  </BrandButton>
                </div>
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

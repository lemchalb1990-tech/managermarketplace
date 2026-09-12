'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api, imgUrl } from '@/lib/api';
import { PageHeader, SectionCard, StatRow, StatTile, Badge, BrandButton } from '@/components/ui';
import { useMlCompany } from '../MlCompanyContext';
import { ProductThumb, PhotoLightbox, type LightboxImage } from '../PhotoLightbox';

const CLAIM_TYPE_LABEL: Record<string, string> = {
  return: 'Devolución',
  dispute: 'Disputa',
  mediations: 'Mediación',
  cancel_sale: 'Cancelación de venta',
  cancel_sale_by_iron: 'Cancelación (garantía Mercado Libre)',
  fraud: 'Fraude',
};
const typeLabel = (t: string) => CLAIM_TYPE_LABEL[t] || t;

export default function MlReclamosPage() {
  const { companyId } = useMlCompany();
  const [tab, setTab] = useState<'OPENED' | 'CLOSED' | 'ALL'>('OPENED');
  const [data, setData] = useState<{ claims: any[]; opened: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<{ msg: string; ok: boolean } | null>(null);
  const [lightbox, setLightbox] = useState<LightboxImage>(null);

  const [open, setOpen] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      setData(await api.marketplace.claims(token, tab, companyId));
    } catch (err: any) {
      setFlash({ msg: err.message || 'No se pudieron cargar los reclamos.', ok: false });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab, companyId]);

  async function openDetail(claim: any) {
    setOpen(claim);
    setDetail(null);
    setMsg('');
    setDetailLoading(true);
    try {
      setDetail(await api.marketplace.claimDetail(claim.externalId, getToken()!));
    } catch (err: any) {
      setFlash({ msg: err.message, ok: false });
      setTimeout(() => setFlash(null), 3000);
      setOpen(null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function sendMessage() {
    if (!msg.trim() || !open) return;
    setBusy(true);
    try {
      await api.marketplace.sendClaimMessage(open.externalId, msg.trim(), getToken()!);
      setMsg('');
      setDetail(await api.marketplace.claimDetail(open.externalId, getToken()!));
    } catch (err: any) {
      setFlash({ msg: err.message, ok: false });
      setTimeout(() => setFlash(null), 3000);
    } finally {
      setBusy(false);
    }
  }

  async function runAction(action: string) {
    if (!open) return;
    if (!confirm(`¿Confirmar la acción "${action}" en Mercado Libre?`)) return;
    setBusy(true);
    try {
      await api.marketplace.takeClaimAction(open.externalId, action, getToken()!);
      setDetail(await api.marketplace.claimDetail(open.externalId, getToken()!));
      await load();
      setFlash({ msg: 'Acción aplicada', ok: true });
      setTimeout(() => setFlash(null), 2000);
    } catch (err: any) {
      setFlash({ msg: err.message, ok: false });
      setTimeout(() => setFlash(null), 3000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Reclamos de Mercado Libre"
        crumbs={[{ label: 'Inicio', href: '/dashboard' }, { label: 'Mercado Libre' }, { label: 'Reclamos' }]}
      />

      {data && (
        <StatRow>
          <StatTile label="Abiertos" value={data.opened} tone={data.opened > 0 ? 'warn' : undefined} />
        </StatRow>
      )}

      <div className="flex gap-2 my-4">
        {(['OPENED', 'CLOSED', 'ALL'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium ${tab === t ? 'bg-[var(--brand-light)] text-[var(--brand-ink)]' : 'text-[var(--text-2)] hover:bg-[var(--surface-soft)]'}`}>
            {t === 'OPENED' ? 'Abiertos' : t === 'CLOSED' ? 'Cerrados' : 'Todos'}
          </button>
        ))}
      </div>

      {flash && (
        <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${flash.ok ? 'text-[var(--ok)] bg-[var(--ok-bg)]' : 'text-[var(--danger)] bg-[var(--danger-bg)]'}`}>{flash.msg}</div>
      )}

      {loading ? (
        <p className="text-sm text-[var(--text-muted)] py-8 text-center">Cargando…</p>
      ) : (data?.claims || []).length === 0 ? (
        <SectionCard><p className="text-sm text-[var(--text-muted)] text-center py-6">Sin reclamos para mostrar</p></SectionCard>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data!.claims.map((c: any) => {
            const product = c.sale?.items?.[0]?.product;
            const photoUrl = product?.images?.[0]?.url ? imgUrl(product.images[0].url) : undefined;
            const cardTitle = `${typeLabel(c.type)}${c.sale?.externalId ? ` · orden ${c.sale.externalId}` : ''}`;
            return (
            <SectionCard key={c.id}
              title={
                <span className="flex items-center gap-2.5">
                  <ProductThumb url={photoUrl} alt={product?.name || cardTitle} onClick={() => setLightbox({ url: photoUrl!, alt: product?.name || cardTitle })} />
                  {cardTitle}
                </span>
              }
              actions={c.status === 'OPENED' ? <Badge tone="warn">Abierto</Badge> : <Badge tone="neutral">Cerrado</Badge>}>
              <p className="text-xs text-[var(--text-muted)] -mt-2 mb-3">
                {c.stage ? `Etapa: ${c.stage} · ` : ''}{c.reason || 'Sin motivo detallado'}
              </p>
              <BrandButton onClick={() => openDetail(c)} className="w-full">Ver detalle y responder</BrandButton>
            </SectionCard>
            );
          })}
        </div>
      )}

      <PhotoLightbox image={lightbox} onClose={() => setLightbox(null)} />

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="ui-card w-full max-w-lg max-h-[85vh] flex flex-col">
            <div className="px-6 py-4 border-b border-[var(--border-soft)] flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-[var(--text)]">{typeLabel(open.type)}</h2>
                <p className="text-xs text-[var(--text-muted)]">Reclamo {open.externalId}</p>
              </div>
              <button onClick={() => setOpen(null)} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-4 flex-1 overflow-y-auto">
              {detailLoading ? (
                <p className="text-sm text-[var(--text-muted)] text-center py-6">Cargando detalle…</p>
              ) : (
                <>
                  {(Array.isArray(detail?.messages) ? detail.messages : detail?.messages?.results || []).length > 0 && (
                    <div className="space-y-2 mb-4">
                      {(Array.isArray(detail?.messages) ? detail.messages : detail?.messages?.results || []).map((m: any, i: number) => (
                        <div key={m.id || i} className={`text-sm px-3 py-2 rounded-lg max-w-[85%] ${m.sender_role === 'respondent' ? 'bg-[var(--brand-light)] ml-auto' : 'bg-[var(--surface-soft)]'}`}>
                          {m.message || m.text}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2 mb-4">
                    <input value={msg} onChange={(e) => setMsg(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') sendMessage(); }}
                      placeholder="Escribe un mensaje al comprador…"
                      className="flex-1 px-3 py-2 border border-[var(--border)] rounded-lg text-sm bg-white" />
                    <BrandButton onClick={sendMessage} disabled={busy || !msg.trim()}>Enviar</BrandButton>
                  </div>
                  {detail?.availableActions?.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-[var(--text-2)] mb-2">Acciones disponibles en Mercado Libre</p>
                      <div className="flex flex-wrap gap-2">
                        {detail.availableActions.map((a: any) => (
                          <button key={a.action || a}
                            onClick={() => runAction(a.action || a)}
                            disabled={busy}
                            className="px-3 py-1.5 border border-[var(--border)] rounded-lg text-xs text-[var(--text-2)] hover:bg-[var(--surface-soft)] disabled:opacity-50">
                            {a.action || a}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

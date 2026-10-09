'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api, imgUrl } from '@/lib/api';
import { PageHeader, StatRow, StatTile, Badge, BrandButton } from '@/components/ui';
import { useMlCompany } from '../MlCompanyContext';
import { onActivity } from '@/lib/activityBus';
import { ProductThumb, PhotoLightbox, type LightboxImage } from '../PhotoLightbox';
import { confirmDialog } from '../../ConfirmDialog';
import { useDashboardTimezone } from '@/lib/dashboardTimezone';
import { SkeletonForm, SkeletonTable } from '@/components/Skeleton';
import { sanitizeHtml, looksLikeHtml } from '@/lib/sanitizeHtml';

const PLAYER_TYPE_LABEL: Record<string, string> = {
  buyer: 'Comprador', seller: 'Vendedor', internal: 'Mercado Libre',
};
const ROLE_LABEL: Record<string, string> = {
  complainant: 'Comprador', respondent: 'Tú', mediator: 'Mediador de Mercado Libre',
};
const fmtMoney = (n: any) => (n == null ? null : `$${Number(n).toLocaleString('es-CL')}`);

const CLAIM_TYPE_LABEL: Record<string, string> = {
  return: 'Devolución',
  dispute: 'Disputa',
  mediations: 'Mediación',
  cancel_sale: 'Cancelación de venta',
  cancel_sale_by_iron: 'Cancelación (garantía Mercado Libre)',
  fraud: 'Fraude',
};
const typeLabel = (t: string) => CLAIM_TYPE_LABEL[t] || t;

const STAGE_LABEL: Record<string, string> = {
  claim: 'Reclamo', dispute: 'En mediación', recontact: 'Recontacto', stale: 'Sin actividad', none: '',
};

// Acciones de Mercado Libre en español (las de mensajes se hacen con el cuadro de mensaje).
const ACTION_LABEL: Record<string, string> = {
  refund: 'Devolver el dinero',
  allow_return: 'Aceptar devolución del producto',
  allow_return_label: 'Generar etiqueta de devolución',
  allow_partial_refund: 'Ofrecer reembolso parcial',
  open_dispute: 'Pedir mediación de Mercado Libre',
  send_potential_shipping: 'Informar envío',
  add_shipping_evidence: 'Agregar evidencia de envío',
  send_tracking_number: 'Enviar número de seguimiento',
  return_review_ok: 'Devolución revisada: producto OK',
  return_review_fail: 'Devolución revisada: producto con problemas',
  appeal: 'Apelar la resolución',
};
const actionLabel = (a: string) => ACTION_LABEL[a] || a.replace(/_/g, ' ');

// Lo que espera el comprador (expected resolutions de ML).
const EXPECTED_LABEL: Record<string, string> = {
  return_product: 'Devolver el producto',
  refund: 'Que le devuelvan el dinero',
  partial_refund: 'Un reembolso parcial',
  change_product: 'Cambiar el producto',
  product_exchange: 'Cambiar el producto',
  repair: 'Reparar el producto',
  send_missing_part: 'Recibir la parte faltante',
  deliver_product: 'Recibir el producto',
  cancel_purchase: 'Cancelar la compra',
};
const expectedLabel = (r: string) => EXPECTED_LABEL[r] || r.replace(/_/g, ' ');

// Estado de la devolución (returns de ML).
const RETURN_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente',
  label_generated: 'Etiqueta de devolución generada',
  ready_to_ship: 'Lista para enviar',
  shipped: 'En camino al vendedor',
  delivered: 'Entregada al vendedor',
  not_delivered: 'No entregada',
  to_be_agreed: 'Por acordar',
  cancelled: 'Cancelada',
  closed: 'Cerrada',
  expired: 'Vencida',
  failed: 'Fallida',
  return_to_buyer: 'Devuelta al comprador',
};
const returnStatusLabel = (st: string) => RETURN_STATUS_LABEL[st] || st.replace(/_/g, ' ');
const isMessageAction = (a: string) => a.startsWith('send_message');

function StatusBadge({ c }: { c: any }) {
  const stage = c.stage ? STAGE_LABEL[c.stage] ?? c.stage : '';
  if (c.status !== 'OPENED') return <Badge tone="neutral">Cerrado</Badge>;
  return <Badge tone={c.stage === 'dispute' ? 'danger' : 'warn'}>Abierto{stage ? ` · ${stage}` : ''}</Badge>;
}

export default function MlReclamosPage() {
  const { companyId } = useMlCompany();
  const tz = useDashboardTimezone();
  const [tab, setTab] = useState<'OPENED' | 'CLOSED' | 'ALL'>('OPENED');
  const [data, setData] = useState<{ claims: any[]; opened: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<{ msg: string; ok: boolean } | null>(null);
  const [lightbox, setLightbox] = useState<LightboxImage>(null);

  const [open, setOpen] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [receiver, setReceiver] = useState<'complainant' | 'mediator'>('complainant');
  const [files, setFiles] = useState<{ fileName: string; originalName: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fmtDate = (d: any, time = false) => (d
    ? new Date(d).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}), timeZone: tz })
    : '—');

  function showFlash(m: string, ok: boolean) {
    setFlash({ msg: m, ok });
    setTimeout(() => setFlash(null), ok ? 2500 : 4000);
  }

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
  useEffect(() => onActivity(['claim'], load), [tab, companyId]);

  // Con más de una cuenta de Mercado Libre se muestra a cuál pertenece cada reclamo.
  const multiAccount = useMemo(() => new Set((data?.claims || []).map((c) => c.connection?.id).filter(Boolean)).size > 1, [data]);
  const accountName = (c: any) => c.connection?.mlNickname || c.connection?.name || '—';

  async function openDetail(claim: any) {
    setOpen(claim);
    setDetail(null);
    setMsg('');
    setFiles([]);
    setReceiver('complainant');
    setDetailLoading(true);
    try {
      setDetail(await api.marketplace.claimDetail(claim.externalId, getToken()!));
    } catch (err: any) {
      showFlash(err.message, false);
      setOpen(null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function attach(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files || []);
    e.target.value = '';
    if (!list.length || !open) return;
    setUploading(true);
    try {
      for (const f of list) {
        const up = await api.marketplace.uploadClaimAttachment(open.externalId, f, getToken()!);
        setFiles((prev) => [...prev, up]);
      }
    } catch (err: any) {
      showFlash(err.message || 'No se pudo adjuntar el archivo.', false);
    } finally {
      setUploading(false);
    }
  }

  async function sendMessage() {
    if (!msg.trim() || !open) return;
    setBusy(true);
    try {
      await api.marketplace.sendClaimMessage(open.externalId, msg.trim(), getToken()!, receiver, files.map((f) => f.fileName));
      setMsg('');
      setFiles([]);
      setDetail(await api.marketplace.claimDetail(open.externalId, getToken()!));
      showFlash('Mensaje enviado', true);
      load();
    } catch (err: any) {
      showFlash(err.message, false);
    } finally {
      setBusy(false);
    }
  }

  async function runAction(action: string) {
    if (!open) return;
    if (!(await confirmDialog(`¿Confirmar "${actionLabel(action)}" en Mercado Libre?`))) return;
    setBusy(true);
    try {
      await api.marketplace.takeClaimAction(open.externalId, action, getToken()!);
      setDetail(await api.marketplace.claimDetail(open.externalId, getToken()!));
      await load();
      showFlash('Acción aplicada', true);
    } catch (err: any) {
      showFlash(err.message, false);
    } finally {
      setBusy(false);
    }
  }

  const messages: any[] = Array.isArray(detail?.messages) ? detail.messages : detail?.messages?.results || [];
  const openProduct = open?.sale?.items?.[0]?.product;
  const openPhoto = openProduct?.images?.[0]?.url ? imgUrl(openProduct.images[0].url) : undefined;

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

      {/* Lista: fecha, N°, producto, cuenta, estado y vencimiento. */}
      <div className="ui-card overflow-hidden">
        {loading ? (
          <SkeletonTable rows={6} cols={6} />
        ) : (data?.claims || []).length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] text-center py-8">Sin reclamos para mostrar</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--text-muted)] border-b border-[var(--border-soft)] bg-[var(--surface-soft)]">
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Fecha del Reclamo</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">N°</th>
                  <th className="px-3 py-2.5 font-medium">Producto</th>
                  {multiAccount && <th className="px-3 py-2.5 font-medium">Cuenta</th>}
                  <th className="px-3 py-2.5 font-medium">Estado</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">Responder antes de</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-soft)]">
                {data!.claims.map((c: any) => {
                  const product = c.sale?.items?.[0]?.product;
                  const photoUrl = product?.images?.[0]?.url ? imgUrl(product.images[0].url) : undefined;
                  const overdue = c.status === 'OPENED' && c.dueDate && new Date(c.dueDate) < new Date();
                  return (
                    <tr key={c.id} className="hover:bg-[var(--surface-soft)] cursor-pointer" onClick={() => openDetail(c)}>
                      <td className="px-4 py-2.5 whitespace-nowrap text-[var(--text-2)]">{fmtDate(c.claimDate || c.createdAt)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap font-mono text-xs text-[var(--text)]">{c.externalId}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5 min-w-[220px]">
                          <span onClick={(e) => e.stopPropagation()}>
                            <ProductThumb url={photoUrl} alt={product?.name || 'Producto'} onClick={() => photoUrl && setLightbox({ url: photoUrl, alt: product?.name || '' })} />
                          </span>
                          <div className="min-w-0">
                            <p className="text-[var(--text)] truncate max-w-[280px]" title={product?.name}>{product?.name || 'Sin venta vinculada'}</p>
                            <p className="text-[11px] text-[var(--text-muted)] truncate">
                              {c.sale?.externalId ? `Orden ${c.sale.externalId}` : c.orderExternalId ? `Orden ${c.orderExternalId}` : ''}
                              {fmtMoney(c.sale?.total) ? ` · ${fmtMoney(c.sale.total)}` : ''}
                              {c.sale?.customerName ? ` · ${c.sale.customerName}` : ''}
                            </p>
                          </div>
                        </div>
                      </td>
                      {multiAccount && <td className="px-3 py-2.5 whitespace-nowrap text-[var(--text-2)]">{accountName(c)}</td>}
                      <td className="px-3 py-2.5 whitespace-nowrap"><StatusBadge c={c} /></td>
                      <td className={`px-3 py-2.5 whitespace-nowrap ${overdue ? 'text-[var(--danger)] font-semibold' : 'text-[var(--text-2)]'}`}>
                        {c.status === 'OPENED' && c.dueDate ? fmtDate(c.dueDate, true) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <button type="button" onClick={(e) => { e.stopPropagation(); openDetail(c); }}
                          className="text-xs font-medium text-[var(--brand-ink)] hover:underline">
                          {c.status === 'OPENED' ? 'Ver y responder' : 'Ver detalle'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <PhotoLightbox image={lightbox} onClose={() => setLightbox(null)} />

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="ui-card w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-[var(--border-soft)] flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <ProductThumb url={openPhoto} alt={openProduct?.name || ''} onClick={() => openPhoto && setLightbox({ url: openPhoto, alt: openProduct?.name || '' })} />
                <div className="min-w-0">
                  <h2 className="ui-section-title truncate">{openProduct?.name || typeLabel(open.type)}</h2>
                  <p className="text-xs text-[var(--text-muted)]">
                    Reclamo {open.externalId} · {typeLabel(open.type)}
                    {open.sale?.externalId ? ` · Orden ${open.sale.externalId}` : ''}
                    {multiAccount || open.connection ? ` · Cuenta ${accountName(open)}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StatusBadge c={detail?.claim || open} />
                <button onClick={() => setOpen(null)} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none">×</button>
              </div>
            </div>
            <div className="px-6 py-4 flex-1 overflow-y-auto space-y-4">
              {detailLoading ? (
                <SkeletonForm fields={4} columns={2} />
              ) : (
                <>
                  {detail?.detail && (
                    <div className="text-xs text-[var(--text-2)] bg-[var(--surface-soft)] rounded-lg px-3 py-2.5 space-y-1">
                      <p>
                        Abierto el {fmtDate(detail.detail.date_created, true)}
                        {(() => {
                          const initiator = detail.detail.players?.find((p: any) => p.role === 'complainant');
                          return initiator ? ` · Iniciado por: ${PLAYER_TYPE_LABEL[initiator.type] || initiator.type}` : '';
                        })()}
                      </p>
                      {detail.claim?.dueDate && detail.claim.status === 'OPENED' && (
                        <p className="font-medium text-[var(--warn)]">Tienes que responder antes del {fmtDate(detail.claim.dueDate, true)}</p>
                      )}
                      {detail.reputation && typeof detail.reputation.affects_reputation !== 'undefined' && (
                        <p className={detail.reputation.affects_reputation ? 'text-[var(--danger)]' : ''}>
                          {detail.reputation.affects_reputation ? 'Este reclamo puede afectar tu reputación.' : 'Este reclamo no afecta tu reputación.'}
                        </p>
                      )}
                      {Array.isArray(detail.expectedResolutions) && detail.expectedResolutions.length > 0 && (
                        <p>
                          El comprador espera: {detail.expectedResolutions.map((r: any) => r.expected_resolution || r.type).filter(Boolean).map(expectedLabel).join(', ')}
                        </p>
                      )}
                      {(() => {
                        const ret = Array.isArray(detail.returns) ? detail.returns[0] : detail.returns?.results?.[0] || (detail.returns?.id ? detail.returns : null);
                        return ret ? (
                          <p>Devolución: {ret.status ? returnStatusLabel(ret.status) : '—'}{ret.shipping?.tracking_number ? ` · Seguimiento ${ret.shipping.tracking_number}` : ''}</p>
                        ) : null;
                      })()}
                      {detail.detail.resolution && (
                        <p>
                          Resuelto el {fmtDate(detail.detail.resolution.date_created)}
                          {' · '}Motivo: {detail.detail.resolution.reason || 'sin especificar'}
                          {Array.isArray(detail.detail.resolution.benefited) && detail.detail.resolution.benefited.length > 0
                            ? ` · A favor de: ${detail.detail.resolution.benefited.map((b: string) => PLAYER_TYPE_LABEL[b] || ROLE_LABEL[b] || b).join(', ')}`
                            : ''}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Conversación con el comprador y el mediador. */}
                  <div className="space-y-2">
                    {messages.length === 0 && <p className="text-xs text-[var(--text-muted)]">Todavía no hay mensajes.</p>}
                    {messages.map((m: any, i: number) => {
                      const mine = m.sender_role === 'respondent';
                      const text: string = m.message || m.text || '';
                      return (
                        <div key={m.id || i} className={`max-w-[85%] ${mine ? 'ml-auto' : ''}`}>
                          <p className={`text-[10px] text-[var(--text-muted)] mb-0.5 ${mine ? 'text-right' : ''}`}>
                            {ROLE_LABEL[m.sender_role] || m.sender_role || '—'}
                            {m.receiver_role && !mine ? '' : m.receiver_role ? ` → ${ROLE_LABEL[m.receiver_role] || m.receiver_role}` : ''}
                            {m.date_created ? ` · ${fmtDate(m.date_created, true)}` : ''}
                          </p>
                          <div className={`text-sm px-3 py-2 rounded-lg ${mine ? 'bg-[var(--brand-light)]' : m.sender_role === 'mediator' ? 'bg-amber-50 border border-amber-200' : 'bg-[var(--surface-soft)]'}`}>
                            {looksLikeHtml(text)
                              ? <div className="[&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-4" dangerouslySetInnerHTML={{ __html: sanitizeHtml(text) }} />
                              : <p className="whitespace-pre-wrap">{text}</p>}
                            {Array.isArray(m.attachments) && m.attachments.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mt-2">
                                {m.attachments.map((a: any) => {
                                  const name = a.filename || a.file_name || a;
                                  return (
                                    <button key={name} type="button"
                                      onClick={() => api.marketplace.openClaimAttachment(open.externalId, name, getToken()!).catch((e) => showFlash(e.message, false))}
                                      className="text-[11px] px-2 py-0.5 rounded bg-white border border-[var(--border)] hover:bg-[var(--surface-soft)]">
                                      📎 {a.original_filename || name}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {(detail?.claim?.status ?? open.status) === 'OPENED' && (
                    <div className="border border-[var(--border-soft)] rounded-xl p-3 space-y-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-[var(--text-2)] font-medium">Enviar a:</span>
                        {(['complainant', ...(detail?.hasMediator ? ['mediator'] : [])] as ('complainant' | 'mediator')[]).map((r) => (
                          <button key={r} type="button" onClick={() => setReceiver(r)}
                            className={`px-2.5 py-1 rounded-full border ${receiver === r ? 'bg-[var(--brand-light)] border-[var(--brand)] text-[var(--brand-ink)] font-medium' : 'border-[var(--border)] text-[var(--text-2)]'}`}>
                            {r === 'complainant' ? 'Comprador' : 'Mediador de Mercado Libre'}
                          </button>
                        ))}
                      </div>
                      <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={3}
                        placeholder={receiver === 'mediator' ? 'Explica tu caso al mediador…' : 'Escribe un mensaje al comprador…'}
                        className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm bg-white resize-y" />
                      {files.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {files.map((f) => (
                            <span key={f.fileName} className="text-[11px] px-2 py-0.5 rounded bg-[var(--surface-soft)] border border-[var(--border)]">
                              📎 {f.originalName}
                              <button type="button" onClick={() => setFiles((prev) => prev.filter((x) => x.fileName !== f.fileName))} className="ml-1 text-[var(--text-muted)]">×</button>
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || busy}
                          className="px-3 py-1.5 border border-[var(--border)] rounded-lg text-xs text-[var(--text-2)] hover:bg-[var(--surface-soft)] disabled:opacity-50">
                          {uploading ? 'Adjuntando…' : '📎 Adjuntar foto o archivo'}
                        </button>
                        <input ref={fileRef} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={attach} />
                        <BrandButton onClick={sendMessage} disabled={busy || uploading || !msg.trim()}>{busy ? 'Enviando…' : 'Enviar'}</BrandButton>
                      </div>
                    </div>
                  )}

                  {(detail?.availableActions || []).filter((a: any) => !isMessageAction(a.action)).length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-[var(--text-2)] mb-2">Soluciones disponibles en Mercado Libre</p>
                      <div className="flex flex-wrap gap-2">
                        {detail.availableActions.filter((a: any) => !isMessageAction(a.action)).map((a: any) => (
                          <button key={a.action}
                            onClick={() => runAction(a.action)}
                            disabled={busy}
                            className="px-3 py-1.5 border border-[var(--border)] rounded-lg text-xs text-[var(--text-2)] hover:bg-[var(--surface-soft)] disabled:opacity-50 text-left">
                            {actionLabel(a.action)}
                            {a.due_date && <span className="block text-[10px] text-[var(--text-muted)]">Antes del {fmtDate(a.due_date, true)}</span>}
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

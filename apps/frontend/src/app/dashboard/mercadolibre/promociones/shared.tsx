'use client';

import { imgUrl, type MlPromoEstimate, type MlPromoProduct, type MlPromoType } from '@/lib/api';

export const clp = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(n).toLocaleString('es-CL')}`);
export const pct = (n: number | null | undefined) => (n == null ? '—' : `${(Math.round(n * 10) / 10).toLocaleString('es-CL')}%`);
export const day = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' }) : '—');
export const todayYmd = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });

// Días que faltan para una fecha (negativo si ya pasó).
export const daysLeft = (d: string | null | undefined) => (d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000) : null);

export const TYPE_INFO: Record<MlPromoType, { label: string; short: string; pricing: 'SELLER' | 'ML'; top: boolean; stock: boolean; hint: string }> = {
  PRICE_DISCOUNT: { label: 'Descuento individual', short: 'Descuento', pricing: 'SELLER', top: true, stock: false, hint: 'Tú eliges el precio. Entre 5% y 80%, hasta 14 días.' },
  SELLER_CAMPAIGN: { label: 'Campaña del vendedor', short: 'Mi campaña', pricing: 'SELLER', top: true, stock: false, hint: 'Una campaña con nombre propio, hasta 14 días.' },
  VOLUME: { label: 'Descuento por cantidad', short: 'Por cantidad', pricing: 'ML', top: false, stock: false, hint: '2x1, 3x2 o segunda unidad con descuento.' },
  DEAL: { label: 'Campaña tradicional', short: 'Campaña ML', pricing: 'SELLER', top: true, stock: false, hint: 'Campaña de ML: tú eliges el precio dentro del rango que pide.' },
  MARKETPLACE_CAMPAIGN: { label: 'Campaña co-fondeada', short: 'Co-fondeada', pricing: 'ML', top: false, stock: false, hint: 'ML pone parte del descuento. Solo aceptas.' },
  SMART: { label: 'Co-fondeada automatizada', short: 'Co-fondeada auto', pricing: 'ML', top: false, stock: false, hint: 'ML pone parte del descuento. Solo aceptas.' },
  PRICE_MATCHING: { label: 'Precios competitivos', short: 'Precio competitivo', pricing: 'ML', top: false, stock: false, hint: 'ML ajusta el precio para competir y pone parte.' },
  PRE_NEGOTIATED: { label: 'Descuento pre-acordado', short: 'Pre-acordado', pricing: 'ML', top: false, stock: false, hint: 'Descuento acordado con ML para la publicación.' },
  UNHEALTHY_STOCK: { label: 'Liquidación stock Full', short: 'Liquidación Full', pricing: 'ML', top: false, stock: false, hint: 'Liquidar stock detenido en Full con aporte de ML.' },
  DOD: { label: 'Oferta del día', short: 'Del día', pricing: 'SELLER', top: false, stock: false, hint: 'Un día de exposición destacada. No se puede quitar una vez activa.' },
  LIGHTNING: { label: 'Oferta relámpago', short: 'Relámpago', pricing: 'SELLER', top: false, stock: true, hint: 'Pocas horas con stock reservado. No se puede quitar una vez activa.' },
};

export const STATUS_LABEL: Record<string, { label: string; tone: 'ok' | 'warn' | 'info' | 'neutral' | 'danger' }> = {
  started: { label: 'Activa', tone: 'ok' },
  pending: { label: 'Programada', tone: 'info' },
  sync_requested: { label: 'Activándose', tone: 'info' },
  restore_requested: { label: 'Quitándose', tone: 'warn' },
  candidate: { label: 'Invitada', tone: 'neutral' },
  finished: { label: 'Terminada', tone: 'neutral' },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABEL[status] || { label: status, tone: 'neutral' as const };
  return <span className={`ui-badge ui-badge--${s.tone}`}>{s.label}</span>;
}

export function TypeBadge({ type }: { type: MlPromoType }) {
  return <span className="ui-badge ui-badge--info whitespace-nowrap">{TYPE_INFO[type]?.short || type}</span>;
}

// Celda de producto: foto, nombre, SKU y código de la publicación.
export function ProductCell({ title, thumbnail, product, itemId, permalink }: {
  title: string; thumbnail: string | null; product: MlPromoProduct | null; itemId: string; permalink?: string | null;
}) {
  const img = product?.image ? imgUrl(product.image) : thumbnail;
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-gray-100 bg-gray-50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {img ? <img src={img} alt="" className="h-full w-full object-cover" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-gray-900" title={product?.name || title}>{product?.name || title}</span>
        <span className="block truncate text-[11px] text-gray-400">
          {product?.sku ? `${product.sku} · ` : ''}
          {permalink ? <a href={permalink} target="_blank" rel="noreferrer" className="hover:underline">{itemId}</a> : itemId}
          {!product && <span className="text-amber-600"> · sin producto en el catálogo</span>}
        </span>
      </span>
    </div>
  );
}

// Ganancia y margen estimados (sin IVA, sin envío).
export function MarginCell({ e, compact = false }: { e: MlPromoEstimate | null; compact?: boolean }) {
  if (!e) return <span className="text-gray-300">—</span>;
  if (e.profit == null) return <span className="text-xs text-amber-600" title="Carga el costo del producto para calcular la ganancia">Sin costo</span>;
  const tone = e.profit < 0 ? 'text-red-600' : (e.marginPct ?? 0) < 10 ? 'text-amber-600' : 'text-green-700';
  return (
    <span className={`whitespace-nowrap ${tone}`} title={`Ingreso ${clp(e.revenue)} · comisión ${e.fee == null ? 'no disponible' : clp(e.fee)} · costo ${clp(e.cost)} (sin IVA, sin envío)`}>
      <span className="font-semibold">{pct(e.marginPct)}</span>
      {!compact && <span className="block text-[11px] opacity-80">{clp(e.profit)} c/u</span>}
    </span>
  );
}

export function PriceChange({ from, to, discount }: { from: number | null; to: number | null; discount?: number | null }) {
  return (
    <span className="whitespace-nowrap">
      {from != null && to != null && from !== to && <span className="mr-1 text-xs text-gray-400 line-through">{clp(from)}</span>}
      <span className="font-semibold text-gray-900">{clp(to ?? from)}</span>
      {discount != null && discount > 0 && <span className="ml-1 rounded bg-green-50 px-1 text-[11px] font-semibold text-green-700">−{pct(discount)}</span>}
    </span>
  );
}

export const MARGIN_NOTE = 'Ganancia estimada sin IVA: precio − comisión de ML − costo del producto. No incluye el costo de envío.';

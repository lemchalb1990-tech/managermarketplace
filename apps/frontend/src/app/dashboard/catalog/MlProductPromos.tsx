'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getToken } from '@/lib/auth';
import { api, type MlPromoActive } from '@/lib/api';

type Row = { connection: string; connectionId: string; itemId: string; active: MlPromoActive[]; invitations: number };

const clp = (n: number | null) => (n == null ? '—' : `$${Math.round(n).toLocaleString('es-CL')}`);

// Promociones de Mercado Libre del producto en cada cuenta (ficha del catálogo). Solo se muestra
// si alguna publicación tiene una promoción o invitaciones.
export default function MlProductPromos({ productId }: { productId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    let alive = true;
    api.marketplace.promotions.forProduct(productId, getToken()!).then((r) => { if (alive) setRows(r); }).catch(() => {});
    return () => { alive = false; };
  }, [productId]);

  const visible = rows.filter((r) => r.active.length || r.invitations);
  if (!visible.length) return null;
  return (
    <div className="rounded-xl border border-green-200 bg-green-50/60 px-3 py-2.5 text-sm">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="font-semibold text-green-900">🏷️ Promociones en Mercado Libre</p>
        <Link href="/dashboard/mercadolibre/promociones" className="text-xs font-medium text-[var(--brand)] hover:underline">Gestionar →</Link>
      </div>
      <ul className="space-y-1 text-xs text-gray-700">
        {visible.map((r) => (
          <li key={`${r.connectionId}-${r.itemId}`}>
            <span className="font-medium">{r.connection}</span> ({r.itemId}):{' '}
            {r.active.map((a) => (
              <span key={a.promoKey} className="mr-2">
                {a.typeLabel} {clp(a.price)}{a.discountPct ? ` (−${Math.round(a.discountPct)}%)` : ''}
                {a.status === 'pending' ? ' programada' : ''}{a.finishDate ? ` hasta ${new Date(a.finishDate).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })}` : ''}
              </span>
            ))}
            {r.invitations > 0 && <span className="text-gray-500">{r.invitations} invitación(es) de ML</span>}
          </li>
        ))}
      </ul>
      {visible.some((r) => r.active.length) && (
        <p className="mt-1 text-[11px] text-green-800">Mientras dure la promoción, el precio no se envía a esa publicación (Mercado Libre quitaría el descuento).</p>
      )}
    </div>
  );
}

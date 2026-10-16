'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type ProductionOrderSummary } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { Badge, ORDER_STATUS_CLS, ORDER_STATUS_LABEL, fmtDate, ofNumber } from '../../fabricacion/shared';

// Órdenes de fabricación de la venta: mientras alguna siga en curso, la orden no se puede despachar.
export default function OrderProductionCard({ saleId }: { saleId: string }) {
  const [items, setItems] = useState<ProductionOrderSummary[] | null>(null);

  useEffect(() => {
    const t = getToken();
    if (!t) return;
    api.production.forSale(saleId, t).then(setItems).catch(() => setItems([]));
  }, [saleId]);

  if (!items?.length) return null;
  const open = items.filter((o) => o.status !== 'DONE' && o.status !== 'CANCELLED');
  return (
    <div className="rounded-2xl border border-indigo-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="ui-section-title">Fabricación</h2>
        {open.length > 0
          ? <Badge cls="bg-amber-100 text-amber-800">{open.length} en curso: no se despacha aún</Badge>
          : <Badge cls="bg-green-100 text-green-700">Todo fabricado</Badge>}
      </div>
      <ul className="space-y-2">
        {items.map((o) => (
          <li key={o.id}>
            <Link href={`/dashboard/fabricacion/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2 text-sm hover:bg-gray-50">
              <span className="min-w-0">
                <span className="font-mono text-xs text-gray-500">{ofNumber(o.number)}</span>{' '}
                <span className="font-medium text-gray-900">{o.productName}{o.quantity > 1 && ` × ${o.quantity}`}</span>
                {o.currentStage && o.status !== 'DONE' && <span className="text-xs text-gray-500"> · {o.currentStage.name}</span>}
              </span>
              <span className="flex items-center gap-2">
                {o.dueDate && <span className={`text-xs ${o.overdue ? 'font-semibold text-red-600' : 'text-gray-500'}`}>{fmtDate(o.dueDate)}</span>}
                <Badge cls={ORDER_STATUS_CLS[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

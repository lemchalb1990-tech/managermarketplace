'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

/** Compra pendiente de verificación (la marca un mensaje programado). Solo aviso: no bloquea. */
export default function OrderVerificationBanner({ order, fmtDateTime, onChanged }: {
  order: { id: string; verificationPending?: boolean; verifiedAt?: string | null; verifiedByName?: string | null };
  fmtDateTime: (d: string) => string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!order.verificationPending && !order.verifiedAt) return null;

  async function set(verified: boolean) {
    setBusy(true);
    try {
      await api.orders.setVerification(order.id, verified, getToken()!);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return order.verificationPending ? (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div>
        <p className="text-sm font-semibold text-amber-900">Pendiente de verificación</p>
        <p className="text-xs text-amber-800">Se le pidió al comprador confirmar sus datos. Revisa su respuesta en los mensajes antes de despachar.</p>
      </div>
      <button type="button" onClick={() => set(true)} disabled={busy}
        className="rounded-lg bg-[var(--navy)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--navy-2)] disabled:opacity-50">
        {busy ? 'Guardando…' : 'Marcar como verificada'}
      </button>
    </div>
  ) : (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-2.5">
      <p className="text-xs text-green-800">
        <strong>Compra verificada</strong>{order.verifiedByName ? ` por ${order.verifiedByName}` : ''}{order.verifiedAt ? ` · ${fmtDateTime(order.verifiedAt)}` : ''}
      </p>
      <button type="button" onClick={() => set(false)} disabled={busy} className="text-xs font-medium text-green-800 hover:underline disabled:opacity-50">
        Volver a pendiente
      </button>
    </div>
  );
}

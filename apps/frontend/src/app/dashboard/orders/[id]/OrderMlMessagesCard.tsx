'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api, type MlConversationFull } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { MlChat } from '@/components/MlChat';

/** Mensajes con el comprador de Mercado Libre, en el detalle de la orden. Se abre a pedido. */
export default function OrderMlMessagesCard({ saleId }: { saleId: string }) {
  const [conv, setConv] = useState<MlConversationFull | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function open() {
    setLoading(true);
    setError('');
    try {
      setConv(await api.marketplace.messages.forSale(saleId, getToken()!));
    } catch (e) {
      setError((e as Error).message || 'No se pudo abrir la conversación');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="ui-section-title">Mensajes con el comprador</h2>
        {conv && <Link href={`/dashboard/mercadolibre/mensajes?c=${conv.id}`} className="text-xs font-medium text-[var(--brand)] hover:underline">Abrir en la bandeja →</Link>}
      </div>
      {conv ? (
        <MlChat compact conversation={conv} onChange={setConv} />
      ) : (
        <div>
          <p className="mb-2 text-xs text-gray-400">Lee y responde los mensajes de esta venta de Mercado Libre sin salir del panel.</p>
          <button type="button" onClick={open} disabled={loading}
            className="rounded-lg bg-[var(--navy)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--navy-2)] disabled:opacity-50">
            {loading ? 'Cargando…' : 'Ver mensajes'}
          </button>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}

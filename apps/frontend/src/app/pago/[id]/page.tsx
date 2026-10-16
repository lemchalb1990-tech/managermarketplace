'use client';

import { use, useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Info = Awaited<ReturnType<typeof api.payments.publicStatus>>;

const fmt = (v: number) => `$${Math.round(v).toLocaleString('es-CL')}`;

// Página pública a la que vuelve el cliente después de pagar con Flow o Mercado Pago.
export default function PaymentResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    let tries = 0;
    // El aviso de la pasarela puede tardar unos segundos: se reintenta mientras siga pendiente.
    const tick = () => {
      api.payments.publicStatus(id)
        .then((r) => {
          if (!alive) return;
          setInfo(r);
          if (r.status === 'PENDING' && tries++ < 10) setTimeout(tick, 3000);
        })
        .catch(() => alive && setError('No encontramos este cobro.'));
    };
    tick();
    return () => { alive = false; };
  }, [id]);

  const paid = info?.status === 'PAID';
  const pending = info?.status === 'PENDING';

  return (
    <main className="min-h-[100dvh] bg-gray-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-sm border border-gray-200">
        {!info && !error && <p className="text-sm text-gray-500">Confirmando tu pago…</p>}
        {error && <p className="text-sm text-gray-600">{error}</p>}
        {info && (
          <>
            <div className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full text-2xl ${paid ? 'bg-green-100 text-green-600' : pending ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
              {paid ? '✓' : pending ? '…' : '✕'}
            </div>
            <h1 className="text-lg font-bold text-gray-900">
              {paid ? '¡Pago recibido!' : pending ? 'Pago pendiente' : info.status === 'EXPIRED' ? 'El link venció' : 'Cobro cancelado'}
            </h1>
            <p className="mt-1 text-2xl font-semibold text-gray-900">{fmt(info.amount)}</p>
            {info.companyName && <p className="mt-1 text-sm text-gray-500">{info.companyName}</p>}
            <p className="mt-4 text-sm text-gray-600">
              {paid
                ? `Tu pago con ${info.providerName} fue confirmado. Ya puedes cerrar esta página.`
                : pending
                  ? 'Aún no vemos el pago confirmado. Si ya pagaste, espera unos segundos; si no, puedes intentarlo de nuevo.'
                  : 'Este link ya no acepta pagos. Pide uno nuevo a la tienda.'}
            </p>
            {pending && info.paymentUrl && (
              <a href={info.paymentUrl} className="mt-5 inline-block rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
                Ir a pagar
              </a>
            )}
          </>
        )}
      </div>
    </main>
  );
}

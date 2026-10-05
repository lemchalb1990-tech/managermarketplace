'use client';

import { useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';

// Productos importados antes del precio/título por cuenta: la última cuenta importada pisaba el
// precio base ML y el nombre del producto. Esto lee en Mercado Libre el precio y título de cada
// publicación y los deja como precio/título propio de su cuenta (o base si coinciden). Solo lee
// en ML: no cambia nada en las publicaciones.

const fmt = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;

export default function MlAccountDataRecoveryCard({ companyId }: { companyId?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<Awaited<ReturnType<typeof api.marketplace.recoverAccountData>> | null>(null);

  async function run(apply: boolean) {
    setLoading(true);
    setError('');
    try {
      setReport(await api.marketplace.recoverAccountData({ companyId, apply }, getToken()!));
    } catch (err: any) {
      setError(err.message || 'No se pudo revisar las publicaciones.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 bg-white border border-amber-200 rounded-xl p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-gray-800 mr-auto">Precios y títulos por cuenta (productos ya importados)</p>
        <button onClick={() => run(false)} disabled={loading}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {loading ? 'Revisando...' : 'Revisar'}
        </button>
        {report && !report.applied && report.affected > 0 && (
          <button onClick={() => run(true)} disabled={loading}
            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50">
            Recuperar
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500">
        Lee en Mercado Libre el precio y el título de cada publicación y los deja como propios de su cuenta (o base si son iguales).
        Solo lee: no cambia nada en tus publicaciones.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {report && (
        <div className="space-y-1.5">
          <p className="text-xs text-gray-700">
            {report.applied ? 'Recuperadas' : 'Revisadas'}: {report.checked} publicación(es) · {report.affected} con precio o título distinto al guardado.
          </p>
          {report.errors.map((e) => <p key={e} className="text-xs text-red-600">{e}</p>)}
          <div className="max-h-72 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-lg">
            {report.changes.map((c) => (
              <div key={`${c.productId}-${c.connectionId}`} className="px-3 py-1.5 text-xs">
                <p className="text-gray-800">
                  <span className="font-mono text-gray-500">{c.sku}</span> · <span className="font-medium">{c.connection}</span>
                  <span className="text-gray-400"> · {c.externalId}{c.sold > 0 ? ` · ${c.sold} vendido(s)` : ''}</span>
                </p>
                <p className="text-gray-600">
                  Precio {fmt(c.priceBefore)} → <b>{fmt(c.priceAfter)}</b> ({c.priceOwn ? 'propio' : 'base'})
                  {' · '}Título: <b>{c.mlTitle}</b> ({c.titleOwn ? 'propio' : 'base'})
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

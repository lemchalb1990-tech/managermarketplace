'use client';

import { useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { confirmDialog } from '../../ConfirmDialog';

// Una publicación de Mercado Libre (MLC…) solo puede estar vinculada una vez en la empresa. Si
// quedó vinculada en dos tiendas (p. ej. una tienda conectada con la cuenta de otra) o a dos
// productos, se conserva el vínculo de la tienda activa dueña de la publicación, se quita el
// otro y el producto que queda sin publicaciones se unifica con el que se conserva (su historial
// pasa a ese producto y el duplicado se elimina). No cambia nada en Mercado Libre.

type Report = Awaited<ReturnType<typeof api.marketplace.reviewDuplicateListings>>;

export default function MlDuplicateListingsCard({ companyId }: { companyId?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [progress, setProgress] = useState<{ links: number; merged: number; errors: string[] } | null>(null);

  async function review() {
    setLoading(true);
    setError('');
    setProgress(null);
    try {
      setReport(await api.marketplace.reviewDuplicateListings({ companyId }, getToken()!));
    } catch (err: any) {
      setError(err.message || 'No se pudo revisar.');
    } finally {
      setLoading(false);
    }
  }

  async function fix() {
    if (!report) return;
    const ok = await confirmDialog(
      `¿Corregir ${report.groups - report.manual} publicación(es) duplicada(s)? Se quitan ${report.linksToRemove} vínculo(s) repetido(s) y ${report.orphanProducts} producto(s) duplicado(s) se unifican con el que se conserva (su historial pasa a ese producto y el duplicado se elimina). No se puede deshacer.`,
      { danger: true },
    );
    if (!ok) return;
    setLoading(true);
    setError('');
    const acc = { links: 0, merged: 0, errors: [] as string[] };
    setProgress({ ...acc });
    try {
      for (let i = 0; i < 100; i++) {
        const r = await api.marketplace.reviewDuplicateListings({ companyId, apply: true, limit: 100 }, getToken()!);
        acc.links += r.linksRemoved;
        acc.merged += r.productsMerged;
        acc.errors.push(...r.mergeErrors);
        setProgress({ ...acc });
        setReport(r);
        if (!r.remaining || !r.processed) break;
      }
      setReport(await api.marketplace.reviewDuplicateListings({ companyId }, getToken()!));
    } catch (err: any) {
      setError(err.message || 'No se pudo corregir.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 bg-white border border-amber-200 rounded-xl p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-gray-800 mr-auto">Publicaciones duplicadas</p>
        <button onClick={review} disabled={loading}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {loading && !progress ? 'Revisando...' : 'Revisar'}
        </button>
        {report && !report.applied && report.linksToRemove > 0 && (
          <button onClick={fix} disabled={loading}
            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50">
            Corregir
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500">
        Una publicación de Mercado Libre solo puede estar vinculada una vez en la empresa. Se conserva la de la tienda activa
        y los productos duplicados se unifican con el que se conserva. No cambia nada en Mercado Libre.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {progress && (
        <p className="text-xs text-gray-700">
          {loading ? 'Corrigiendo… ' : 'Listo: '}{progress.links} vínculo(s) quitado(s) · {progress.merged} producto(s) duplicado(s) unificado(s)
          {report?.remaining ? ` · faltan ${report.remaining}` : ''}
        </p>
      )}
      {progress?.errors.map((e) => <p key={e} className="text-xs text-red-600">{e}</p>)}
      {report && (
        <div className="space-y-1.5">
          <p className="text-xs text-gray-700">
            {report.groups} publicación(es) duplicada(s) · {report.linksToRemove} vínculo(s) a quitar · {report.orphanProducts} producto(s) duplicado(s) a unificar
            {report.manual > 0 ? ` · ${report.manual} para revisar a mano` : ''}
          </p>
          {report.sample.length > 0 && (
            <div className="max-h-64 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-lg">
              {report.sample.map((g) => (
                <div key={g.externalId} className="px-3 py-1.5 text-xs">
                  <span className="font-mono text-gray-700">{g.externalId}</span>
                  {g.keep ? (
                    <span className="text-gray-600">
                      {' '}· se conserva <b>{g.keep.store}</b> ({g.keep.sku}) · se quita {g.remove.map((r) => `${r.store} (${r.sku})`).join(', ')}
                    </span>
                  ) : <span className="text-amber-700"> · {g.reason}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

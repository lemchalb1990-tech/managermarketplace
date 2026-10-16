'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getToken, getUser } from '@/lib/auth';
import { api, type ProductionShortage } from '@/lib/api';
import { useAdminCompany } from '../../AdminCompanyContext';
import { SkeletonRows } from '@/components/Skeleton';
import { fmtCLP } from '../shared';

// Materiales que piden las órdenes de fabricación abiertas contra el stock disponible.
export default function ProductionShortagesPage() {
  const { companyId, selectedCompanyId } = useAdminCompany();
  const [rows, setRows] = useState<ProductionShortage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [noCompany, setNoCompany] = useState(false);

  useEffect(() => {
    const t = getToken();
    const id = requestAnimationFrame(() => {
      if (getUser()?.role === 'SUPER_ADMIN' && !selectedCompanyId) { setNoCompany(true); setLoading(false); return; }
      setNoCompany(false);
      if (!t) return;
      api.production.shortages(t, companyId)
        .then((r) => { setRows(r); setError(''); })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    });
    return () => cancelAnimationFrame(id);
  }, [companyId, selectedCompanyId]);

  const shown = onlyMissing ? rows.filter((r) => r.missing > 0) : rows;
  const toBuy = shown.reduce((s, r) => s + r.missing * r.cost, 0);

  return (
    <div className="max-w-5xl">
      <h1 className="ui-page-title mb-1">Materiales faltantes</h1>
      <p className="ui-page-subtitle mb-4">Lo que necesitan las órdenes de fabricación abiertas (planificado y aún no consumido) frente al stock actual.</p>
      {noCompany && <p className="text-sm text-gray-500">Selecciona una empresa en la barra superior.</p>}
      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {!noCompany && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} className="accent-blue-600" />
              Solo los que faltan
            </label>
            <div className="flex items-center gap-3 text-sm">
              {toBuy > 0 && <span className="text-gray-600">Compra estimada: <strong>{fmtCLP(toBuy)}</strong></span>}
              <Link href="/dashboard/purchases" className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700">Ir a Compras</Link>
            </div>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Material</th>
                  <th className="px-3 py-2 text-right font-medium">Se necesita</th>
                  <th className="px-3 py-2 text-right font-medium">Stock</th>
                  <th className="px-3 py-2 text-right font-medium">Falta</th>
                  <th className="px-3 py-2 text-right font-medium">Costo estimado</th>
                  <th className="px-3 py-2 text-left font-medium">Órdenes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading && <SkeletonRows cols={6} />}
                {!loading && shown.map((r) => (
                  <tr key={r.materialId}>
                    <td className="px-3 py-2"><p className="font-medium text-gray-900">{r.name}</p><p className="text-[11px] text-gray-400">{r.sku}</p></td>
                    <td className="px-3 py-2 text-right">{r.needed}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{r.stock}</td>
                    <td className={`px-3 py-2 text-right ${r.missing > 0 ? 'font-semibold text-red-600' : 'text-green-700'}`}>{r.missing || 'OK'}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{r.missing ? fmtCLP(r.missing * r.cost) : '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{r.orders.map((n) => `OF-${String(n).padStart(4, '0')}`).join(', ')}</td>
                  </tr>
                ))}
                {!loading && shown.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">{onlyMissing ? 'No falta ningún material.' : 'Las órdenes abiertas no tienen materiales planificados.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

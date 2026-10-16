'use client';

import { useCallback, useEffect, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api, type PaymentRequestInfo } from '@/lib/api';
import { useAdminCompany } from '../AdminCompanyContext';
import { confirmDialog } from '../ConfirmDialog';
import { SkeletonRows } from '@/components/Skeleton';
import { FilterBar, FilterField, FilterCount, filterSelectCls } from '@/components/FilterBar';
import { PaymentLinkModal } from '@/components/PaymentLinkModal';

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pendiente', PROCESSING: 'Registrando', PAID: 'Pagado', NEEDS_REVIEW: 'Por revisar', CANCELLED: 'Cancelado', EXPIRED: 'Vencido',
};
const STATUS_COLOR: Record<string, string> = {
  PENDING: 'bg-blue-100 text-blue-700',
  PROCESSING: 'bg-emerald-100 text-emerald-700',
  PAID: 'bg-green-100 text-green-700',
  NEEDS_REVIEW: 'bg-amber-100 text-amber-800',
  CANCELLED: 'bg-gray-100 text-gray-500',
  EXPIRED: 'bg-gray-100 text-gray-500',
};

const fmt = (v: number) => `$${Math.round(v).toLocaleString('es-CL')}`;
const fmtDate = (d: string) => new Date(d).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });

export default function PaymentRequestsPage() {
  const { selectedCompanyId } = useAdminCompany();
  const [token, setToken] = useState('');
  const [user, setUser] = useState<{ role?: string } | null>(null);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const canReview = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'].includes(user?.role || '');

  const [items, setItems] = useState<PaymentRequestInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [needsReview, setNeedsReview] = useState(0);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState<PaymentRequestInfo | null>(null);

  // Sesión leída en el navegador (evita diferencias con el render del servidor).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const t = getToken();
      const u = getUser();
      if (t && u) { setToken(t); setUser(u); }
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const load = useCallback(async (p = 1) => {
    if (!token) return;
    if (isSuperAdmin && !selectedCompanyId) { setItems([]); setTotal(0); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await api.payments.list(token, { companyId: isSuperAdmin ? selectedCompanyId : undefined, status: status || undefined, page: p });
      setItems(res.items); setTotal(res.total); setPage(res.page); setPages(res.pages); setNeedsReview(res.needsReview);
    } catch { /* lista vacía */ }
    setLoading(false);
  }, [token, isSuperAdmin, selectedCompanyId, status]);

  useEffect(() => {
    const id = requestAnimationFrame(() => { load(1); });
    return () => cancelAnimationFrame(id);
  }, [load]);

  async function act(r: PaymentRequestInfo, kind: 'retry' | 'dismiss' | 'cancel') {
    const question = kind === 'retry'
      ? '¿Crear la venta de este cobro pagado? Descuenta stock como una venta normal.'
      : kind === 'dismiss'
        ? '¿Cerrar este cobro sin crear venta? Úsalo si devolviste el dinero o lo registraste de otra forma.'
        : '¿Cancelar este cobro? El link deja de servir.';
    if (!(await confirmDialog(question, { danger: kind !== 'retry' }))) return;
    setBusyId(r.id);
    setNotice(null);
    try {
      const res = kind === 'retry' ? await api.payments.retrySale(r.id, token)
        : kind === 'dismiss' ? await api.payments.dismiss(r.id, token)
          : await api.payments.cancel(r.id, token);
      setNotice(res.status === 'PAID'
        ? { ok: true, text: `Venta${res.saleNumber ? ` N° ${res.saleNumber}` : ''} registrada.` }
        : res.status === 'NEEDS_REVIEW' ? { ok: false, text: res.error || 'No se pudo crear la venta' }
          : { ok: true, text: 'Listo.' });
      await load(page);
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="max-w-6xl">
      <h1 className="ui-page-title mb-1">Cobros en línea</h1>
      <p className="ui-page-subtitle mb-4">
        Links y QR de Flow y Mercado Pago generados desde el punto de venta y las órdenes de trabajo. Al pagarse, la venta se registra sola.
      </p>

      {needsReview > 0 && (
        <button type="button" onClick={() => setStatus('NEEDS_REVIEW')}
          className="mb-4 w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-800 hover:bg-amber-100">
          <strong>{needsReview}</strong> {needsReview === 1 ? 'cobro pagado necesita' : 'cobros pagados necesitan'} revisión: el cliente pagó pero la venta no se pudo crear. Ver →
        </button>
      )}

      {notice && (
        <div className={`mb-4 rounded-lg px-3 py-2 text-sm ${notice.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{notice.text}</div>
      )}

      <FilterBar
        sticky={false}
        primary={(
          <FilterField label="Estado">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={filterSelectCls}>
              <option value="">Todos</option>
              {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </FilterField>
        )}
        summary={<FilterCount n={total} label={total === 1 ? 'cobro' : 'cobros'} />}
      />

      <div className="mt-4 bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Fecha</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Origen</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Cliente</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Pasarela</th>
              <th className="text-right px-4 py-3 text-gray-600 font-medium">Monto</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Estado</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && <SkeletonRows cols={7} />}
            {!loading && items.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50 align-top">
                <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                  {fmtDate(r.createdAt)}
                  {r.createdByName && <div className="text-gray-400">{r.createdByName}</div>}
                </td>
                <td className="px-4 py-3 text-xs text-gray-700">
                  {r.workOrderFolio ? `Orden de trabajo #${String(r.workOrderFolio).padStart(4, '0')}` : r.remote ? 'POS · a distancia' : 'POS · en tienda'}
                  {r.itemsCount > 0 && <div className="text-gray-400">{r.itemsCount} {r.itemsCount === 1 ? 'unidad' : 'unidades'}</div>}
                </td>
                <td className="px-4 py-3 text-gray-800">
                  {r.customerName || <span className="text-gray-300">—</span>}
                  {r.customerEmail && <div className="text-xs text-gray-400">{r.customerEmail}</div>}
                </td>
                <td className="px-4 py-3 text-xs text-gray-700">
                  {r.paymentMethodName || r.providerName}
                  {r.fee != null && <div className="text-gray-400">Comisión {fmt(r.fee)}</div>}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">{fmt(r.amount)}</td>
                <td className="px-4 py-3 max-w-xs">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                  {r.status === 'PAID' && r.saleNumber && <div className="mt-1 text-xs text-gray-500">Venta N° {r.saleNumber}</div>}
                  {r.status === 'PENDING' && <div className="mt-1 text-xs text-gray-400">Vence {fmtDate(r.expiresAt)}</div>}
                  {r.error && r.status === 'NEEDS_REVIEW' && <div className="mt-1 text-xs text-amber-700">{r.error}</div>}
                  {r.statusDetail && r.status !== 'NEEDS_REVIEW' && <div className="mt-1 text-xs text-gray-400">{r.statusDetail}</div>}
                </td>
                <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                  {r.status === 'PENDING' && (
                    <>
                      <button onClick={() => setOpen(r)} className="text-xs font-medium text-blue-600 hover:text-blue-800">Ver link</button>
                      <button onClick={() => act(r, 'cancel')} disabled={busyId === r.id} className="text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-50">Cancelar</button>
                    </>
                  )}
                  {r.status === 'NEEDS_REVIEW' && canReview && (
                    <>
                      <button onClick={() => act(r, 'retry')} disabled={busyId === r.id} className="text-xs font-medium text-green-600 hover:text-green-800 disabled:opacity-50">
                        {busyId === r.id ? '...' : 'Crear venta'}
                      </button>
                      <button onClick={() => act(r, 'dismiss')} disabled={busyId === r.id} className="text-xs font-medium text-gray-500 hover:text-gray-700 disabled:opacity-50">Cerrar sin venta</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Sin cobros en línea.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm">
          <button onClick={() => load(page - 1)} disabled={page <= 1} className="px-3 py-1.5 border border-gray-300 rounded-lg disabled:opacity-40">Anterior</button>
          <span className="text-gray-500">{page} / {pages}</span>
          <button onClick={() => load(page + 1)} disabled={page >= pages} className="px-3 py-1.5 border border-gray-300 rounded-lg disabled:opacity-40">Siguiente</button>
        </div>
      )}

      {open && (
        <PaymentLinkModal request={open} onClose={() => { setOpen(null); load(page); }} />
      )}
    </div>
  );
}

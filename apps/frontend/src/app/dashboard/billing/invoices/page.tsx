'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getToken } from '@/lib/auth';
import { api, openDocumentUrl } from '@/lib/api';
import InvoiceDocument from '../components/InvoiceDocument';

const EXEMPT_DTE_TYPES = new Set(['BOLETA', 'FACTURA_EXENTA']);

const DTE_LABELS: Record<string, string> = {
  FACTURA: 'Factura (33)',
  BOLETA: 'Boleta (39)',
  NOTA_CREDITO: 'Nota Crédito (61)',
  NOTA_DEBITO: 'Nota Débito (56)',
  FACTURA_EXENTA: 'Fact. Exenta (34)',
};

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  ISSUED: 'bg-green-100 text-green-700',
  ACCEPTED: 'bg-blue-100 text-blue-700',
  REJECTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-orange-100 text-orange-700',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  ISSUED: 'Emitido',
  ACCEPTED: 'Aceptado',
  REJECTED: 'Rechazado',
  CANCELLED: 'Anulado',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
  OTHER: 'Otro',
};

const emptyPayForm = { paymentMethod: 'TRANSFER', paymentReference: '', paidAt: '' };

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  const [payingInvoice, setPayingInvoice] = useState<any>(null);
  const [payForm, setPayForm] = useState(emptyPayForm);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState('');
  const [actionError, setActionError] = useState('');
  const [issuingId, setIssuingId] = useState<string | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [viewingInvoice, setViewingInvoice] = useState<any>(null);

  async function load(p = 1) {
    setLoading(true);
    const token = getToken()!;
    const res = await api.billing.invoices.list(token, {
      page: p,
      dteType: filterType || undefined,
      status: filterStatus || undefined,
      from: filterFrom || undefined,
      to: filterTo || undefined,
    }).catch(() => ({ invoices: [], total: 0, page: 1, pages: 1 }));
    setInvoices(res.invoices);
    setTotal(res.total);
    setPage(res.page);
    setPages(res.pages);
    setLoading(false);
  }

  useEffect(() => {
    load(1);
    const token = getToken();
    if (token) api.billing.profile.get(token).then(setProfile).catch(() => {});
  }, []);

  async function handleCancel(id: string) {
    if (!confirm('¿Anular este documento?')) return;
    const token = getToken()!;
    await api.billing.invoices.cancel(id, token).catch(() => {});
    load(page);
  }

  async function handleIssueDraft(id: string) {
    if (!confirm('¿Emitir este borrador? Se emitirá el documento real ante el proveedor y no se puede deshacer.')) return;
    setActionError('');
    setIssuingId(id);
    try {
      const token = getToken()!;
      await api.billing.invoices.issueDraft(id, token);
      await load(page);
    } catch (err: any) {
      setActionError(err.message || 'Error al emitir el borrador');
    } finally {
      setIssuingId(null);
    }
  }

  function openPay(inv: any) {
    setPayingInvoice(inv);
    setPayForm(emptyPayForm);
    setPayError('');
  }

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!payingInvoice) return;
    setPayError('');
    setPayLoading(true);
    try {
      const token = getToken()!;
      await api.billing.invoices.pay(payingInvoice.id, {
        paymentMethod: payForm.paymentMethod,
        paymentReference: payForm.paymentReference.trim() || undefined,
        paidAt: payForm.paidAt || undefined,
      }, token);
      setPayingInvoice(null);
      await load(page);
    } catch (err: any) {
      setPayError(err.message || 'Error al registrar el pago');
    } finally {
      setPayLoading(false);
    }
  }

  async function handleUnpay(id: string) {
    setActionError('');
    if (!confirm('¿Revertir el pago de este documento? Volverá a contar como deuda del cliente.')) return;
    const token = getToken()!;
    try {
      await api.billing.invoices.unpay(id, token);
      await load(page);
    } catch (err: any) {
      setActionError(err.message || 'Error al revertir el pago');
    }
  }

  const fmt = (n: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(n);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <a href="/dashboard/billing" className="text-sm text-gray-400 hover:text-gray-600">Facturación</a>
            <span className="text-gray-300">/</span>
            <span className="text-sm text-gray-600 font-medium">Documentos</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Documentos Emitidos</h1>
        </div>
        <Link href="/dashboard/billing/invoices/new"
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold">
          + Emitir DTE
        </Link>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 flex flex-wrap gap-3">
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
          <option value="">Todos los tipos</option>
          {Object.entries(DTE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        <button onClick={() => load(1)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
          Buscar
        </button>
        <button onClick={() => { setFilterType(''); setFilterStatus(''); setFilterFrom(''); setFilterTo(''); setTimeout(() => load(1), 0); }}
          className="px-3 py-2 border border-gray-300 text-gray-500 rounded-lg text-sm hover:bg-gray-50">
          Limpiar
        </button>
        <span className="ml-auto text-xs text-gray-400 self-center">{total} documentos</span>
      </div>

      {actionError && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {actionError}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Folio</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Tipo</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Receptor</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">RUT</th>
              <th className="text-right px-4 py-3 text-gray-600 font-medium">Total</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Estado</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Pago</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Proveedor</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Fecha</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400">Cargando...</td></tr>
            ) : invoices.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-gray-400">
                  <p className="text-sm mb-1">Sin documentos emitidos</p>
                  <p className="text-xs">
                    <a href="/dashboard/billing/invoices/new" className="text-blue-500 hover:underline">Emite tu primer DTE →</a>
                  </p>
                </td>
              </tr>
            ) : invoices.map((inv) => (
              <tr key={inv.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-gray-600 text-xs">{inv.folio ?? '—'}</td>
                <td className="px-4 py-3 text-xs text-gray-600">{DTE_LABELS[inv.dteType] ?? inv.dteType}</td>
                <td className="px-4 py-3 font-medium text-gray-900 max-w-[180px] truncate">{inv.razonSocial}</td>
                <td className="px-4 py-3 text-gray-500 font-mono text-xs">{inv.rut}</td>
                <td className="px-4 py-3 text-right font-medium text-gray-900">{fmt(Number(inv.totalAmount))}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[inv.status] || ''}`}>
                    {STATUS_LABELS[inv.status] ?? inv.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {inv.paid ? (
                    <div>
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Pagado</span>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {PAYMENT_METHOD_LABELS[inv.paymentMethod] ?? inv.paymentMethod}
                        {inv.paymentReference && ` · ${inv.paymentReference}`}
                      </p>
                    </div>
                  ) : ['ISSUED', 'ACCEPTED'].includes(inv.status) ? (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">Deuda</span>
                  ) : (
                    <span className="text-gray-300 text-xs">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">{inv.connection?.provider ?? '—'}</td>
                <td className="px-4 py-3 text-xs text-gray-500">
                  {new Date(inv.createdAt).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-2 justify-end items-center">
                    <button onClick={() => setViewingInvoice(inv)} title="Ver documento"
                      className="text-gray-400 hover:text-blue-600">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth={1.75} className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14 2v6h6" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6M9 17h6M9 9h1" />
                      </svg>
                    </button>
                    {inv.pdfUrl && (
                      <button onClick={() => openDocumentUrl(inv.pdfUrl)}
                        className="text-xs text-blue-500 hover:text-blue-700 font-medium">PDF</button>
                    )}
                    {inv.xmlUrl && (
                      <button onClick={() => openDocumentUrl(inv.xmlUrl)}
                        className="text-xs text-gray-500 hover:text-gray-700 font-medium">XML</button>
                    )}
                    {inv.status === 'DRAFT' && (
                      <>
                        <Link href={`/dashboard/billing/invoices/new?draftId=${inv.id}`}
                          className="text-xs text-gray-500 hover:text-gray-700 font-medium">
                          Editar
                        </Link>
                        <button onClick={() => handleIssueDraft(inv.id)} disabled={issuingId === inv.id}
                          className="text-xs text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50">
                          {issuingId === inv.id ? 'Emitiendo...' : 'Emitir'}
                        </button>
                      </>
                    )}
                    {['ISSUED', 'ACCEPTED'].includes(inv.status) && (
                      inv.paid ? (
                        <button onClick={() => handleUnpay(inv.id)}
                          className="text-xs text-gray-500 hover:text-gray-700 font-medium">Revertir pago</button>
                      ) : (
                        <button onClick={() => openPay(inv)}
                          className="text-xs text-green-600 hover:text-green-700 font-medium">Marcar pagada</button>
                      )
                    )}
                    {inv.status !== 'CANCELLED' && (
                      <button onClick={() => handleCancel(inv.id)}
                        className="text-xs text-red-500 hover:text-red-700 font-medium">Anular</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button disabled={page <= 1} onClick={() => load(page - 1)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50">← Anterior</button>
          <span className="text-sm text-gray-500">Página {page} de {pages}</span>
          <button disabled={page >= pages} onClick={() => load(page + 1)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50">Siguiente →</button>
        </div>
      )}

      {payingInvoice && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-900">Marcar como pagada</h2>
              <button onClick={() => setPayingInvoice(null)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <form onSubmit={handlePay}>
              <div className="px-6 py-5 space-y-4">
                <p className="text-sm text-gray-500">
                  Folio {payingInvoice.folio ?? '—'} · {payingInvoice.razonSocial} · {fmt(Number(payingInvoice.totalAmount))}
                </p>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Método de pago *</label>
                  <select value={payForm.paymentMethod} onChange={(e) => setPayForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                    {Object.entries(PAYMENT_METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    N° de {payForm.paymentMethod === 'TRANSFER' ? 'transferencia' : payForm.paymentMethod === 'CARD' ? 'voucher' : 'referencia'}
                  </label>
                  <input value={payForm.paymentReference} onChange={(e) => setPayForm((f) => ({ ...f, paymentReference: e.target.value }))}
                    placeholder="Opcional"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Fecha de pago</label>
                  <input type="date" value={payForm.paidAt} onChange={(e) => setPayForm((f) => ({ ...f, paidAt: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  <p className="text-xs text-gray-400 mt-1">Si se deja vacío, se usa la fecha de hoy.</p>
                </div>
                {payError && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{payError}</p>
                )}
              </div>
              <div className="px-6 py-4 border-t border-gray-100 flex gap-2 justify-end">
                <button type="button" onClick={() => setPayingInvoice(null)}
                  className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                  Cancelar
                </button>
                <button type="submit" disabled={payLoading}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
                  {payLoading ? 'Guardando...' : 'Confirmar pago'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewingInvoice && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[92vh]">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
              <h2 className="font-bold text-gray-900 text-base">Vista del documento</h2>
              <button onClick={() => setViewingInvoice(null)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 text-lg font-bold">
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-6 bg-gray-100">
              <InvoiceDocument
                profile={profile}
                dteLabel={DTE_LABELS[viewingInvoice.dteType] ?? viewingInvoice.dteType}
                folio={viewingInvoice.folio}
                statusBadge={
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_STYLES[viewingInvoice.status] || ''}`}>
                    {STATUS_LABELS[viewingInvoice.status] ?? viewingInvoice.status}
                  </span>
                }
                connectionName={viewingInvoice.connection?.name}
                connectionProvider={viewingInvoice.connection?.provider}
                receptor={{
                  razonSocial: viewingInvoice.razonSocial, rut: viewingInvoice.rut, giro: viewingInvoice.giro,
                  address: viewingInvoice.address, commune: viewingInvoice.commune, email: viewingInvoice.email,
                }}
                items={viewingInvoice.items || []}
                isTaxed={!EXEMPT_DTE_TYPES.has(viewingInvoice.dteType)}
                netAmount={Number(viewingInvoice.netAmount)}
                tax={Number(viewingInvoice.tax)}
                totalAmount={Number(viewingInvoice.totalAmount)}
                notes={viewingInvoice.notes}
              />
            </div>
            <div className="px-6 py-4 border-t border-gray-100 shrink-0 flex items-center justify-between">
              <div className="flex gap-3">
                {viewingInvoice.pdfUrl && (
                  <button onClick={() => openDocumentUrl(viewingInvoice.pdfUrl)}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium">Ver PDF real del proveedor</button>
                )}
                {viewingInvoice.xmlUrl && (
                  <button onClick={() => openDocumentUrl(viewingInvoice.xmlUrl)}
                    className="text-sm text-gray-500 hover:text-gray-700 font-medium">Ver XML</button>
                )}
                {viewingInvoice.status === 'DRAFT' && (
                  <Link href={`/dashboard/billing/invoices/new?draftId=${viewingInvoice.id}`}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium">Editar</Link>
                )}
              </div>
              <button onClick={() => setViewingInvoice(null)}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50 font-medium">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

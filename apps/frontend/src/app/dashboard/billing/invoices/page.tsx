'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';

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

  useEffect(() => { load(1); }, []);

  async function handleCancel(id: string) {
    if (!confirm('¿Anular este documento?')) return;
    const token = getToken()!;
    await api.billing.invoices.cancel(id, token).catch(() => {});
    load(page);
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
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Proveedor</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Fecha</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">Cargando...</td></tr>
            ) : invoices.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-gray-400">
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
                <td className="px-4 py-3 text-xs text-gray-400">{inv.connection?.provider ?? '—'}</td>
                <td className="px-4 py-3 text-xs text-gray-500">
                  {new Date(inv.createdAt).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-2 justify-end">
                    {inv.pdfUrl && (
                      <a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-blue-500 hover:text-blue-700 font-medium">PDF</a>
                    )}
                    {inv.xmlUrl && (
                      <a href={inv.xmlUrl} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-gray-500 hover:text-gray-700 font-medium">XML</a>
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
    </div>
  );
}

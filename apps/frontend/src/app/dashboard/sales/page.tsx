'use client';

import { useEffect, useState, useCallback } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';

const CHANNEL_LABELS: Record<string, string> = {
  POS: 'Punto de Venta',
  MERCADO_LIBRE: 'Mercado Libre',
  MANUAL: 'Manual',
};

const CHANNEL_COLORS: Record<string, string> = {
  POS: 'bg-blue-100 text-blue-700',
  MERCADO_LIBRE: 'bg-yellow-100 text-yellow-700',
  MANUAL: 'bg-gray-100 text-gray-700',
};

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
  OTHER: 'Otro',
};

export default function SalesPage() {
  const [token, setToken] = useState('');
  const [user, setUser] = useState<any>(null);
  const [sales, setSales] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [channel, setChannel] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [summaryDate, setSummaryDate] = useState(new Date().toISOString().split('T')[0]);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'COMPANY_ADMIN';

  async function handleExport() {
    if (!token) return;
    setExporting(true);
    try {
      await api.pos.exportSales({ channel: channel || undefined, from: from || undefined, to: to || undefined }, token);
    } catch (err: any) {
      alert(err.message || 'No se pudo exportar el archivo.');
    } finally {
      setExporting(false);
    }
  }

  async function handleDeleteSale(id: string) {
    if (!confirm('¿Eliminar esta venta? Esta acción no se puede deshacer.')) return;
    setDeletingId(id);
    try {
      await api.pos.deleteSale(id, token);
      await loadSales(page);
    } catch (err: any) {
      alert(err.message || 'No se pudo eliminar la venta.');
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    const t = getToken();
    const u = getUser();
    if (t && u) {
      setToken(t);
      setUser(u);
    }
  }, []);

  const loadSales = useCallback(async (p = 1) => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await api.pos.listSales({ channel: channel || undefined, from: from || undefined, to: to || undefined, search: search || undefined, page: p }, token);
      setSales(res.sales);
      setTotal(res.total);
      setPage(res.page);
      setPages(res.pages);
    } catch {}
    setLoading(false);
  }, [token, channel, from, to, search]);

  const loadSummary = useCallback(async () => {
    if (!token) return;
    setSummaryLoading(true);
    try {
      const res = await api.pos.summary({ date: summaryDate }, token);
      setSummary(res);
    } catch {}
    setSummaryLoading(false);
  }, [token, summaryDate]);

  useEffect(() => {
    if (token) {
      loadSales(1);
      loadSummary();
    }
  }, [token, loadSales, loadSummary]);

  const fmt = (v: number) => `$${v.toLocaleString('es-CL')}`;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Ventas</h1>

      {/* Resumen del día */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-800">Resumen del día</h2>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={summaryDate}
              onChange={(e) => setSummaryDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={loadSummary}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm px-3 py-1 rounded-lg"
            >
              Actualizar
            </button>
          </div>
        </div>

        {summaryLoading ? (
          <p className="text-gray-400 text-sm">Cargando...</p>
        ) : summary ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-1">Total ventas</p>
              <p className="text-2xl font-bold text-gray-900">{summary.totalSales}</p>
            </div>
            <div className="bg-blue-50 rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-1">Ingresos totales</p>
              <p className="text-2xl font-bold text-blue-600">{fmt(summary.totalRevenue)}</p>
            </div>
            {Object.entries(summary.byChannel || {}).map(([ch, data]: any) => (
              <div key={ch} className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">{CHANNEL_LABELS[ch] || ch}</p>
                <p className="text-lg font-bold text-gray-800">{fmt(data.total)}</p>
                <p className="text-xs text-gray-400">{data.count} ventas</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-400 text-sm">Sin datos para este día.</p>
        )}
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Canal</label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Todos</option>
              <option value="POS">Punto de Venta</option>
              <option value="MERCADO_LIBRE">Mercado Libre</option>
              <option value="MANUAL">Manual</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Desde</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Hasta</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="text-xs text-gray-500 block mb-1">Buscar producto o comprador</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') loadSales(1); }}
              placeholder="Nombre de producto, SKU o comprador..."
              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={() => loadSales(1)}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-1.5 rounded-lg"
          >
            Filtrar
          </button>
          <button
            onClick={() => { setChannel(''); setFrom(''); setTo(''); setSearch(''); }}
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm px-3 py-1.5 rounded-lg"
          >
            Limpiar
          </button>
        </div>
      </div>

      {/* Tabla de ventas */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">Historial de ventas</h2>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{total} registros</span>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="bg-green-600 hover:bg-green-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50"
            >
              {exporting ? 'Exportando...' : 'Exportar CSV'}
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-gray-400 text-sm text-center py-10">Cargando...</p>
        ) : sales.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-10">Sin ventas para los filtros seleccionados.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {sales.map((sale) => (
              <div key={sale.id} className="px-5 py-3">
                <div
                  className="flex items-center gap-3 cursor-pointer"
                  onClick={() => setExpandedId(expandedId === sale.id ? null : sale.id)}
                >
                  <div className="flex-1 grid grid-cols-4 gap-3 items-center">
                    <div>
                      <p className="text-sm font-medium text-gray-800">
                        {new Date(sale.createdAt).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                      {sale.customerName && (
                        <p className="text-xs text-gray-400 truncate">{sale.customerName}</p>
                      )}
                      {sale.externalId && (
                        <p className="text-xs text-gray-400">ID ext: {sale.externalId}</p>
                      )}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium w-fit ${CHANNEL_COLORS[sale.channel] || 'bg-gray-100 text-gray-700'}`}>
                      {CHANNEL_LABELS[sale.channel] || sale.channel}
                    </span>
                    <p className="text-sm text-gray-600">
                      {sale.paymentMethod ? PAYMENT_LABELS[sale.paymentMethod] || sale.paymentMethod : '—'}
                    </p>
                    <p className="text-sm font-bold text-gray-900 text-right">
                      {fmt(Number(sale.total))}
                    </p>
                  </div>
                  <span className="text-gray-300 text-xs ml-2">{expandedId === sale.id ? '▲' : '▼'}</span>
                </div>

                {expandedId === sale.id && (
                  <div className="mt-3 ml-2 bg-gray-50 rounded-xl p-3 space-y-1.5">
                    {sale.items?.map((item: any) => (
                      <div key={item.id} className="flex justify-between text-sm">
                        <span className="text-gray-700">
                          {item.product?.name || 'Producto eliminado'} × {item.quantity}
                        </span>
                        <span className="text-gray-600 font-medium">
                          {fmt(Number(item.unitPrice) * item.quantity)}
                        </span>
                      </div>
                    ))}
                    {sale.customerName && (
                      <p className="text-xs text-gray-400">Comprador: {sale.customerName}</p>
                    )}
                    {sale.notes && (
                      <p className="text-xs text-gray-400 pt-1 border-t border-gray-200 mt-2">Nota: {sale.notes}</p>
                    )}
                    {sale.user && (
                      <p className="text-xs text-gray-400">Vendedor: {sale.user.name}</p>
                    )}
                    {isAdmin && (
                      <div className="pt-2 mt-2 border-t border-gray-200 text-right">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteSale(sale.id); }}
                          disabled={deletingId === sale.id}
                          className="text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-50"
                        >
                          {deletingId === sale.id ? 'Eliminando...' : 'Eliminar venta'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Paginación */}
        {pages > 1 && (
          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
            <button
              onClick={() => loadSales(page - 1)}
              disabled={page <= 1}
              className="text-sm text-blue-600 disabled:text-gray-300 hover:underline"
            >
              ← Anterior
            </button>
            <span className="text-sm text-gray-500">Página {page} de {pages}</span>
            <button
              onClick={() => loadSales(page + 1)}
              disabled={page >= pages}
              className="text-sm text-blue-600 disabled:text-gray-300 hover:underline"
            >
              Siguiente →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

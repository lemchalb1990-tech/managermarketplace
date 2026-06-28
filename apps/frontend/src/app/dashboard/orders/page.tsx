'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  PENDING:    { label: 'Pendiente',  color: 'bg-amber-100 text-amber-700' },
  PREPARING:  { label: 'Preparando', color: 'bg-blue-100 text-blue-700' },
  READY:      { label: 'Listo',      color: 'bg-indigo-100 text-indigo-700' },
  IN_TRANSIT: { label: 'En camino',  color: 'bg-yellow-100 text-yellow-700' },
  DELIVERED:  { label: 'Entregado',  color: 'bg-green-100 text-green-700' },
  CANCELLED:  { label: 'Cancelado',  color: 'bg-gray-100 text-gray-500' },
};

const FULFILLMENT_LABEL: Record<string, string> = {
  DELIVERY: 'Despacho',
  PICKUP: 'Retiro',
};

const CHANNEL_LABEL: Record<string, string> = {
  POS: 'POS', MERCADO_LIBRE: 'Mercado Libre', SHOPIFY: 'Shopify',
  WOOCOMMERCE: 'WooCommerce', JUMPSELLER: 'JumpSeller', FALABELLA: 'Falabella',
  PARIS: 'Paris', HITES: 'Hites', RIPLEY: 'Ripley', WALMART: 'Walmart', MANUAL: 'Manual',
};

const STATUS_TABS = [
  { key: '', label: 'Todas' },
  { key: 'PENDING', label: 'Pendientes' },
  { key: 'PREPARING', label: 'Preparando' },
  { key: 'READY', label: 'Listas' },
  { key: 'IN_TRANSIT', label: 'En camino' },
  { key: 'DELIVERED', label: 'Entregadas' },
  { key: 'CANCELLED', label: 'Canceladas' },
];

const emptyCreate = {
  fulfillmentType: 'DELIVERY',
  saleId: '',
  warehouseId: '',
  customerName: '',
  customerEmail: '',
  customerPhone: '',
  address: '',
  commune: '',
  city: '',
  notes: '',
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [currentUser, setCurrentUser] = useState<any>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [recentSales, setRecentSales] = useState<any[]>([]);
  const [createForm, setCreateForm] = useState(emptyCreate);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  const isAdmin = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'].includes(currentUser?.role);

  async function load(p = 1, status = statusFilter) {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      const res = await api.orders.list(token, { status: status || undefined, page: p });
      setOrders(res.orders);
      setTotal(res.total);
      setPage(res.page);
      setPages(res.pages);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const u = getUser();
    setCurrentUser(u);
    const token = getToken();
    if (!token) return;
    load(1, '');
    Promise.all([
      api.warehouses.list(token).catch(() => []),
      api.pos.listSales({}, token).catch(() => ({ sales: [] })),
    ]).then(([whs, sales]) => {
      setWarehouses(whs);
      setRecentSales(sales.sales || []);
    });
  }, []);

  function changeTab(key: string) {
    setStatusFilter(key);
    load(1, key);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError('');
    setCreateLoading(true);
    try {
      const token = getToken()!;
      await api.orders.create({
        fulfillmentType: createForm.fulfillmentType,
        saleId: createForm.saleId || undefined,
        warehouseId: createForm.warehouseId || undefined,
        customerName: createForm.customerName || undefined,
        customerEmail: createForm.customerEmail || undefined,
        customerPhone: createForm.customerPhone || undefined,
        address: createForm.address || undefined,
        commune: createForm.commune || undefined,
        city: createForm.city || undefined,
        notes: createForm.notes || undefined,
      }, token);
      setCreateForm(emptyCreate);
      setShowCreate(false);
      load(1, statusFilter);
    } catch (err: any) {
      setCreateError(err.message || 'Error al crear la orden');
    } finally {
      setCreateLoading(false);
    }
  }

  const shortId = (id: string) => id.slice(-6).toUpperCase();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Órdenes</h1>
          <p className="text-gray-500 text-sm mt-0.5">Gestiona la preparación y despacho de pedidos.</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => { setShowCreate(!showCreate); setCreateError(''); }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            + Nueva orden
          </button>
        )}
      </div>

      {showCreate && isAdmin && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h2 className="font-semibold text-gray-800 mb-4">Nueva orden</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Tipo de entrega *</label>
                <select
                  value={createForm.fulfillmentType}
                  onChange={(e) => setCreateForm((f) => ({ ...f, fulfillmentType: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                >
                  <option value="DELIVERY">Despacho a domicilio</option>
                  <option value="PICKUP">Retiro en bodega</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Bodega</label>
                <select
                  value={createForm.warehouseId}
                  onChange={(e) => setCreateForm((f) => ({ ...f, warehouseId: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                >
                  <option value="">— Sin bodega asignada —</option>
                  {warehouses.filter((w) => w.active).map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Venta de origen</label>
                <select
                  value={createForm.saleId}
                  onChange={(e) => setCreateForm((f) => ({ ...f, saleId: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                >
                  <option value="">— Sin venta asociada (manual) —</option>
                  {recentSales.map((s) => (
                    <option key={s.id} value={s.id}>
                      #{s.id.slice(-6).toUpperCase()} · {CHANNEL_LABEL[s.channel] || s.channel} · ${Number(s.total).toLocaleString('es-CL')}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">Al vincular una venta, los productos se cargan automáticamente.</p>
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs font-semibold text-gray-700 mb-3">Datos del cliente</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nombre</label>
                  <input value={createForm.customerName}
                    onChange={(e) => setCreateForm((f) => ({ ...f, customerName: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Teléfono</label>
                  <input value={createForm.customerPhone}
                    onChange={(e) => setCreateForm((f) => ({ ...f, customerPhone: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                  <input type="email" value={createForm.customerEmail}
                    onChange={(e) => setCreateForm((f) => ({ ...f, customerEmail: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                {createForm.fulfillmentType === 'DELIVERY' && (
                  <>
                    <div className="col-span-3">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Dirección</label>
                      <input value={createForm.address}
                        onChange={(e) => setCreateForm((f) => ({ ...f, address: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Comuna</label>
                      <input value={createForm.commune}
                        onChange={(e) => setCreateForm((f) => ({ ...f, commune: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Ciudad</label>
                      <input value={createForm.city}
                        onChange={(e) => setCreateForm((f) => ({ ...f, city: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                    </div>
                  </>
                )}
                <div className={createForm.fulfillmentType === 'DELIVERY' ? '' : 'col-span-3'}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Notas internas</label>
                  <input value={createForm.notes}
                    onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
              </div>
            </div>

            {createError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{createError}</p>
            )}
            <div className="flex gap-2">
              <button type="submit" disabled={createLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {createLoading ? 'Creando...' : 'Crear orden'}
              </button>
              <button type="button" onClick={() => setShowCreate(false)}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Status tabs */}
      <div className="flex gap-1 mb-4 flex-wrap">
        {STATUS_TABS.map((t) => (
          <button key={t.key} onClick={() => changeTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              statusFilter === t.key
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}>
            {t.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-400 self-center">{total} órdenes</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-gray-600 font-medium"># Orden</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Cliente</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Tipo</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Canal</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Bodega</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Estado</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Fecha</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Cargando...</td></tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                  <p className="text-sm mb-1">Sin órdenes</p>
                  {isAdmin && <p className="text-xs">Crea la primera orden con el botón "+ Nueva orden"</p>}
                </td>
              </tr>
            ) : orders.map((o) => {
              const cfg = STATUS_CONFIG[o.status] ?? { label: o.status, color: 'bg-gray-100 text-gray-500' };
              return (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs font-bold text-gray-700">
                    #{shortId(o.id)}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 text-xs">{o.customerName || <span className="text-gray-400">—</span>}</p>
                    {o.customerPhone && <p className="text-xs text-gray-400">{o.customerPhone}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      o.fulfillmentType === 'DELIVERY' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {FULFILLMENT_LABEL[o.fulfillmentType]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {o.sale ? CHANNEL_LABEL[o.sale.channel] || o.sale.channel : 'Manual'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {o.warehouse?.name || <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.color}`}>
                      {cfg.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {new Date(o.createdAt).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/orders/${o.id}`}
                      className="text-xs text-blue-500 hover:text-blue-700 font-medium">
                      Ver →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button disabled={page <= 1} onClick={() => load(page - 1)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50">
            ← Anterior
          </button>
          <span className="text-sm text-gray-500">Página {page} de {pages}</span>
          <button disabled={page >= pages} onClick={() => load(page + 1)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50">
            Siguiente →
          </button>
        </div>
      )}
    </div>
  );
}

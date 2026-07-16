'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  PENDING:    { label: 'Pendiente',  color: 'bg-amber-100 text-amber-700' },
  PREPARING:  { label: 'Preparando', color: 'bg-blue-100 text-blue-700' },
  READY:      { label: 'Listo',      color: 'bg-indigo-100 text-indigo-700' },
  IN_TRANSIT: { label: 'En camino',  color: 'bg-yellow-100 text-yellow-700' },
  DELIVERED:  { label: 'Entregado',  color: 'bg-green-100 text-green-700' },
  CANCELLED:  { label: 'Cancelado',  color: 'bg-gray-100 text-gray-500' },
};

const CHANNEL_LABEL: Record<string, string> = {
  POS: 'POS', MERCADO_LIBRE: 'Mercado Libre', SHOPIFY: 'Shopify',
  WOOCOMMERCE: 'WooCommerce', JUMPSELLER: 'JumpSeller', FALABELLA: 'Falabella',
  PARIS: 'Paris', HITES: 'Hites', RIPLEY: 'Ripley', WALMART: 'Walmart', MANUAL: 'Manual',
};

function KpiCard({
  title, value, sub, colorClass, icon,
}: {
  title: string; value: string | number; sub?: string; colorClass: string; icon: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 flex items-start gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0 ${colorClass}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-400 font-medium mb-0.5">{title}</p>
        <p className="text-2xl font-bold text-gray-900 leading-tight">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const [companies, setCompanies] = useState<any[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');

  const [summary, setSummary] = useState<any>(null);
  const [weeklyData, setWeeklyData] = useState<any[]>([]);
  const [urgentOrders, setUrgentOrders] = useState<any[]>([]);
  const [activeOrdersCount, setActiveOrdersCount] = useState(0);
  const [recentSales, setRecentSales] = useState<any[]>([]);
  const [criticalProducts, setCriticalProducts] = useState<any[]>([]);

  useEffect(() => {
    const u = getUser();
    const token = getToken();
    if (!u || !token) return;
    if (u.role === 'VENDEDOR') { router.replace('/dashboard/pos'); return; }
    if (u.role === 'DESPACHADOR') { router.replace('/dashboard/mis-rutas'); return; }
    setUser(u);
    if (u.role === 'SUPER_ADMIN') {
      api.companies.list(token).then(setCompanies).catch(() => {});
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!token || !user) return;
    if (isSuperAdmin && !selectedCompanyId) return;

    setLoading(true);
    const companyId = isSuperAdmin ? selectedCompanyId : undefined;
    const today = new Date().toISOString().split('T')[0];

    Promise.all([
      api.pos.summary({ companyId, date: today }, token).catch(() => null),
      api.pos.weeklySales(token, { companyId }).catch(() => []),
      api.orders.list(token, { companyId, status: 'PENDING' }).catch(() => ({ orders: [], total: 0 })),
      api.orders.list(token, { companyId, status: 'PREPARING' }).catch(() => ({ orders: [], total: 0 })),
      api.orders.list(token, { companyId, status: 'READY' }).catch(() => ({ orders: [], total: 0 })),
      api.pos.listSales({ companyId, page: 1 }, token).catch(() => ({ sales: [] })),
      api.catalog.list(token, companyId).catch(() => []),
    ]).then(([sum, weekly, pending, preparing, ready, sales, products]) => {
      setSummary(sum);
      setWeeklyData(weekly as any[]);

      const pendingR = pending as any;
      const preparingR = preparing as any;
      const readyR = ready as any;

      const combined = [
        ...(pendingR.orders || []),
        ...(preparingR.orders || []),
        ...(readyR.orders || []),
      ].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5);

      setUrgentOrders(combined);
      setActiveOrdersCount((pendingR.total || 0) + (preparingR.total || 0) + (readyR.total || 0));
      setRecentSales(((sales as any).sales || []).slice(0, 5));

      const critical = (products as any[])
        .filter((p: any) => p.active && p.stock <= 3)
        .sort((a: any, b: any) => a.stock - b.stock)
        .slice(0, 6);
      setCriticalProducts(critical);
    }).finally(() => setLoading(false));
  }, [user, isSuperAdmin, selectedCompanyId]);

  const maxWeekly = Math.max(...weeklyData.map(d => d.total), 1);

  const now = new Date();
  const dateLabel = now.toLocaleDateString('es-CL', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  if (isSuperAdmin && !selectedCompanyId) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Bienvenido, {user?.name}</h1>
            <p className="text-sm text-gray-400 mt-0.5">Super Administrador</p>
          </div>
          <p className="text-sm text-gray-400 capitalize hidden sm:block">{dateLabel}</p>
        </div>
        <div className="flex flex-col items-center justify-center gap-4 text-center border border-dashed border-gray-300 rounded-2xl py-20">
          <p className="text-3xl">🏢</p>
          <p className="text-sm text-gray-400">Selecciona una empresa para ver su panel.</p>
          <select
            value={selectedCompanyId}
            onChange={(e) => setSelectedCompanyId(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white font-medium"
          >
            <option value="">— Selecciona una empresa —</option>
            {companies.map((c: any) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 text-sm">Cargando dashboard...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Bienvenido, {user?.name}
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {isSuperAdmin
              ? companies.find((c: any) => c.id === selectedCompanyId)?.name
              : user?.company?.name || 'Super Administrador'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isSuperAdmin && (
            <select
              value={selectedCompanyId}
              onChange={(e) => setSelectedCompanyId(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white font-medium"
            >
              {companies.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <p className="text-sm text-gray-400 capitalize hidden sm:block">{dateLabel}</p>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Ventas hoy"
          value={summary?.totalSales ?? 0}
          sub="transacciones"
          colorClass="bg-blue-50 text-blue-500"
          icon="🛒"
        />
        <KpiCard
          title="Ingresos hoy"
          value={`$${Number(summary?.totalRevenue ?? 0).toLocaleString('es-CL')}`}
          sub="total del día"
          colorClass="bg-green-50 text-green-500"
          icon="💰"
        />
        <KpiCard
          title="Órdenes activas"
          value={activeOrdersCount}
          sub="pendiente / preparando / listo"
          colorClass="bg-amber-50 text-amber-500"
          icon="📦"
        />
        <KpiCard
          title="Stock crítico"
          value={criticalProducts.length}
          sub="productos ≤ 3 unidades"
          colorClass={criticalProducts.length > 0 ? 'bg-red-50 text-red-500' : 'bg-gray-50 text-gray-400'}
          icon="⚠️"
        />
      </div>

      {/* Fila central — gráfico + órdenes urgentes */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* Gráfico de ventas 7 días */}
        <div className="lg:col-span-3 bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-semibold text-gray-800">Ventas últimos 7 días</h2>
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-blue-500 inline-block" /> POS
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-indigo-400 inline-block" /> E-commerce
              </span>
            </div>
          </div>

          {weeklyData.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-12">Sin datos de ventas</p>
          ) : (
            <div className="flex items-end gap-2" style={{ height: '144px' }}>
              {weeklyData.map((day) => {
                const totalH = maxWeekly > 0 ? Math.max((day.total / maxWeekly) * 128, day.total > 0 ? 4 : 0) : 0;
                const posH = day.total > 0 ? (day.posTotal / day.total) * totalH : 0;
                const ecomH = totalH - posH;
                return (
                  <div key={day.date} className="flex-1 flex flex-col items-center gap-1.5">
                    <div className="w-full flex flex-col justify-end" style={{ height: '128px' }}>
                      <div className="w-full flex flex-col-reverse rounded-t-md overflow-hidden" style={{ height: `${totalH}px` }}>
                        <div style={{ height: `${posH}px` }} className="bg-blue-500 shrink-0" />
                        <div style={{ height: `${ecomH}px` }} className="bg-indigo-400 shrink-0" />
                      </div>
                    </div>
                    <div className="text-center">
                      {day.count > 0 && (
                        <p className="text-xs font-semibold text-gray-600">
                          ${day.total >= 1000 ? `${(day.total / 1000).toFixed(0)}k` : day.total}
                        </p>
                      )}
                      <p className="text-xs text-gray-400 leading-tight capitalize">{day.label}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Órdenes urgentes */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-200 p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-800">Órdenes urgentes</h2>
            <Link href="/dashboard/orders" className="text-xs text-blue-500 hover:text-blue-700 font-medium">
              Ver todas →
            </Link>
          </div>

          {urgentOrders.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-gray-400 text-center py-4">Sin órdenes activas</p>
            </div>
          ) : (
            <div className="flex-1 space-y-2">
              {urgentOrders.map((order: any) => {
                const badge = STATUS_BADGE[order.status] ?? STATUS_BADGE.PENDING;
                const shortId = order.id.slice(-6).toUpperCase();
                return (
                  <Link
                    key={order.id}
                    href={`/dashboard/orders/${order.id}`}
                    className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold text-gray-600">#{shortId}</span>
                        <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${badge.color}`}>
                          {badge.label}
                        </span>
                        <span className={`text-xs ${order.fulfillmentType === 'DELIVERY' ? 'text-blue-500' : 'text-gray-400'}`}>
                          {order.fulfillmentType === 'DELIVERY' ? '🚚' : '🏬'}
                        </span>
                      </div>
                      {order.customerName && (
                        <p className="text-xs text-gray-500 truncate mt-0.5">{order.customerName}</p>
                      )}
                    </div>
                    <span className="text-gray-300 text-sm shrink-0">›</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Fila inferior — últimas ventas + stock crítico */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* Últimas ventas */}
        <div className="lg:col-span-3 bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-800">Últimas ventas</h2>
            <Link href="/dashboard/sales" className="text-xs text-blue-500 hover:text-blue-700 font-medium">
              Ver todas →
            </Link>
          </div>

          {recentSales.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Sin ventas recientes</p>
          ) : (
            <div className="space-y-0">
              {recentSales.map((sale: any, i: number) => (
                <div
                  key={sale.id}
                  className={`flex items-center gap-3 py-2.5 ${i < recentSales.length - 1 ? 'border-b border-gray-50' : ''}`}
                >
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-blue-600">
                      {CHANNEL_LABEL[sale.channel]?.slice(0, 2) ?? 'PO'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">
                      {CHANNEL_LABEL[sale.channel] ?? sale.channel}
                    </p>
                    <p className="text-xs text-gray-400">
                      {new Date(sale.createdAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                      {sale.customerName && ` · ${sale.customerName}`}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-gray-900 shrink-0">
                    ${Number(sale.total).toLocaleString('es-CL')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Stock crítico */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-800">Stock crítico</h2>
            <Link href="/dashboard/catalog" className="text-xs text-blue-500 hover:text-blue-700 font-medium">
              Ver catálogo →
            </Link>
          </div>

          {criticalProducts.length === 0 ? (
            <div className="flex items-center justify-center py-6">
              <div className="text-center">
                <p className="text-2xl mb-1">✅</p>
                <p className="text-sm text-gray-400">Sin alertas de stock</p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {criticalProducts.map((p: any) => (
                <div key={p.id} className="flex items-center gap-3">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                    p.stock === 0 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
                  }`}>
                    {p.stock}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate leading-tight">{p.name}</p>
                    <p className="text-xs text-gray-400 font-mono">{p.sku}</p>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                    p.stock === 0 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
                  }`}>
                    {p.stock === 0 ? 'Sin stock' : `${p.stock} ud.`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

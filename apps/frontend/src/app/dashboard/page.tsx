'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getToken, getUser } from '@/lib/auth';
import { api, imgUrl } from '@/lib/api';
import { PageHeader, SectionCard } from '@/components/ui';
import { useAdminCompany } from './AdminCompanyContext';
import { useDashboardTimezone, dateKeyInTz } from '@/lib/dashboardTimezone';
import { onActivity } from '@/lib/activityBus';

// "1804k" (el número completo pegado a una "k" minúscula) se leía ambiguo — ¿mil ochocientos
// cuatro, o 1804 "k" de algo? Notación compacta estándar (1,8 M / 450 k) separa el número de
// la magnitud y usa coma decimal como el resto del panel (es-CL).
const compactCLP = new Intl.NumberFormat('es-CL', { notation: 'compact', maximumFractionDigits: 1 });
function fmtCompactCLP(v: number) {
  return `$${compactCLP.format(v)}`;
}

function primaryImageUrl(product: any): string | undefined {
  const img = product?.images?.find((i: any) => i.isPrimary) || product?.images?.[0];
  return img ? imgUrl(img.url) : undefined;
}

// Botón de fila calcado del "Top 10 productos más vendidos" de la referencia: neutro en
// reposo, se pone verde cuando se pasa el mouse por toda la fila (no solo por el botón).
function RowOpenIcon() {
  return (
    <span className="w-7 h-7 rounded-lg bg-[var(--surface-soft)] border border-[var(--border)] text-[var(--text-muted)] flex items-center justify-center shrink-0 transition-colors group-hover:bg-emerald-500 group-hover:border-emerald-500 group-hover:text-white">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 17 17 7M9 7h8v8" />
      </svg>
    </span>
  );
}

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
  title, value, sub, colorClass, icon, href,
}: {
  title: string; value: string | number; sub?: string; colorClass: string; icon: string; href?: string;
}) {
  const content = (
    <div className="ui-card p-5 flex items-start gap-4 h-full transition-shadow hover:shadow-md hover:border-[var(--border-strong,#d1d5db)]">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0 ${colorClass}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-[var(--text-muted)] font-medium mb-0.5">{title}</p>
        <p className="text-2xl font-bold text-[var(--text)] leading-tight tracking-tight">{value}</p>
        {sub && <p className="text-xs text-[var(--text-muted)] mt-0.5">{sub}</p>}
      </div>
    </div>
  );
  return href ? <Link href={href} className="block">{content}</Link> : content;
}

export default function DashboardPage() {
  const router = useRouter();
  const { selectedCompanyId, companies } = useAdminCompany();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const tz = useDashboardTimezone();

  const [summary, setSummary] = useState<any>(null);
  const [storeBreakdown, setStoreBreakdown] = useState<any[]>([]);
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
  }, []);

  const loadDashboard = useCallback(() => {
    const token = getToken();
    if (!token || !user) return;
    if (isSuperAdmin && !selectedCompanyId) return;

    setLoading(true);
    const companyId = isSuperAdmin ? selectedCompanyId : undefined;
    const today = dateKeyInTz(tz);

    Promise.all([
      api.pos.summary({ companyId, date: today }, token).catch(() => null),
      api.orders.list(token, { companyId, status: 'PENDING' }).catch(() => ({ orders: [], total: 0 })),
      api.orders.list(token, { companyId, status: 'PREPARING' }).catch(() => ({ orders: [], total: 0 })),
      api.orders.list(token, { companyId, status: 'READY' }).catch(() => ({ orders: [], total: 0 })),
      api.pos.listSales({ companyId, page: 1 }, token).catch(() => ({ sales: [] })),
      api.catalog.list(token, companyId).catch(() => []),
    ]).then(([sum, pending, preparing, ready, sales, products]) => {
      setSummary(sum);

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
        .filter((p: any) => p.active && p.stock <= (p.criticalStock ?? 0))
        .sort((a: any, b: any) => a.stock - b.stock)
        .slice(0, 6);
      setCriticalProducts(critical);
    }).finally(() => setLoading(false));
  }, [user, isSuperAdmin, selectedCompanyId, tz]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);
  useEffect(() => onActivity(['sale', 'question', 'claim'], loadDashboard), [loadDashboard]);

  // Widget "Reportes de ventas" (calcado del de coremarkets.cl): tabs de período + filtro
  // de canal, con su propia carga independiente del resto del dashboard.
  const REPORT_PERIODS = [
    { key: '12m', label: '12 meses' },
    { key: '6m', label: '6 meses' },
    { key: '30d', label: '30 días' },
    { key: '7d', label: '7 días' },
  ] as const;
  type ReportPeriod = typeof REPORT_PERIODS[number]['key'];

  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>('12m');
  const [reportChannel, setReportChannel] = useState('');
  const [reportData, setReportData] = useState<any[]>([]);
  const [reportLoading, setReportLoading] = useState(true);
  const isDailyReport = reportPeriod === '30d' || reportPeriod === '7d';

  const loadReport = useCallback(() => {
    const token = getToken();
    if (!token || !user) return;
    if (isSuperAdmin && !selectedCompanyId) return;

    setReportLoading(true);
    const companyId = isSuperAdmin ? selectedCompanyId : undefined;
    const channel = reportChannel || undefined;

    const req = isDailyReport
      ? api.pos.weeklySales(token, { companyId, days: reportPeriod === '30d' ? 30 : 7, channel }).then((r) => r.days)
      : api.pos.monthlySales(token, { companyId, months: reportPeriod === '12m' ? 12 : 6, channel }).then((r) => r.months);

    req.then((rows) => setReportData(rows || [])).catch(() => setReportData([])).finally(() => setReportLoading(false));
  }, [user, isSuperAdmin, selectedCompanyId, reportPeriod, reportChannel, isDailyReport]);

  useEffect(() => { loadReport(); }, [loadReport]);
  useEffect(() => onActivity(['sale'], loadReport), [loadReport]);

  const [reportChartReady, setReportChartReady] = useState(false);
  useEffect(() => {
    if (reportLoading) { setReportChartReady(false); return; }
    const raf = requestAnimationFrame(() => setReportChartReady(true));
    return () => cancelAnimationFrame(raf);
  }, [reportLoading]);

  // "Ventas por tienda": mismos tabs de período que "Historial de Ventas", pero con "Hoy"
  // en vez de "7 días" — igual que "Participación de cada canal" en la referencia.
  const STORE_PERIODS = [
    { key: '12m', label: '12 meses', days: 365 },
    { key: '6m', label: '6 meses', days: 182 },
    { key: '30d', label: '30 días', days: 30 },
    { key: 'hoy', label: 'Hoy', days: 1 },
  ] as const;
  type StorePeriod = typeof STORE_PERIODS[number]['key'];

  const [storePeriod, setStorePeriod] = useState<StorePeriod>('12m');
  const [storeLoading, setStoreLoading] = useState(true);

  const loadStoreBreakdown = useCallback(() => {
    const token = getToken();
    if (!token || !user) return;
    if (isSuperAdmin && !selectedCompanyId) return;

    setStoreLoading(true);
    const companyId = isSuperAdmin ? selectedCompanyId : undefined;
    const days = STORE_PERIODS.find((p) => p.key === storePeriod)?.days ?? 365;

    api.pos.weeklySales(token, { companyId, days })
      .then((r) => setStoreBreakdown(r.byStore || []))
      .catch(() => setStoreBreakdown([]))
      .finally(() => setStoreLoading(false));
  }, [user, isSuperAdmin, selectedCompanyId, storePeriod]);

  useEffect(() => { loadStoreBreakdown(); }, [loadStoreBreakdown]);
  useEffect(() => onActivity(['sale'], loadStoreBreakdown), [loadStoreBreakdown]);

  const [storeChartReady, setStoreChartReady] = useState(false);
  useEffect(() => {
    if (storeLoading) { setStoreChartReady(false); return; }
    const raf = requestAnimationFrame(() => setStoreChartReady(true));
    return () => cancelAnimationFrame(raf);
  }, [storeLoading]);

  const reportMax = Math.max(...reportData.map((d) => d.total), 1);
  const reportTotal = reportData.reduce((s, d) => s + (d.total || 0), 0);
  const reportAvg = reportData.length > 0 ? reportTotal / reportData.length : 0;

  const DONUT_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#8b5cf6', '#ec4899', '#64748b'];
  const totalStoreSales = storeBreakdown.reduce((s, x) => s + x.count, 0);
  let donutCumulative = 0;
  const donutSegments = storeBreakdown.map((s, i) => {
    const pct = totalStoreSales > 0 ? (s.count / totalStoreSales) * 100 : 0;
    const segment = { ...s, pct, color: DONUT_COLORS[i % DONUT_COLORS.length], offset: 25 - donutCumulative };
    donutCumulative += pct;
    return segment;
  });

  const now = new Date();
  const todayStr = dateKeyInTz(tz, now);
  const dateLabel = now.toLocaleDateString('es-CL', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz,
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="w-8 h-8 border-4 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
        <p className="text-gray-400 text-sm">Cargando dashboard...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      <PageHeader
        title={`Bienvenido, ${user?.name ?? ''}`}
        crumbs={[
          { label: 'Inicio' },
          {
            label: isSuperAdmin
              ? (companies.find((c: any) => c.id === selectedCompanyId)?.name || 'Empresa')
              : (user?.company?.name || 'Super Administrador'),
          },
        ]}
        updatedAt={new Date()}
        actions={<span className="text-sm text-[var(--text-muted)] capitalize hidden sm:block">{dateLabel}</span>}
      />

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Ventas hoy"
          value={summary?.totalSales ?? 0}
          sub="transacciones · POS y e-commerce"
          colorClass="bg-blue-50 text-blue-500"
          icon="🛒"
          href={`/dashboard/sales?from=${todayStr}&to=${todayStr}`}
        />
        <KpiCard
          title="Ingresos hoy"
          value={`$${Number(summary?.totalRevenue ?? 0).toLocaleString('es-CL')}`}
          sub="total del día · POS y e-commerce"
          colorClass="bg-green-50 text-green-500"
          icon="💰"
          href={`/dashboard/sales?from=${todayStr}&to=${todayStr}`}
        />
        <KpiCard
          title="Órdenes activas"
          value={activeOrdersCount}
          sub="pendiente / preparando / listo"
          colorClass="bg-amber-50 text-amber-500"
          icon="📦"
          href="/dashboard/orders"
        />
        <KpiCard
          title="Stock crítico"
          value={criticalProducts.length}
          sub="bajo el umbral de cada producto"
          colorClass={criticalProducts.length > 0 ? 'bg-red-50 text-red-500' : 'bg-gray-50 text-gray-400'}
          icon="⚠️"
          href="/dashboard/catalog?stock=critical"
        />
      </div>

      {/* Fila de ventas — historial (2/3) + por tienda (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        <SectionCard
          title="Historial de Ventas"
          className="lg:col-span-2"
          actions={
            <div className="flex items-center gap-1 bg-[var(--surface-soft)] rounded-lg p-1">
              {REPORT_PERIODS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setReportPeriod(p.key)}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                    reportPeriod === p.key
                      ? 'bg-[var(--brand)] text-white'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          }
        >
          <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
            <div>
              <p className="text-xs text-[var(--text-muted)]">{isDailyReport ? 'Promedio por día' : 'Promedio por mes'}</p>
              <p className="text-2xl font-bold text-[var(--text)] leading-tight">${Math.round(reportAvg).toLocaleString('es-CL')}</p>
            </div>
            <div>
              <label className="block text-[11px] text-[var(--text-muted)] mb-1">Canal de venta</label>
              <select
                value={reportChannel}
                onChange={(e) => setReportChannel(e.target.value)}
                className="px-3 py-1.5 border border-[var(--border)] rounded-lg text-sm bg-[var(--surface)] text-[var(--text)]"
              >
                <option value="">Todos</option>
                {Object.entries(CHANNEL_LABEL).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          {reportData.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-12">Sin datos de ventas</p>
          ) : (
            <div className="flex items-end gap-1.5">
              {reportData.map((d, i) => {
                const h = reportMax > 0 ? Math.max((d.total / reportMax) * 128, d.total > 0 ? 4 : 0) : 0;
                const isCurrent = i === reportData.length - 1;
                return (
                  <div key={d.month || d.date || i} className="flex-1 flex flex-col items-center gap-1.5">
                    <div className="w-full h-32 flex flex-col justify-end relative">
                      {h > 0 ? (
                        <div className="w-full rounded-t-md bg-[var(--brand)] ease-out"
                          style={{ height: reportChartReady ? `${h}px` : '0px', transitionProperty: 'height', transitionDuration: '700ms', transitionDelay: `${i * 25}ms` }} />
                      ) : (
                        <div className="w-full h-0.5 rounded-full bg-[var(--border)]" />
                      )}
                    </div>
                    <div className="text-center">
                      {d.count > 0 ? (
                        <p className="text-xs font-semibold text-[var(--text-2)]">{fmtCompactCLP(d.total)}</p>
                      ) : (
                        <p className="text-xs text-[var(--text-muted)]">—</p>
                      )}
                      <p className={`text-xs leading-tight capitalize ${isCurrent ? 'font-semibold' : 'text-[var(--text-muted)]'}`}
                        style={isCurrent ? { color: 'var(--info)' } : undefined}>
                        {d.label}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Ventas por tienda"
          actions={
            <div className="flex items-center gap-1 bg-[var(--surface-soft)] rounded-lg p-1">
              {STORE_PERIODS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setStorePeriod(p.key)}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                    storePeriod === p.key
                      ? 'bg-[var(--brand)] text-white'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          }
        >
          {storeBreakdown.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-12">Sin ventas en este período</p>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="relative w-32 h-32 shrink-0">
                <svg viewBox="0 0 36 36" className="w-full h-full">
                  <circle cx="18" cy="18" r="15.915" fill="none" stroke="var(--border)" strokeWidth="3.5" />
                  {donutSegments.map((s, i) => (
                    <circle
                      key={i}
                      cx="18" cy="18" r="15.915" fill="none"
                      stroke={s.color} strokeWidth="3.5"
                      strokeDasharray={storeChartReady ? `${s.pct} ${100 - s.pct}` : '0 100'}
                      strokeDashoffset={s.offset}
                      style={{ transitionProperty: 'stroke-dasharray', transitionDuration: '900ms', transitionTimingFunction: 'cubic-bezier(.22,1,.36,1)', transitionDelay: `${i * 60}ms` }}
                    />
                  ))}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-lg font-bold text-[var(--text)]">{totalStoreSales}</span>
                  <span className="text-[10px] text-[var(--text-muted)]">ventas</span>
                </div>
              </div>
              <div className="w-full space-y-1.5">
                {donutSegments.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
                    <span className="flex-1 truncate text-[var(--text-2)]">{s.label}</span>
                    <span className="font-semibold text-[var(--text)]">{s.count}</span>
                    <span className="text-[var(--text-muted)] w-9 text-right">{Math.round(s.pct)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Fila operativa — órdenes urgentes + últimas ventas + stock crítico, en 3 columnas iguales */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        <SectionCard
          title="Órdenes urgentes"
          actions={
            <Link href="/dashboard/orders" className="text-xs text-blue-500 hover:text-blue-700 font-medium">
              Ver todas →
            </Link>
          }
        >
          {urgentOrders.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-10">Sin órdenes activas</p>
          ) : (
            <div className="divide-y divide-[var(--border-soft)]">
              {urgentOrders.map((order: any) => {
                const badge = STATUS_BADGE[order.status] ?? STATUS_BADGE.PENDING;
                const shortId = order.sale && order.sale.channel !== 'POS' && order.sale.externalId
                  ? order.sale.externalId
                  : order.id.slice(-6).toUpperCase();
                return (
                  <Link
                    key={order.id}
                    href={`/dashboard/orders/${order.id}`}
                    className="group relative flex items-center gap-3 px-2.5 py-2.5 -mx-2.5 rounded-xl transition-shadow duration-150 hover:shadow-md hover:z-10"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-xs font-semibold ${badge.color}`}>
                          {badge.label}
                        </span>
                        <span className="shrink-0 font-mono text-xs font-bold text-gray-600">#{shortId}</span>
                        {order.customerName && (
                          <span className="text-xs text-gray-600 truncate">{order.customerName}</span>
                        )}
                        <span className={`shrink-0 text-xs ${order.fulfillmentType === 'DELIVERY' ? 'text-blue-500' : 'text-gray-400'}`}>
                          {order.fulfillmentType === 'DELIVERY' ? '🚚' : '🏬'}
                        </span>
                      </div>
                      {order.sale && (
                        <p className="text-xs text-gray-400 truncate mt-0.5">
                          {CHANNEL_LABEL[order.sale.channel] || order.sale.channel}
                          {order.sale.connection?.name && ` - ${order.sale.connection.name}`}
                        </p>
                      )}
                    </div>
                    <RowOpenIcon />
                  </Link>
                );
              })}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Últimas ventas"
          actions={
            <Link href="/dashboard/sales" className="text-xs text-blue-500 hover:text-blue-700 font-medium">
              Ver todas →
            </Link>
          }
        >
          {recentSales.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Sin ventas recientes</p>
          ) : (
            <div className="divide-y divide-[var(--border-soft)]">
              {recentSales.map((sale: any) => {
                const firstItem = sale.items?.[0];
                const photoUrl = primaryImageUrl(firstItem?.product);
                const extraItems = (sale.items?.length || 0) - 1;
                const description = firstItem?.product?.name
                  ? `${firstItem.product.name}${extraItems > 0 ? ` +${extraItems} más` : ''}`
                  : (CHANNEL_LABEL[sale.channel] ?? sale.channel);
                return (
                <Link
                  key={sale.id}
                  href="/dashboard/sales"
                  className="group relative flex items-center gap-3 px-2.5 py-2.5 -mx-2.5 rounded-xl transition-shadow duration-150 hover:shadow-md hover:z-10"
                >
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0 overflow-hidden">
                    {photoUrl ? (
                      <img src={photoUrl} alt={firstItem?.product?.name || ''} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xs font-bold text-blue-600">
                        {CHANNEL_LABEL[sale.channel]?.slice(0, 2) ?? 'PO'}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{description}</p>
                    <p className="text-xs text-gray-400 truncate">
                      {CHANNEL_LABEL[sale.channel] ?? sale.channel} · {new Date(sale.createdAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: tz })}
                      {sale.customerName && ` · ${sale.customerName}`}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-gray-900 shrink-0">
                    ${Number(sale.total).toLocaleString('es-CL')}
                  </span>
                  <RowOpenIcon />
                </Link>
                );
              })}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Stock crítico"
          actions={
            <Link href="/dashboard/catalog" className="text-xs text-blue-500 hover:text-blue-700 font-medium">
              Ver catálogo →
            </Link>
          }
        >
          {criticalProducts.length === 0 ? (
            <div className="flex items-center justify-center py-6">
              <div className="text-center">
                <p className="text-2xl mb-1">✅</p>
                <p className="text-sm text-gray-400">Sin alertas de stock</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-soft)]">
              {criticalProducts.map((p: any) => {
                const photoUrl = primaryImageUrl(p);
                return (
                <Link
                  key={p.id}
                  href="/dashboard/catalog?stock=critical"
                  className="group relative flex items-center gap-3 px-2.5 py-2.5 -mx-2.5 rounded-xl transition-shadow duration-150 hover:shadow-md hover:z-10"
                >
                  <div className="w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center overflow-hidden shrink-0">
                    {photoUrl ? (
                      <img src={photoUrl} alt={p.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-gray-300 text-xs">—</span>
                    )}
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
                  <RowOpenIcon />
                </Link>
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

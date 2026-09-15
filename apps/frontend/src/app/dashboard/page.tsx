'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
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
  PARIS: 'Paris', HITES: 'Hites', RIPLEY: 'Ripley', WALMART: 'Walmart', MANUAL: 'Manual', ORDER_REQUEST: 'Solicitud de pedido',
};

// Sombra más marcada que la de `.ui-card` para que los recuadros del dashboard
// se vean "levantados" (efecto 3D), sin tocar el shadow por defecto del resto del panel.
const CARD_SHADOW: CSSProperties = { boxShadow: '0 10px 24px rgba(43,42,39,0.12), 0 2px 6px rgba(43,42,39,0.08)' };

function KpiCard({
  title, value, sub, colorClass, icon, href,
}: {
  title: string; value: string | number; sub?: string; colorClass: string; icon: string; href?: string;
}) {
  const content = (
    <div className="ui-card p-5 flex items-start gap-4 h-full transition-shadow hover:shadow-md hover:border-[var(--border-strong,#d1d5db)]"
      style={CARD_SHADOW}>
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
  const { selectedCompanyId, companies, openPicker } = useAdminCompany();
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

  // Filtro de período compartido por "Historial de Ventas" y "Ventas por Canal - Tienda":
  // los tabs viven en el header de "Ventas por Canal - Tienda", pero ambas tarjetas
  // reaccionan al mismo valor.
  const DASHBOARD_PERIODS = [
    { key: '12m', label: '12 meses' },
    { key: '6m', label: '6 meses' },
    { key: '15d', label: '15 días' },
    { key: '7d', label: '7 días' },
    { key: 'hoy', label: 'Hoy' },
  ] as const;
  type DashboardPeriod = typeof DASHBOARD_PERIODS[number]['key'];

  const [dashboardPeriod, setDashboardPeriod] = useState<DashboardPeriod>('12m');
  const isDailyPeriod = dashboardPeriod !== '12m' && dashboardPeriod !== '6m';
  const periodDays = dashboardPeriod === '15d' ? 15 : dashboardPeriod === '7d' ? 7 : dashboardPeriod === 'hoy' ? 1
    : dashboardPeriod === '12m' ? 365 : 182;

  const [reportChannel, setReportChannel] = useState('');
  const [reportData, setReportData] = useState<any[]>([]);
  const [reportLoading, setReportLoading] = useState(true);

  const loadReport = useCallback(() => {
    const token = getToken();
    if (!token || !user) return;
    if (isSuperAdmin && !selectedCompanyId) return;

    setReportLoading(true);
    const companyId = isSuperAdmin ? selectedCompanyId : undefined;
    const channel = reportChannel || undefined;

    const req = isDailyPeriod
      ? api.pos.weeklySales(token, { companyId, days: periodDays, channel }).then((r) => r.days)
      : api.pos.monthlySales(token, { companyId, months: dashboardPeriod === '12m' ? 12 : 6, channel }).then((r) => r.months);

    req.then((rows) => setReportData(rows || [])).catch(() => setReportData([])).finally(() => setReportLoading(false));
  }, [user, isSuperAdmin, selectedCompanyId, dashboardPeriod, isDailyPeriod, periodDays, reportChannel]);

  useEffect(() => { loadReport(); }, [loadReport]);
  useEffect(() => onActivity(['sale'], loadReport), [loadReport]);

  const [reportChartReady, setReportChartReady] = useState(false);
  useEffect(() => {
    if (reportLoading) { setReportChartReady(false); return; }
    const raf = requestAnimationFrame(() => setReportChartReady(true));
    return () => cancelAnimationFrame(raf);
  }, [reportLoading]);

  const [storeLoading, setStoreLoading] = useState(true);

  const loadStoreBreakdown = useCallback(() => {
    const token = getToken();
    if (!token || !user) return;
    if (isSuperAdmin && !selectedCompanyId) return;

    setStoreLoading(true);
    const companyId = isSuperAdmin ? selectedCompanyId : undefined;

    api.pos.weeklySales(token, { companyId, days: periodDays })
      .then((r) => setStoreBreakdown(r.byStore || []))
      .catch(() => setStoreBreakdown([]))
      .finally(() => setStoreLoading(false));
  }, [user, isSuperAdmin, selectedCompanyId, periodDays]);

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
    <div className="space-y-3">

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
        metaBelow
        tight
        titleActions={isSuperAdmin && selectedCompanyId ? (
          <button
            onClick={openPicker}
            title="Cambiar empresa"
            className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-900 text-xs font-medium hover:bg-blue-100 max-w-full truncate"
          >
            Gestionando <strong className="truncate">{companies.find((c: any) => c.id === selectedCompanyId)?.name ?? 'empresa'}</strong>
            <span className="text-blue-500">▾</span>
          </button>
        ) : undefined}
      />

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
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

      {/* Fila de ventas — historial y ventas por canal a mitades iguales */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">

        <SectionCard
          title={<span className="font-bold text-sm text-[var(--text)]">Historial de Ventas</span>}
          style={CARD_SHADOW}
        >
          <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
            <div>
              <p className="text-[11.5px] text-[var(--text-muted)]">{isDailyPeriod ? 'Promedio por día' : 'Promedio por mes'}</p>
              <p className="text-[22px] font-extrabold text-[var(--text)] leading-tight">${Math.round(reportAvg).toLocaleString('es-CL')}</p>
            </div>
            <div>
              <label className="block text-[11px] text-[var(--text-muted)] mb-1">Canal de venta</label>
              <select
                value={reportChannel}
                onChange={(e) => setReportChannel(e.target.value)}
                className="px-4 py-2 border border-[var(--border)] rounded-lg text-sm bg-white text-[var(--text)]"
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
              {/* Con muchas columnas (30 días) no entra un valor permanente por barra sin
                  truncarse a algo ilegible — ahí el valor solo aparece al pasar el mouse,
                  con su propio fondo, para poder mostrarse completo sin chocar con los vecinos. */}
              {reportData.map((d, i) => {
                const isDense = reportData.length > 15;
                // Escala a 108px (no a los 128px del alto real del cuadro) para dejar
                // siempre ~20px libres arriba de la barra más alta y que el valor
                // flotante nunca se salga del recuadro de la columna.
                const h = reportMax > 0 ? Math.max((d.total / reportMax) * 108, d.total > 0 ? 4 : 0) : 0;
                const isCurrent = i === reportData.length - 1;
                return (
                  <div key={d.month || d.date || i}
                    className="group flex-1 flex flex-col items-center gap-1.5 rounded-lg px-1 pt-1 pb-1.5 transition-colors hover:bg-[var(--brand-light)]">
                    <div className="w-full h-32 flex flex-col justify-end relative">
                      {h > 0 && (
                        <span
                          className={isDense
                            ? 'absolute left-1/2 -translate-x-1/2 z-20 whitespace-nowrap rounded-md border border-[var(--border-soft)] bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text)] shadow-sm opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100'
                            : 'absolute inset-x-0 text-center text-[10px] font-semibold text-[var(--text-2)] truncate px-0.5 transition-colors group-hover:text-[var(--text)]'
                          }
                          style={{
                            bottom: reportChartReady ? `${h + 4}px` : '4px',
                            transitionProperty: isDense ? 'opacity' : 'bottom, color',
                            transitionDuration: isDense ? '150ms' : '700ms',
                            transitionDelay: isDense ? '0ms' : `${i * 25}ms`,
                          }}
                        >
                          {fmtCompactCLP(d.total)}
                        </span>
                      )}
                      {h > 0 ? (
                        <div className="w-full rounded-t-md bg-[#b8ccfa] ease-out transition-colors group-hover:bg-[#9fb9f7]"
                          style={{ height: reportChartReady ? `${h}px` : '0px', transitionProperty: 'height, background-color', transitionDuration: '700ms', transitionDelay: `${i * 25}ms` }} />
                      ) : (
                        <div className="w-full h-0.5 rounded-full bg-[var(--border)]" />
                      )}
                    </div>
                    <p className={`text-xs leading-tight capitalize transition-colors group-hover:text-[var(--text)] ${isCurrent ? 'font-semibold' : 'text-[var(--text-muted)]'}`}
                      style={isCurrent ? { color: 'var(--info)' } : undefined}>
                      {d.label}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title={<span className="font-bold text-sm text-[var(--text)]">Ventas por Canal - Tienda</span>}
          style={CARD_SHADOW}
          actions={
            <div className="flex items-center gap-1 bg-white rounded-full p-1">
              {DASHBOARD_PERIODS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setDashboardPeriod(p.key)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                    dashboardPeriod === p.key
                      ? 'bg-[var(--brand)] text-[var(--text)]'
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
            <div className="flex flex-col sm:flex-row items-center gap-5">
              <div className="relative w-40 h-40 shrink-0">
                <svg viewBox="0 0 36 36" className="w-full h-full">
                  <circle cx="18" cy="18" r="15.915" fill="none" stroke="var(--border)" strokeWidth="3" />
                  {donutSegments.map((s, i) => (
                    <circle
                      key={i}
                      cx="18" cy="18" r="15.915" fill="none"
                      stroke={s.color} strokeWidth="3"
                      strokeDasharray={storeChartReady ? `${s.pct} ${100 - s.pct}` : '0 100'}
                      strokeDashoffset={s.offset}
                      style={{ transitionProperty: 'stroke-dasharray', transitionDuration: '900ms', transitionTimingFunction: 'cubic-bezier(.22,1,.36,1)', transitionDelay: `${i * 60}ms` }}
                    />
                  ))}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl font-bold text-[var(--text)]">{totalStoreSales}</span>
                  <span className="text-[11px] text-[var(--text-muted)]">ventas</span>
                </div>
              </div>

              {/* Tabla real (no un grid por fila) para que las columnas de todas las
                  filas — y el encabezado — queden alineadas entre sí. */}
              <div className="w-full flex-1 min-w-0 overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-[11px] font-medium text-[var(--text-muted)]">
                      <th className="text-left font-medium pb-2 pr-2">Canal</th>
                      <th className="text-right font-medium pb-2 px-2">Órdenes</th>
                      <th className="text-right font-medium pb-2 px-2">Ticket prom</th>
                      <th className="text-right font-medium pb-2 pl-2">Ventas totales</th>
                      <th className="w-7 pb-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-soft)]">
                    {donutSegments.map((s, i) => {
                      const avgTicket = s.count > 0 ? s.total / s.count : 0;
                      return (
                        <tr
                          key={i}
                          onClick={() => router.push(`/dashboard/sales?channel=${s.channel}`)}
                          className="group cursor-pointer transition-colors hover:bg-[var(--surface-soft)]"
                        >
                          <td className="py-2 pr-2">
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
                              <span className="truncate text-[var(--text-2)]">{s.label}</span>
                            </span>
                          </td>
                          <td className="text-right px-2 font-semibold text-[var(--text)]">{s.count}</td>
                          <td className="text-right px-2 text-[var(--text-2)]">${Math.round(avgTicket).toLocaleString('es-CL')}</td>
                          <td className="text-right pl-2 font-semibold text-[var(--text)]">${Math.round(s.total).toLocaleString('es-CL')}</td>
                          <td className="pl-2 py-2">
                            <RowOpenIcon />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Fila operativa — órdenes urgentes + últimas ventas + stock crítico, en 3 columnas iguales */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">

        <SectionCard
          title="Órdenes urgentes"
          style={CARD_SHADOW}
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
          style={CARD_SHADOW}
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
          style={CARD_SHADOW}
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

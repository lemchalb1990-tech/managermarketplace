'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getToken, getUser } from '@/lib/auth';
import { api, imgUrl, openBase64Pdf } from '@/lib/api';
import { useDashboardTimezone } from '@/lib/dashboardTimezone';
import { useAdminCompany } from '../AdminCompanyContext';
import { confirmDialog, alertDialog } from '../ConfirmDialog';
import { onActivity } from '@/lib/activityBus';
import ImageViewer from './[id]/ImageViewer';
import { SkeletonTable } from '@/components/Skeleton';
import { FilterBar, FilterField, FilterCount, filterSelectCls } from '@/components/FilterBar';

// Marketplaces que se pueden filtrar (enum del backend → slug del logo y nombre visible).
const MARKETPLACE_FILTERS: { key: string; slug: string; label: string }[] = [
  { key: 'MERCADO_LIBRE', slug: 'mercadolibre', label: 'Mercado Libre' },
  { key: 'FALABELLA', slug: 'falabella', label: 'Falabella' },
  { key: 'PARIS', slug: 'paris', label: 'Paris' },
  { key: 'RIPLEY', slug: 'ripley', label: 'Ripley' },
  { key: 'HITES', slug: 'hites', label: 'Hites' },
  { key: 'WALMART', slug: 'walmart', label: 'Walmart' },
  { key: 'JUMPSELLER', slug: 'jumpseller', label: 'JumpSeller' },
  { key: 'SHOPIFY', slug: 'shopify', label: 'Shopify' },
  { key: 'WOOCOMMERCE', slug: 'woocommerce', label: 'WooCommerce' },
];

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
  PARIS: 'Paris', HITES: 'Hites', RIPLEY: 'Ripley', WALMART: 'Walmart', MANUAL: 'Manual', ORDER_REQUEST: 'Solicitud de pedido',
};

type Viewer = { images: string[]; index: number; title?: string } | null;

// Productos de una orden: foto (clic = ampliar), nombre, SKU y cantidad. Se muestran todos.
function OrderProducts({ items, compact, onOpenImage }: { items: any[]; compact?: boolean; onOpenImage: (v: Viewer) => void }) {
  if (!items.length) return <p className="text-xs text-gray-400">Sin productos</p>;
  const size = compact ? 'w-9 h-9' : 'w-12 h-12';
  return (
    <ul className={compact ? 'space-y-1.5' : 'space-y-2'}>
      {items.map((it) => {
        const url = it.product?.images?.[0]?.url ? imgUrl(it.product.images[0].url) : null;
        const discrepancy = it.checked && it.checkedQty != null && it.checkedQty !== it.expectedQty;
        return (
          <li key={it.id} className="flex items-center gap-2">
            {url ? (
              <button type="button" aria-label={`Ver foto de ${it.productName}`} title="Ver foto en grande"
                onClick={(e) => { e.stopPropagation(); onOpenImage({ images: [url], index: 0, title: it.productName }); }}
                className={`relative ${size} shrink-0 rounded-md border border-gray-200 bg-white overflow-hidden hover:border-blue-400`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" loading="lazy" className="w-full h-full object-cover" />
              </button>
            ) : (
              <span className={`${size} shrink-0 rounded-md border border-gray-200 bg-gray-50 flex items-center justify-center text-gray-300`} title="Producto sin foto">📦</span>
            )}
            <div className="flex-1 min-w-0">
              <p className={`text-gray-800 leading-snug ${compact ? 'text-xs line-clamp-1' : 'text-sm line-clamp-2'}`} title={it.productName}>
                {it.checked && <span className={discrepancy ? 'text-amber-500' : 'text-green-600'}>{discrepancy ? '! ' : '✓ '}</span>}
                {it.productName}
              </p>
              <p className="text-[11px] text-gray-400 font-mono truncate">{it.productSku}</p>
            </div>
            <span className={`shrink-0 font-bold text-gray-800 ${compact ? 'text-xs' : 'text-sm'} ${it.expectedQty > 1 ? 'px-1.5 rounded bg-amber-100 text-amber-800' : ''}`}>
              ×{it.expectedQty}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const STATUS_TABS = [
  { key: '', label: 'Todas' },
  { key: 'PENDING', label: 'Pendientes' },
  { key: 'PREPARING', label: 'Preparando' },
  { key: 'READY', label: 'Listas' },
  { key: 'IN_TRANSIT', label: 'En camino' },
  { key: 'DELIVERED', label: 'Entregadas' },
  { key: 'CANCELLED', label: 'Canceladas' },
];


export default function OrdersPage() {
  const router = useRouter();
  const tz = useDashboardTimezone();
  const { isSuperAdmin, selectedCompanyId } = useAdminCompany();
  const [orders, setOrders] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  // Solo los marketplaces con alguna tienda activa en la empresa.
  const [activeMarketplaces, setActiveMarketplaces] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  // Orden por columna (clic en el título). Vacío = de la más reciente a la más antigua.
  const [sort, setSort] = useState<{ by: string; dir: 'asc' | 'desc' } | null>(null);
  const sortRef = useRef(sort);
  sortRef.current = sort;
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [deletingId, setDeletingId] = useState('');


  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkPrinting, setBulkPrinting] = useState(false);
  const [bulkError, setBulkError] = useState('');
  // Etiqueta en curso: `${orderId}:pack` (embalaje) o `${orderId}:detail` (con detalle).
  const [printingId, setPrintingId] = useState('');
  const [bulkMode, setBulkMode] = useState<'pack' | 'detail' | null>(null);
  const [viewer, setViewer] = useState<Viewer>(null);

  const isAdmin = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'].includes(currentUser?.role);
  // CompanyGate ya obliga a Super Admin a elegir empresa (y remonta esta página al
  // cambiarla); acá solo hace falta propagar esa empresa a cada llamada — sin esto,
  // Super Admin veía órdenes de TODAS las empresas mezcladas.
  const companyId = isSuperAdmin ? selectedCompanyId || undefined : undefined;

  async function load(p = 1, status = statusFilter, q = search, channel = channelFilter) {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      const res = await api.orders.list(token, { status: status || undefined, channel: channel || undefined, page: p, companyId, search: q || undefined, sortBy: sortRef.current?.by, sortDir: sortRef.current?.dir });
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
      api.marketplace.connections(token, companyId).catch(() => []),
      api.connections.list(token, { companyId }).catch(() => []),
    ]).then(([mlConns, otherConns]) => {
      const types = new Set<string>([
        ...(mlConns as any[]).filter((c) => c.active).map(() => 'MERCADO_LIBRE'),
        ...(otherConns as any[]).filter((c) => c.active).map((c) => c.marketplace),
      ]);
      setActiveMarketplaces(MARKETPLACE_FILTERS.filter((m) => types.has(m.key)).map((m) => m.key));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => onActivity(['sale'], () => load(page, statusFilter)), [page, statusFilter]);

  useEffect(() => {
    const t = setTimeout(() => load(1, statusFilter, search), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function handleDelete(id: string) {
    if (!(await confirmDialog('¿Eliminar esta orden de despacho? La venta se conserva (no se puede reimportar): para volver a crear su orden usa Ventas → "Crear orden de despacho". Esta acción no se puede deshacer.', { danger: true }))) return;
    setDeletingId(id);
    try {
      const token = getToken()!;
      await api.orders.remove(id, token, companyId);
      await load(page, statusFilter);
    } catch (err: any) {
      await alertDialog(err.message || 'No se pudo eliminar la orden.');
    } finally {
      setDeletingId('');
    }
  }

  function changeTab(key: string) {
    setStatusFilter(key);
    load(1, key);
  }

  // Clic en un título: ordena por esa columna (asc → desc → orden por defecto).
  function toggleSort(by: string) {
    const cur = sortRef.current;
    const next = !cur || cur.by !== by ? { by, dir: 'asc' as const } : cur.dir === 'asc' ? { by, dir: 'desc' as const } : null;
    setSort(next);
    sortRef.current = next;
    load(1);
  }
  function SortTh({ by, label, align = 'left' }: { by: string; label: string; align?: 'left' | 'right' }) {
    const active = sort?.by === by;
    return (
      <th className={`text-${align} px-3 py-3 text-gray-600 font-medium`}>
        <button type="button" onClick={() => toggleSort(by)} title="Ordenar"
          className={`inline-flex items-center gap-1 uppercase tracking-[inherit] hover:text-[var(--text)] ${active ? 'text-[var(--text)]' : ''}`}>
          {label}
          <span className="text-[9px]">{active ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
        </button>
      </th>
    );
  }

  function changeChannel(key: string) {
    setChannelFilter(key);
    load(1, statusFilter, search, key);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Solo las ventas con Mercado Envíos tienen etiqueta (las "a acordar" no).
  const hasMlLabel = (o: any) => o.sale?.channel === 'MERCADO_LIBRE' && !!o.sale?.mlShippingId;
  const mlOrdersOnPage = orders.filter(hasMlLabel);

  function toggleSelectAll() {
    const allIds = mlOrdersOnPage.map((o) => o.id);
    const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(allIds));
  }

  async function handleBulkPrint(withDetail = false) {
    if (selectedIds.size === 0) return;
    setBulkPrinting(true);
    setBulkMode(withDetail ? 'detail' : 'pack');
    setBulkError('');
    try {
      const token = getToken()!;
      const res = await api.marketplace.printLabelsBulk(Array.from(selectedIds), token, withDetail);
      res.pdfs.forEach((p) => openBase64Pdf(p.base64));
      const parts = [`${res.printed.length} etiqueta(s) impresa(s)`];
      if (res.errors.length) parts.push(`${res.errors.length} con error: ${res.errors.map((e) => e.message).join('; ')}`);
      setBulkError(res.errors.length ? parts.join(' — ') : '');
      setSelectedIds(new Set());
      await load(page, statusFilter);
    } catch (err: any) {
      setBulkError(err.message || 'No se pudieron imprimir las etiquetas.');
    } finally {
      setBulkPrinting(false);
      setBulkMode(null);
    }
  }


  const shortId = (id: string) => id.slice(-6).toUpperCase();
  // Carrito de ML: el número de la venta es el del pack (el que muestra Mercado Libre).
  const orderNumber = (o: any) => (o.sale?.mlPackId
    ? o.sale.mlPackId
    : o.sale && o.sale.channel !== 'POS' && o.sale.externalId ? o.sale.externalId : shortId(o.id));
  const packHint = (o: any) => (o.sale?.mlPackId
    ? `Pack · orden(es) ${[o.sale.externalId, ...(o.sale.mlMergedOrderIds || [])].filter(Boolean).join(', ')}`
    : undefined);
  // Mercado Libre guarda el código crudo en externalStatus y la traducción en el título.
  const marketplaceStatus = (o: any) => (o.statusEvents[0].source === 'MERCADO_LIBRE' ? o.statusEvents[0].title : o.statusEvents[0].externalStatus);

  // Etiqueta rápida (mismas reglas que el detalle): imprimir si está pendiente, reimprimir en preparación/lista.
  function labelAction(o: any): { primary: boolean } | null {
    if (!isAdmin || !hasMlLabel(o)) return null;
    if (o.status === 'PENDING') return { primary: true };
    if (o.status === 'PREPARING' || o.status === 'READY') return { primary: false };
    return null;
  }

  async function handlePrintOne(id: string, withDetail = false) {
    setPrintingId(`${id}:${withDetail ? 'detail' : 'pack'}`);
    setBulkError('');
    try {
      const token = getToken()!;
      await api.marketplace.printLabel(id, token, withDetail);
      await load(page, statusFilter);
    } catch (err: any) {
      setBulkError(err.message || 'No se pudo obtener la etiqueta de Mercado Libre.');
    } finally {
      setPrintingId('');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 sm:mb-6">
        <div className="min-w-0">
          <h1 className="ui-page-title">Órdenes</h1>
          <p className="ui-page-subtitle">Preparación y despacho de los pedidos de marketplaces y punto de venta.</p>
        </div>
      </div>

      <FilterBar
        search={{ label: 'Buscar orden', value: search, onChange: setSearch, placeholder: 'N° de orden o pack, seguimiento o cliente...' }}
        activeCount={[channelFilter, statusFilter].filter(Boolean).length}
        onClear={() => { setSearch(''); if (channelFilter) changeChannel(''); if (statusFilter) changeTab(''); }}
        summary={<FilterCount n={total} label="orden(es)" />}
      >
        <FilterField label="Estado">
          <select value={statusFilter} onChange={(e) => changeTab(e.target.value)} className={filterSelectCls}>
            {STATUS_TABS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </FilterField>
        {activeMarketplaces.length > 0 && (
          <FilterField label="Marketplace">
            <select value={channelFilter} onChange={(e) => changeChannel(e.target.value)} className={filterSelectCls}>
              <option value="">Todos</option>
              {MARKETPLACE_FILTERS.filter((m) => activeMarketplaces.includes(m.key)).map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </FilterField>
        )}
      </FilterBar>


      {selectedIds.size > 0 && (
        <div className="fixed md:static bottom-0 inset-x-0 z-30 md:z-auto flex flex-wrap items-center gap-2 sm:gap-3 md:mb-3 px-4 py-3 md:py-2 bg-amber-50 border-t md:border border-amber-200 md:rounded-lg shadow-lg md:shadow-none">
          <span className="text-xs text-amber-800">{selectedIds.size} orden(es) de Mercado Libre seleccionada(s)</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <button onClick={() => handleBulkPrint(false)} disabled={bulkPrinting}
              title="Solo las etiquetas de Mercado Envíos"
              className="px-3 py-2 md:py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50">
              {bulkMode === 'pack' ? 'Imprimiendo...' : `🏷 Etiquetas de embalaje (${selectedIds.size})`}
            </button>
            <button onClick={() => handleBulkPrint(true)} disabled={bulkPrinting}
              title="Cada etiqueta seguida de una página con los productos del pedido"
              className="px-3 py-2 md:py-1.5 border-2 border-amber-500 text-amber-800 bg-white hover:bg-amber-50 rounded-lg text-xs font-semibold disabled:opacity-50">
              {bulkMode === 'detail' ? 'Generando...' : `📋 Etiquetas con detalle (${selectedIds.size})`}
            </button>
          </div>
          <button onClick={() => setSelectedIds(new Set())} className="text-xs text-amber-700 hover:text-amber-900 underline">
            Quitar selección
          </button>
        </div>
      )}
      {bulkError && (
        <div className="mb-3 px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{bulkError}</div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200"><SkeletonTable rows={8} cols={6} /></div>
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-12 text-center text-gray-400">
          <p className="text-sm mb-1">Sin órdenes</p>
          <p className="text-xs">Las órdenes se crean solas con cada venta de los marketplaces o del punto de venta.</p>
        </div>
      ) : (
        <>
          {/* Celular / tablet: una tarjeta por orden con todos sus productos */}
          <div className="md:hidden space-y-3">
            {mlOrdersOnPage.length > 0 && (
              <label className="flex items-center gap-2 px-1 text-xs text-gray-600">
                <input type="checkbox" className="w-4 h-4"
                  checked={mlOrdersOnPage.every((o) => selectedIds.has(o.id))}
                  onChange={toggleSelectAll} />
                Seleccionar órdenes de Mercado Libre de esta página
              </label>
            )}
            {orders.map((o) => {
              const cfg = STATUS_CONFIG[o.status] ?? { label: o.status, color: 'bg-gray-100 text-gray-500' };
              const units = (o.itemChecks || []).reduce((s: number, i: any) => s + (i.expectedQty || 0), 0);
              const label = labelAction(o);
              return (
                <div key={o.id} onClick={() => router.push(`/dashboard/orders/${o.id}`)}
                  className={`bg-white rounded-xl border p-3 cursor-pointer active:bg-gray-50 ${selectedIds.has(o.id) ? 'border-amber-400 ring-1 ring-amber-300' : 'border-gray-200'}`}>
                  <div className="flex items-start gap-2">
                    {hasMlLabel(o) && (
                      <input type="checkbox" className="mt-0.5 w-4 h-4 shrink-0" aria-label="Seleccionar orden"
                        checked={selectedIds.has(o.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggleSelect(o.id)} />
                    )}
                    <p className="flex-1 min-w-0 font-mono text-xs font-bold text-gray-700 break-all" title={packHint(o)}>
                      #{orderNumber(o)}
                      {o.sale?.mlPackId && <span className="ml-1 font-sans font-medium text-[10px] px-1 py-0.5 rounded bg-sky-100 text-sky-700">pack</span>}
                    </p>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-gray-900">
                    {o.customerName || <span className="text-gray-400">Sin cliente</span>}
                    {o.commune && <span className="font-normal text-gray-500"> · {o.commune}</span>}
                  </p>
                  <p className="text-xs text-gray-500">
                    {o.sale ? `${CHANNEL_LABEL[o.sale.channel] || o.sale.channel}${o.sale.connection?.name ? ` · ${o.sale.connection.name}` : ''}` : 'Manual'}
                    {' · '}{FULFILLMENT_LABEL[o.fulfillmentType]}
                    {o.courier && ` · ${o.courier}`}
                    {o.sale?.channel === 'MERCADO_LIBRE' && !o.sale?.mlShippingId && (
                      <span className="ml-1 px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-medium">🤝 Acordar</span>
                    )}
                    {o.warehouse?.name && ` · ${o.warehouse.name}`}
                  </p>

                  <div className="mt-2 pt-2 border-t border-gray-100">
                    <OrderProducts items={o.itemChecks || []} onOpenImage={setViewer} />
                  </div>

                  <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between gap-2 text-xs">
                    <span className="text-gray-500">
                      {(o.itemChecks || []).length} producto(s) · {units} un.
                    </span>
                    {o.sale?.total != null && (
                      <span className="font-semibold text-gray-800">${Number(o.sale.total).toLocaleString('es-CL')}</span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-gray-400">
                    <span>{new Date(o.createdAt).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', timeZone: tz })}</span>
                    {o.statusEvents?.[0] && o.sale && (
                      <span className="text-purple-700 truncate">
                        {CHANNEL_LABEL[o.sale.channel] || o.sale.channel}: {marketplaceStatus(o)}
                      </span>
                    )}
                  </div>

                  {(label || currentUser?.role === 'SUPER_ADMIN') && (
                    <div className="mt-2 flex gap-2" onClick={(e) => e.stopPropagation()}>
                      {label && (
                        <>
                          <button onClick={() => handlePrintOne(o.id, false)} disabled={!!printingId}
                            className={`flex-1 py-2 rounded-lg text-xs font-semibold disabled:opacity-50 ${
                              label.primary ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'border border-amber-300 text-amber-700 hover:bg-amber-50'
                            }`}>
                            {printingId === `${o.id}:pack` ? 'Obteniendo...' : `🏷 ${label.primary ? '' : 'Reimprimir '}Embalaje`}
                          </button>
                          <button onClick={() => handlePrintOne(o.id, true)} disabled={!!printingId}
                            className="flex-1 py-2 rounded-lg text-xs font-semibold border border-amber-400 text-amber-800 hover:bg-amber-50 disabled:opacity-50">
                            {printingId === `${o.id}:detail` ? 'Generando...' : `📋 ${label.primary ? '' : 'Reimprimir '}Con detalle`}
                          </button>
                        </>
                      )}
                      {currentUser?.role === 'SUPER_ADMIN' && (
                        <button onClick={() => handleDelete(o.id)} disabled={deletingId === o.id}
                          className="px-3 py-2 rounded-lg text-sm text-red-500 border border-red-200 hover:bg-red-50 disabled:opacity-50">
                          {deletingId === o.id ? '...' : 'Eliminar'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Computador: tabla con columna de productos */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 w-8" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox"
                      checked={mlOrdersOnPage.length > 0 && mlOrdersOnPage.every((o) => selectedIds.has(o.id))}
                      onChange={toggleSelectAll} disabled={mlOrdersOnPage.length === 0} />
                  </th>
                  <SortTh by="order" label="# Orden" />
                  <SortTh by="customer" label="Cliente" />
                  <th className="text-left px-3 py-3 text-gray-600 font-medium min-w-[16rem]">Productos</th>
                  <SortTh by="channel" label="Canal" />
                  <SortTh by="status" label="Estado" />
                  <SortTh by="total" label="Total" align="right" />
                  <SortTh by="date" label="Fecha" />
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map((o) => {
                  const cfg = STATUS_CONFIG[o.status] ?? { label: o.status, color: 'bg-gray-100 text-gray-500' };
                  const label = labelAction(o);
                  return (
                    <tr key={o.id} onClick={() => router.push(`/dashboard/orders/${o.id}`)}
                      className={`hover:bg-gray-50 cursor-pointer align-top ${selectedIds.has(o.id) ? 'bg-amber-50/60' : ''}`}>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        {hasMlLabel(o) && (
                          <input type="checkbox" checked={selectedIds.has(o.id)} onChange={() => toggleSelect(o.id)} />
                        )}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs font-bold text-gray-700 whitespace-nowrap" title={packHint(o)}>
                        #{orderNumber(o)}
                        {o.sale?.mlPackId && <span className="block font-sans font-medium text-[10px] text-sky-700">pack</span>}
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-medium text-gray-900 text-xs">{o.customerName || <span className="text-gray-400">—</span>}</p>
                        {o.sale?.channel === 'MERCADO_LIBRE' && !o.sale?.mlShippingId && (
                          <span className="inline-block my-0.5 px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 text-[11px] font-medium"
                            title="Venta sin Mercado Envíos: la entrega se acuerda con el comprador">🤝 Acordar entrega</span>
                        )}
                        <p className="text-[11px] text-gray-400">
                          {FULFILLMENT_LABEL[o.fulfillmentType]}{o.commune ? ` · ${o.commune}` : ''}
                          {o.warehouse?.name && ` · ${o.warehouse.name}`}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <OrderProducts items={o.itemChecks || []} onOpenImage={setViewer} compact />
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-500">
                        {o.sale ? (
                          <>
                            {CHANNEL_LABEL[o.sale.channel] || o.sale.channel}
                            {o.sale.connection?.name && <span className="block text-[11px] text-gray-400">{o.sale.connection.name}</span>}
                          </>
                        ) : 'Manual'}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${cfg.color}`}>{cfg.label}</span>
                        {o.statusEvents?.[0] && o.sale && (
                          <span className="block mt-1 text-[11px] text-purple-700" title="Último estado informado por el marketplace">
                            {CHANNEL_LABEL[o.sale.channel] || o.sale.channel}: {marketplaceStatus(o)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-800 font-medium text-right whitespace-nowrap">
                        {o.sale?.total != null ? `$${Number(o.sale.total).toLocaleString('es-CL')}` : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-400 whitespace-nowrap">
                        {new Date(o.createdAt).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', timeZone: tz })}
                      </td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-col items-end gap-1.5">
                          {label && (
                            <div className="flex flex-col items-stretch gap-1">
                              <span className="text-[10px] text-gray-400 text-right">{label.primary ? 'Imprimir etiqueta' : 'Reimprimir etiqueta'}</span>
                              <button onClick={() => handlePrintOne(o.id, false)} disabled={!!printingId}
                                title="Solo la etiqueta de Mercado Envíos"
                                className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap disabled:opacity-50 ${
                                  label.primary ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'border border-amber-300 text-amber-700 hover:bg-amber-50'
                                }`}>
                                {printingId === `${o.id}:pack` ? 'Obteniendo...' : '🏷 Embalaje'}
                              </button>
                              <button onClick={() => handlePrintOne(o.id, true)} disabled={!!printingId}
                                title="La etiqueta + una página con los productos del pedido"
                                className="px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap border border-amber-400 text-amber-800 hover:bg-amber-50 disabled:opacity-50">
                                {printingId === `${o.id}:detail` ? 'Generando...' : '📋 Con detalle'}
                              </button>
                            </div>
                          )}
                          <div className="flex items-center gap-3">
                            <Link href={`/dashboard/orders/${o.id}`} className="text-xs text-blue-500 hover:text-blue-700 font-medium">Ver →</Link>
                            {currentUser?.role === 'SUPER_ADMIN' && (
                              <button onClick={() => handleDelete(o.id)} disabled={deletingId === o.id}
                                className="text-xs text-red-400 hover:text-red-600 font-medium disabled:opacity-50">
                                {deletingId === o.id ? 'Eliminando...' : 'Eliminar'}
                              </button>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
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
      {selectedIds.size > 0 && <div className="h-20 md:hidden" aria-hidden />}

      {viewer && (
        <ImageViewer images={viewer.images} startIndex={viewer.index} title={viewer.title} onClose={() => setViewer(null)} />
      )}
    </div>
  );
}

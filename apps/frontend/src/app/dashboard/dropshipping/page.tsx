'use client';

import { useEffect, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { useAdminCompany } from '../AdminCompanyContext';
import { useDashboardTimezone } from '@/lib/dashboardTimezone';
import { usePlatformLogos, resolvePlatformLogo, invalidatePlatformLogosCache } from '@/lib/platformLogos';
import { confirmDialog } from '../ConfirmDialog';

// Clave de logo por conector API dropship (misma convención que /settings/platforms/:platform),
// para que el Super Admin le ponga el logo del proveedor una vez que el conector queda
// marcado como API (no aplica a FEED, que es un feed genérico sin marca propia).
const CONNECTOR_LOGO_KEY: Record<string, string> = { NORIEGA_API: 'dropship-noriega_api' };

type Tab = 'suppliers' | 'products' | 'orders' | 'report';

const TAB_LABELS: Record<Tab, string> = {
  suppliers: 'Proveedores',
  products: 'Productos',
  orders: 'Pedidos',
  report: 'Rentabilidad',
};

const ORDER_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'Pendiente', cls: 'bg-amber-100 text-amber-700' },
  SENT: { label: 'Enviado', cls: 'bg-blue-100 text-blue-700' },
  CONFIRMED: { label: 'Confirmado', cls: 'bg-indigo-100 text-indigo-700' },
  SHIPPED: { label: 'Despachado', cls: 'bg-purple-100 text-purple-700' },
  DELIVERED: { label: 'Entregado', cls: 'bg-green-100 text-green-700' },
  CANCELLED: { label: 'Cancelado', cls: 'bg-gray-100 text-gray-500' },
};
const NEXT_STATUS: Record<string, string[]> = {
  PENDING: ['SENT', 'CANCELLED'],
  SENT: ['CONFIRMED', 'SHIPPED', 'CANCELLED'],
  CONFIRMED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};

const fmt = (n: number) => `$${Number(n || 0).toLocaleString('es-CL')}`;

const MAPPING_FIELDS: { key: string; label: string; required?: boolean }[] = [
  { key: 'sku', label: 'SKU / Código', required: true },
  { key: 'name', label: 'Nombre del producto' },
  { key: 'description', label: 'Descripción' },
  { key: 'imageUrl', label: 'Imagen (URL)' },
  { key: 'stock', label: 'Stock / Cantidad' },
  { key: 'cost', label: 'Costo / Precio proveedor' },
  { key: 'price', label: 'Precio de venta sugerido' },
];
const emptySupplierForm = { supplierId: '', name: '', taxId: '', email: '', phone: '', address: '', leadTimeDays: '', autoCreateOrders: true, notes: '', connectorType: 'FEED' as 'FEED' | 'NORIEGA_API' };
const emptyProductForm = { productId: '', dropshipSupplierId: '', supplierCost: '', supplierSku: '', leadTimeDays: '' };
const emptyCredentialsForm = { rut: '', usuario: '', password: '' };
const CONNECTOR_LABELS: Record<string, string> = { FEED: 'Feed URL', NORIEGA_API: 'API Noriega' };

export default function DropshippingPage() {
  const { selectedCompanyId } = useAdminCompany();
  const tz = useDashboardTimezone();
  const [tab, setTab] = useState<Tab>('suppliers');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [linkedProducts, setLinkedProducts] = useState<any[]>([]);
  const [availableProducts, setAvailableProducts] = useState<any[]>([]);
  const [plainSuppliers, setPlainSuppliers] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [orderStatusFilter, setOrderStatusFilter] = useState('');
  const [report, setReport] = useState<{ rows: any[]; totals: any } | null>(null);

  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [supplierForm, setSupplierForm] = useState(emptySupplierForm);
  const [showProductForm, setShowProductForm] = useState(false);
  const [productForm, setProductForm] = useState(emptyProductForm);
  const [busy, setBusy] = useState(false);

  const [mappingSupplier, setMappingSupplier] = useState<any>(null);
  const [mappingLoading, setMappingLoading] = useState(false);
  const [mappingSaving, setMappingSaving] = useState(false);
  const [mappingError, setMappingError] = useState('');
  const [feedColumns, setFeedColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const [credentialsSupplier, setCredentialsSupplier] = useState<any>(null);
  const [credentialsForm, setCredentialsForm] = useState(emptyCredentialsForm);
  const [credentialsSaving, setCredentialsSaving] = useState(false);
  const [credentialsTesting, setCredentialsTesting] = useState(false);
  const [credentialsError, setCredentialsError] = useState('');
  const [credentialsNotice, setCredentialsNotice] = useState('');

  const [catalogSupplier, setCatalogSupplier] = useState<any>(null);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogRows, setCatalogRows] = useState<any[]>([]);
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogPages, setCatalogPages] = useState(1);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [catalogSelected, setCatalogSelected] = useState<Set<string>>(new Set());
  const [catalogImporting, setCatalogImporting] = useState(false);
  const [catalogProviderHasMore, setCatalogProviderHasMore] = useState(false);
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false);
  // Modal de avance mientras se espera al proveedor API (cada página tarda ~20s).
  // immediate: se muestra apenas empieza (sync); si no, solo cuando el backend informa
  // que de verdad está consultando al proveedor (evita un parpadeo al paginar el caché).
  const [progressTarget, setProgressTarget] = useState<{ id: string; title: string; immediate: boolean; startedAt: number } | null>(null);
  const [progressInfo, setProgressInfo] = useState<{ message: string; percent: number | null } | null>(null);
  const [progressNow, setProgressNow] = useState(Date.now());

  const logoMap = usePlatformLogos();
  const [editingLogoKey, setEditingLogoKey] = useState<string | null>(null);
  const [logoForm, setLogoForm] = useState({ displayName: '', logoUrl: '' });
  const [logoSaving, setLogoSaving] = useState(false);
  const [logoError, setLogoError] = useState('');

  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const companyId = isSuperAdmin ? selectedCompanyId : undefined;
  const blocked = isSuperAdmin && !selectedCompanyId;

  useEffect(() => {
    setCurrentUser(getUser());
  }, []);

  useEffect(() => {
    if (!progressTarget) { setProgressInfo(null); return; }
    let cancelled = false;
    const tick = async () => {
      setProgressNow(Date.now());
      try {
        const r = await api.dropshipping.suppliers.progress(progressTarget.id, token());
        if (cancelled) return;
        // El % es estimado por tiempo; nunca lo dejamos retroceder en pantalla.
        setProgressInfo((prev) => r.active
          ? { message: r.message, percent: r.percent == null ? prev?.percent ?? null : Math.max(prev?.percent ?? 0, r.percent) }
          : null);
      } catch { /* el avance es solo informativo: si falla la consulta no se interrumpe nada */ }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => { cancelled = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progressTarget]);

  async function withProgress<T>(supplierId: string, title: string, immediate: boolean, fn: () => Promise<T>): Promise<T> {
    setProgressTarget({ id: supplierId, title, immediate, startedAt: Date.now() });
    try {
      return await fn();
    } finally {
      setProgressTarget(null);
    }
  }

  async function load() {
    const token = getToken();
    if (!token || !currentUser) return;
    if (blocked) { setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const [sup, prods, plain, ord, rep] = await Promise.all([
        api.dropshipping.suppliers.list(token, companyId).catch(() => []),
        api.dropshipping.products.list(token, companyId).catch(() => ({ linked: [], availableProducts: [] })),
        api.suppliers.list(token, companyId).catch(() => []),
        api.dropshipping.orders.list(token, { companyId, status: orderStatusFilter || undefined }).catch(() => ({ orders: [] })),
        api.dropshipping.report(token, { companyId }).catch(() => ({ rows: [], totals: {} })),
      ]);
      setSuppliers(sup);
      setLinkedProducts(prods.linked || []);
      setAvailableProducts(prods.availableProducts || []);
      setPlainSuppliers((plain || []).filter((s: any) => s.active));
      setOrders(ord.orders || []);
      setReport(rep);
    } catch (err: any) {
      setError(err.message || 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!currentUser) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, selectedCompanyId, orderStatusFilter]);

  async function run(fn: () => Promise<any>, ok?: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      await fn();
      if (ok) setNotice(ok);
      await load();
    } catch (err: any) {
      setError(err.message || 'Error');
    } finally {
      setBusy(false);
    }
  }

  const token = () => getToken()!;

  async function createSupplier(e: React.FormEvent) {
    e.preventDefault();
    await run(() => api.dropshipping.suppliers.create({
      supplierId: supplierForm.supplierId || undefined,
      name: supplierForm.supplierId ? undefined : supplierForm.name.trim(),
      taxId: supplierForm.taxId.trim() || undefined,
      email: supplierForm.email.trim() || undefined,
      phone: supplierForm.phone.trim() || undefined,
      address: supplierForm.address.trim() || undefined,
      autoCreateOrders: supplierForm.autoCreateOrders,
      leadTimeDays: supplierForm.leadTimeDays ? Number(supplierForm.leadTimeDays) : undefined,
      notes: supplierForm.notes.trim() || undefined,
      connectorType: supplierForm.connectorType,
      companyId,
    }, token()), 'Proveedor dropship agregado');
    setShowSupplierForm(false);
    setSupplierForm(emptySupplierForm);
  }

  function openLogoEdit(connectorType: string) {
    const key = CONNECTOR_LOGO_KEY[connectorType];
    if (!key) return;
    const current = logoMap[key];
    setLogoForm({ displayName: current?.displayName || '', logoUrl: current?.logoUrl || '' });
    setLogoError('');
    setEditingLogoKey(key);
  }

  async function saveLogoEdit() {
    if (!editingLogoKey) return;
    setLogoSaving(true);
    setLogoError('');
    try {
      await api.settings.platforms.update(editingLogoKey, {
        displayName: logoForm.displayName.trim() || undefined,
        logoUrl: logoForm.logoUrl.trim() || undefined,
      }, token());
      invalidatePlatformLogosCache();
      setEditingLogoKey(null);
    } catch (err: any) {
      setLogoError(err.message || 'No se pudo guardar el logo');
    } finally {
      setLogoSaving(false);
    }
  }

  async function handleRemoveSupplier(s: any) {
    const orderCount = s._count?.orders ?? 0;
    const msg = orderCount > 0 && isSuperAdmin
      ? `"${s.supplier?.name}" tiene ${orderCount} pedido(s) registrado(s). Como Super Admin podés eliminarlo igual, pero eso también borra ese historial de pedidos de forma permanente. ¿Eliminar de todas formas?`
      : `¿Eliminar el proveedor "${s.supplier?.name}"?`;
    if (!(await confirmDialog(msg, { danger: true }))) return;
    run(() => api.dropshipping.suppliers.remove(s.id, token()), 'Proveedor eliminado');
  }

  function openCredentials(s: any) {
    setCredentialsSupplier(s);
    setCredentialsForm(emptyCredentialsForm);
    setCredentialsError('');
    setCredentialsNotice('');
  }

  async function testCredentials() {
    setCredentialsTesting(true);
    setCredentialsError('');
    setCredentialsNotice('');
    try {
      const res = await api.dropshipping.suppliers.testConnection(
        { connectorType: 'NORIEGA_API', credentials: credentialsForm }, token(),
      );
      if (res.success) setCredentialsNotice('Conexión exitosa');
      else setCredentialsError(res.message || 'No se pudo conectar');
    } catch (err: any) {
      setCredentialsError(err.message || 'No se pudo conectar');
    } finally {
      setCredentialsTesting(false);
    }
  }

  async function saveCredentials() {
    if (!credentialsSupplier) return;
    if (!credentialsForm.rut.trim() || !credentialsForm.usuario.trim() || !credentialsForm.password.trim()) {
      setCredentialsError('Completa RUT, usuario y contraseña.');
      return;
    }
    setCredentialsSaving(true);
    setCredentialsError('');
    try {
      await api.dropshipping.suppliers.update(credentialsSupplier.id, { credentials: credentialsForm }, token());
      setCredentialsSupplier(null);
      setNotice('Credenciales guardadas');
      await load();
    } catch (err: any) {
      setCredentialsError(err.message || 'No se pudieron guardar las credenciales');
    } finally {
      setCredentialsSaving(false);
    }
  }

  async function loadCatalogPage(supplierId: string, page: number, q: string, refresh = false) {
    setCatalogLoading(true);
    setCatalogError('');
    try {
      const res = await withProgress(supplierId, 'Consultando el catálogo del proveedor', refresh, () =>
        api.dropshipping.suppliers.browseCatalog(supplierId, { q: q || undefined, page, pageSize: 50, refresh }, token()));
      setCatalogRows(res.rows);
      setCatalogPage(res.page);
      setCatalogPages(res.pages);
      setCatalogTotal(res.total);
      setCatalogProviderHasMore(res.providerHasMore);
    } catch (err: any) {
      setCatalogError(err.message || 'No se pudo consultar el catálogo del proveedor. Si sigue fallando, puede ser que el proveedor no responda (red/URL).');
    } finally {
      setCatalogLoading(false);
    }
  }

  async function loadMoreFromProvider() {
    if (!catalogSupplier) return;
    setCatalogLoadingMore(true);
    setCatalogError('');
    try {
      const res = await withProgress(catalogSupplier.id, 'Trayendo más productos del proveedor', true, () =>
        api.dropshipping.suppliers.browseCatalog(catalogSupplier.id, { q: catalogQuery || undefined, page: 1, pageSize: 50, loadMore: true }, token()));
      setCatalogRows(res.rows);
      setCatalogPage(res.page);
      setCatalogPages(res.pages);
      setCatalogTotal(res.total);
      setCatalogProviderHasMore(res.providerHasMore);
    } catch (err: any) {
      setCatalogError(err.message || 'No se pudo traer más productos del proveedor.');
    } finally {
      setCatalogLoadingMore(false);
    }
  }

  function openCatalogBrowse(s: any) {
    setCatalogSupplier(s);
    setCatalogQuery('');
    setCatalogSelected(new Set());
    setCatalogError('');
    loadCatalogPage(s.id, 1, '');
  }

  function toggleCatalogRow(sku: string) {
    setCatalogSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku); else next.add(sku);
      return next;
    });
  }

  async function importCatalogSelection() {
    if (!catalogSupplier || catalogSelected.size === 0) return;
    setCatalogImporting(true);
    setCatalogError('');
    try {
      const res = await api.dropshipping.suppliers.importCatalog(catalogSupplier.id, Array.from(catalogSelected), token());
      setNotice(`Importados: ${res.created} nuevos, ${res.updated} actualizados${res.skipped.length ? `, ${res.skipped.length} omitidos` : ''}`);
      setCatalogSelected(new Set());
      await loadCatalogPage(catalogSupplier.id, catalogPage, catalogQuery);
      await load();
    } catch (err: any) {
      setCatalogError(err.message || 'No se pudo importar la selección.');
    } finally {
      setCatalogImporting(false);
    }
  }

  async function openMapping(s: any) {
    if (!s.catalogUrl) return;
    setMappingSupplier(s);
    setMappingError('');
    setFeedColumns([]);
    setMapping({});
    setMappingLoading(true);
    try {
      const res = await api.dropshipping.suppliers.previewFeed(s.catalogUrl, token());
      setFeedColumns(res.columns);
      const saved = (s.fieldMapping || {}) as Record<string, string | null>;
      const merged: Record<string, string> = {};
      MAPPING_FIELDS.forEach(({ key }) => {
        merged[key] = saved[key] || res.suggestedMapping[key] || '';
      });
      setMapping(merged);
    } catch (err: any) {
      setMappingError(err.message || 'No se pudo leer el catálogo del proveedor.');
    } finally {
      setMappingLoading(false);
    }
  }

  async function saveMapping() {
    if (!mappingSupplier) return;
    if (!mapping.sku) { setMappingError('Selecciona la columna del SKU.'); return; }
    setMappingSaving(true);
    setMappingError('');
    try {
      const payload: Record<string, string | null> = {};
      MAPPING_FIELDS.forEach(({ key }) => { payload[key] = mapping[key] || null; });
      await api.dropshipping.suppliers.update(mappingSupplier.id, { fieldMapping: payload }, token());
      setMappingSupplier(null);
      setNotice('Mapeo de columnas guardado');
      await load();
    } catch (err: any) {
      setMappingError(err.message || 'No se pudo guardar el mapeo.');
    } finally {
      setMappingSaving(false);
    }
  }

  async function createProduct(e: React.FormEvent) {
    e.preventDefault();
    await run(() => api.dropshipping.products.create({
      productId: productForm.productId,
      dropshipSupplierId: productForm.dropshipSupplierId,
      supplierCost: Number(productForm.supplierCost),
      supplierSku: productForm.supplierSku.trim() || undefined,
      leadTimeDays: productForm.leadTimeDays ? Number(productForm.leadTimeDays) : undefined,
      companyId,
    }, token()), 'Producto vinculado');
    setShowProductForm(false);
    setProductForm(emptyProductForm);
  }

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <a href="/dashboard" className="text-sm text-gray-400 hover:text-gray-600">Panel</a>
            <span className="text-gray-300">/</span>
            <span className="text-sm text-gray-600 font-medium">Dropshipping</span>
          </div>
          <h1 className="text-[1.375rem] font-bold text-gray-900">Dropshipping</h1>
          <p className="text-xs text-gray-500">
            Vende productos que despacha un proveedor externo directo al cliente. El stock propio nunca se toca.
          </p>
        </div>
        {tab === 'orders' && !blocked && (
          <button disabled={busy}
            onClick={() => run(() => api.dropshipping.orders.generate({ companyId }, token()).then((r) =>
              setNotice(`Pedidos generados: ${r.created} · enviados: ${r.sent} · ya existían: ${r.skipped}`)))}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold whitespace-nowrap">
            Generar pedidos pendientes
          </button>
        )}
      </div>

      <div className="flex gap-1 border-b border-gray-200 mb-4">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t ? 'border-teal-600 text-teal-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
      {notice && <div className="mb-4 px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">{notice}</div>}
      {blocked && <p className="text-sm text-gray-400 py-10 text-center">Selecciona una empresa para ver su dropshipping.</p>}

      {!blocked && loading && <p className="text-sm text-gray-400 py-10 text-center">Cargando…</p>}

      {!blocked && !loading && tab === 'suppliers' && (
        <div>
          <div className="flex justify-end mb-3">
            <button onClick={() => setShowSupplierForm(!showSupplierForm)}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold">
              + Proveedor dropship
            </button>
          </div>
          {showSupplierForm && (
            <form onSubmit={createSupplier} className="bg-white border border-gray-200 rounded-xl p-5 mb-4 grid sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Proveedor existente</label>
                <select value={supplierForm.supplierId}
                  onChange={(e) => setSupplierForm((f) => ({ ...f, supplierId: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="">— Crear uno nuevo —</option>
                  {plainSuppliers.filter((s) => !s.dropship).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              {!supplierForm.supplierId && (
                <>
                  <input required placeholder="Nombre del proveedor *" value={supplierForm.name}
                    onChange={(e) => setSupplierForm((f) => ({ ...f, name: e.target.value }))}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  <input placeholder="RUT" value={supplierForm.taxId}
                    onChange={(e) => setSupplierForm((f) => ({ ...f, taxId: e.target.value }))}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  <input placeholder="Correo (para enviarle los pedidos)" value={supplierForm.email}
                    onChange={(e) => setSupplierForm((f) => ({ ...f, email: e.target.value }))}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  <input placeholder="Teléfono" value={supplierForm.phone}
                    onChange={(e) => setSupplierForm((f) => ({ ...f, phone: e.target.value }))}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </>
              )}
              <input type="number" min="0" placeholder="Días de despacho (lead time)" value={supplierForm.leadTimeDays}
                onChange={(e) => setSupplierForm((f) => ({ ...f, leadTimeDays: e.target.value }))}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Cómo trae el catálogo</label>
                <select value={supplierForm.connectorType}
                  onChange={(e) => setSupplierForm((f) => ({ ...f, connectorType: e.target.value as 'FEED' | 'NORIEGA_API' }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="FEED">Feed URL (CSV/JSON público)</option>
                  <option value="NORIEGA_API">API Noriega (login + token)</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={supplierForm.autoCreateOrders}
                  onChange={(e) => setSupplierForm((f) => ({ ...f, autoCreateOrders: e.target.checked }))} />
                Generar y enviar pedidos automáticamente
              </label>
              {supplierForm.connectorType === 'NORIEGA_API' && (
                <p className="sm:col-span-2 text-xs text-gray-400 -mt-1">
                  Después de crear el proveedor, carga las credenciales (RUT, usuario, contraseña) con el botón "Credenciales" en la tabla.
                </p>
              )}
              <div className="sm:col-span-2 flex gap-2">
                <button type="submit" disabled={busy}
                  className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">Guardar</button>
                <button type="button" onClick={() => setShowSupplierForm(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm">Cancelar</button>
              </div>
            </form>
          )}
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-left text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Proveedor</th>
                  <th className="px-4 py-3 font-medium">Correo</th>
                  <th className="px-4 py-3 font-medium text-center">Productos</th>
                  <th className="px-4 py-3 font-medium text-center">Pedidos</th>
                  <th className="px-4 py-3 font-medium text-center">Automático</th>
                  <th className="px-4 py-3 font-medium">Catálogo del proveedor</th>
                  <th className="px-4 py-3 font-medium text-center">Estado</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {suppliers.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50 align-top">
                    <td className="px-4 py-3 font-medium text-gray-900">{s.supplier?.name}</td>
                    <td className="px-4 py-3 text-gray-500">{s.supplier?.email || '—'}</td>
                    <td className="px-4 py-3 text-center text-gray-600">{s._count?.products ?? 0}</td>
                    <td className="px-4 py-3 text-center text-gray-600">{s._count?.orders ?? 0}</td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => run(() => api.dropshipping.suppliers.update(s.id, { autoCreateOrders: !s.autoCreateOrders }, token()))}
                        className={`text-xs font-medium ${s.autoCreateOrders ? 'text-green-600' : 'text-gray-400'}`}>
                        {s.autoCreateOrders ? 'Sí' : 'No'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      {(s.connectorType ?? 'FEED') === 'NORIEGA_API' ? (
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded overflow-hidden shrink-0 border border-gray-100 bg-white">
                            {resolvePlatformLogo(logoMap, CONNECTOR_LOGO_KEY.NORIEGA_API, (
                              <div className="w-full h-full flex items-center justify-center bg-indigo-500 text-white text-[9px] font-bold">NO</div>
                            ), CONNECTOR_LABELS.NORIEGA_API)}
                          </div>
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-50 text-indigo-600 whitespace-nowrap">
                            {CONNECTOR_LABELS.NORIEGA_API}
                          </span>
                          {isSuperAdmin && (
                            <button type="button" onClick={() => openLogoEdit('NORIEGA_API')}
                              title="Editar logo del proveedor" className="text-gray-400 hover:text-gray-600">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                          )}
                          <button disabled={busy || !s.hasCredentials}
                            onClick={() => run(() => withProgress(s.id, `Sincronizando ${s.supplier?.name || 'proveedor'}`, true, () =>
                              api.dropshipping.suppliers.syncCatalog(s.id, {}, token())).then((r) =>
                              setNotice(`Actualizado: ${r.updated} producto(s) ya vinculado(s)${r.skipped.length ? `, ${r.skipped.length} sin traer aún` : ''}`)))}
                            title="Actualiza precio/stock de los productos ya vinculados. Para sumar productos nuevos usa 'Agregar productos'."
                            className="text-xs text-teal-600 hover:text-teal-700 font-medium disabled:opacity-40 whitespace-nowrap">
                            Sincronizar
                          </button>
                          <button disabled={busy || !s.hasCredentials} onClick={() => openCatalogBrowse(s)}
                            className="text-xs text-purple-600 hover:text-purple-700 font-medium disabled:opacity-40 whitespace-nowrap">
                            Agregar productos
                          </button>
                          <button disabled={busy} onClick={() => openCredentials(s)}
                            className="text-xs text-indigo-600 hover:text-indigo-700 font-medium disabled:opacity-40 whitespace-nowrap">
                            Credenciales
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <input defaultValue={s.catalogUrl || ''} placeholder="URL feed CSV/JSON"
                            onBlur={(e) => {
                              if (e.target.value !== (s.catalogUrl || '')) {
                                run(() => api.dropshipping.suppliers.update(s.id, { catalogUrl: e.target.value || null }, token()));
                              }
                            }}
                            className="w-44 px-2 py-1 border border-gray-200 rounded text-xs" />
                          <button disabled={busy}
                            onClick={() => run(() => api.dropshipping.suppliers.syncCatalog(s.id, {}, token()).then((r) =>
                              setNotice(`Sincronizado: ${r.created} nuevos, ${r.updated} actualizados${r.skipped.length ? `, ${r.skipped.length} omitidos` : ''}`)))}
                            className="text-xs text-teal-600 hover:text-teal-700 font-medium disabled:opacity-40 whitespace-nowrap">
                            Sincronizar
                          </button>
                          <button disabled={busy || !s.catalogUrl} onClick={() => openMapping(s)}
                            className="text-xs text-indigo-600 hover:text-indigo-700 font-medium disabled:opacity-40 whitespace-nowrap">
                            Mapear campos
                          </button>
                        </div>
                      )}
                      {!s.hasCredentials && (s.connectorType ?? 'FEED') === 'NORIEGA_API' && (
                        <p className="text-[11px] text-amber-600 mt-0.5">Falta configurar credenciales</p>
                      )}
                      {s.lastSyncedAt && (
                        <p className="text-[11px] text-gray-400 mt-0.5">Última: {new Date(s.lastSyncedAt).toLocaleString('es-CL', { timeZone: tz })}</p>
                      )}
                      {s.catalogUrl && (s.connectorType ?? 'FEED') === 'FEED' && (
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {s.fieldMapping ? 'Mapeo manual configurado' : 'Detección automática de columnas'}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => run(() => api.dropshipping.suppliers.update(s.id, { active: !s.active }, token()))}
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {s.active ? 'Activo' : 'Inactivo'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => handleRemoveSupplier(s)}
                        className="text-xs text-red-500 hover:text-red-700 font-medium">Eliminar</button>
                    </td>
                  </tr>
                ))}
                {suppliers.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Sin proveedores dropship</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!blocked && !loading && tab === 'products' && (
        <div>
          <div className="flex justify-end mb-3">
            <button onClick={() => setShowProductForm(!showProductForm)} disabled={suppliers.length === 0}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white rounded-lg text-sm font-semibold">
              + Vincular producto
            </button>
          </div>
          {showProductForm && (
            <form onSubmit={createProduct} className="bg-white border border-gray-200 rounded-xl p-5 mb-4 grid sm:grid-cols-2 gap-3">
              <select required value={productForm.productId}
                onChange={(e) => setProductForm((f) => ({ ...f, productId: e.target.value }))}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">Producto del catálogo *</option>
                {availableProducts.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
              </select>
              <select required value={productForm.dropshipSupplierId}
                onChange={(e) => setProductForm((f) => ({ ...f, dropshipSupplierId: e.target.value }))}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">Proveedor dropship *</option>
                {suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.supplier?.name}</option>)}
              </select>
              <input required type="number" min="0" step="0.01" placeholder="Precio proveedor *" value={productForm.supplierCost}
                onChange={(e) => setProductForm((f) => ({ ...f, supplierCost: e.target.value }))}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input placeholder="SKU del proveedor" value={productForm.supplierSku}
                onChange={(e) => setProductForm((f) => ({ ...f, supplierSku: e.target.value }))}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <div className="sm:col-span-2 flex gap-2">
                <button type="submit" disabled={busy}
                  className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">Vincular</button>
                <button type="button" onClick={() => setShowProductForm(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm">Cancelar</button>
              </div>
            </form>
          )}
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-left text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Producto</th>
                  <th className="px-4 py-3 font-medium">Proveedor</th>
                  <th className="px-4 py-3 font-medium text-right">Precio venta</th>
                  <th className="px-4 py-3 font-medium text-right">Precio proveedor</th>
                  <th className="px-4 py-3 font-medium text-right">Margen</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {linkedProducts.map((dp) => {
                  const sale = Number(dp.product?.price || 0);
                  const cost = Number(dp.supplierCost || 0);
                  return (
                    <tr key={dp.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        <span className="text-gray-400 font-mono text-xs mr-1">{dp.product?.sku}</span>{dp.product?.name}
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {dp.dropshipSupplier?.supplier?.name}
                        {dp.supplierSku && (
                          <div className="text-xs text-gray-400 font-mono">SKU prov.: {dp.supplierSku}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">{fmt(sale)}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{fmt(cost)}</td>
                      <td className={`px-4 py-3 text-right font-medium ${sale - cost >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {fmt(sale - cost)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => run(() => api.dropshipping.products.remove(dp.id, token()), 'Producto desvinculado')}
                          className="text-xs text-red-500 hover:text-red-700 font-medium">Quitar</button>
                      </td>
                    </tr>
                  );
                })}
                {linkedProducts.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Sin productos dropship</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!blocked && !loading && tab === 'orders' && (
        <div>
          <div className="mb-3">
            <select value={orderStatusFilter} onChange={(e) => setOrderStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todos los estados</option>
              {Object.entries(ORDER_STATUS).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
            </select>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-left text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Pedido</th>
                  <th className="px-4 py-3 font-medium">Proveedor</th>
                  <th className="px-4 py-3 font-medium">Venta</th>
                  <th className="px-4 py-3 font-medium text-right">Venta / Costo</th>
                  <th className="px-4 py-3 font-medium">Tracking</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-gray-50 align-top">
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">
                      #{o.id.slice(-8).toUpperCase()}
                      <div className="text-gray-400">{o.items?.length ?? 0} ítem(s)</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{o.dropshipSupplier?.supplier?.name}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {o.sale?.channel} {o.sale?.externalId ? `· ${o.sale.externalId}` : ''}
                      <div>{[o.sale?.address, o.sale?.commune].filter(Boolean).join(', ')}</div>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {fmt(o.saleAmount)} <span className="text-gray-400">/</span> {fmt(o.supplierCost)}
                    </td>
                    <td className="px-4 py-3">
                      <input defaultValue={o.trackingCode || ''} placeholder="—"
                        onBlur={(e) => {
                          if (e.target.value !== (o.trackingCode || '')) {
                            run(() => api.dropshipping.orders.update(o.id, { trackingCode: e.target.value }, token()));
                          }
                        }}
                        className="w-28 px-2 py-1 border border-gray-200 rounded text-xs" />
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ORDER_STATUS[o.status]?.cls}`}>
                        {ORDER_STATUS[o.status]?.label ?? o.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {o.status === 'PENDING' && o.dropshipSupplier?.supplier?.email && (
                        <button onClick={() => run(() => api.dropshipping.orders.send(o.id, token()), 'Pedido enviado al proveedor')}
                          className="text-xs text-blue-600 hover:text-blue-700 font-medium mr-2">Enviar</button>
                      )}
                      {(NEXT_STATUS[o.status] || []).map((ns) => (
                        <button key={ns} onClick={() => run(() => api.dropshipping.orders.update(o.id, { status: ns }, token()))}
                          className="text-xs text-gray-500 hover:text-gray-800 font-medium mr-2">
                          → {ORDER_STATUS[ns]?.label}
                        </button>
                      ))}
                    </td>
                  </tr>
                ))}
                {orders.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Sin pedidos dropship</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!blocked && !loading && tab === 'report' && report && (
        <div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              { label: 'Pedidos', value: String(report.totals.orders ?? 0) },
              { label: 'Venta', value: fmt(report.totals.saleAmount) },
              { label: 'Costo proveedor', value: fmt(report.totals.supplierCost) },
              { label: 'Margen', value: fmt(report.totals.margin), accent: true },
            ].map((c) => (
              <div key={c.label} className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-xs text-gray-500">{c.label}</p>
                <p className={`text-lg font-bold ${c.accent ? 'text-green-600' : 'text-gray-900'}`}>{c.value}</p>
              </div>
            ))}
          </div>
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-left text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Fecha</th>
                  <th className="px-4 py-3 font-medium">Proveedor</th>
                  <th className="px-4 py-3 font-medium">Venta</th>
                  <th className="px-4 py-3 font-medium text-right">Venta</th>
                  <th className="px-4 py-3 font-medium text-right">Costo prov.</th>
                  <th className="px-4 py-3 font-medium text-right">Comisión</th>
                  <th className="px-4 py-3 font-medium text-right">Margen</th>
                  <th className="px-4 py-3 font-medium text-right">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {report.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500 text-xs">{new Date(r.createdAt).toLocaleDateString('es-CL', { timeZone: tz })}</td>
                    <td className="px-4 py-3 text-gray-700">{r.supplierName}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{r.saleChannel} · {r.saleRef}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{fmt(r.saleAmount)}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{fmt(r.supplierCost)}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{fmt(r.channelFee)}</td>
                    <td className={`px-4 py-3 text-right font-medium ${r.margin >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(r.margin)}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{r.marginPct.toFixed(1)}%</td>
                  </tr>
                ))}
                {report.rows.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Sin datos en el período</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {progressTarget && (progressTarget.immediate || progressInfo) && (() => {
        const percent = progressInfo?.percent ?? null;
        const secs = Math.max(0, Math.floor((progressNow - progressTarget.startedAt) / 1000));
        const elapsed = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
        return (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
            <div className="bg-white rounded-xl w-full max-w-md p-6">
              <h3 className="font-semibold text-gray-900">{progressTarget.title}</h3>
              <p className="text-sm text-gray-500 mt-1">{progressInfo?.message || 'Conectando con el proveedor...'}</p>
              <div className="mt-4 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                {percent != null ? (
                  <div className="h-full bg-teal-500 rounded-full transition-all duration-1000 ease-linear" style={{ width: `${percent}%` }} />
                ) : (
                  <div className="h-full w-1/3 bg-teal-500 rounded-full animate-pulse" />
                )}
              </div>
              <div className="mt-2 flex justify-between text-xs text-gray-500">
                <span className="font-medium text-gray-700">{percent != null ? `${percent}%` : 'Calculando...'}</span>
                <span>Tiempo: {elapsed}</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-3">El proveedor tarda unos 20 segundos por página. No cierres ni recargues esta página.</p>
            </div>
          </div>
        );
      })()}

      {mappingSupplier && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
              <div>
                <h3 className="font-semibold text-gray-900">Mapeo de columnas — {mappingSupplier.supplier?.name}</h3>
                <p className="text-xs text-gray-500 mt-0.5">Asocia cada campo nuestro con la columna que entrega el feed de este proveedor.</p>
              </div>
              <button onClick={() => setMappingSupplier(null)} disabled={mappingSaving}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none disabled:opacity-30">×</button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {mappingLoading && (
                <div className="p-10 flex flex-col items-center justify-center gap-3 text-gray-400 text-sm">
                  <div className="w-8 h-8 border-4 border-gray-200 border-t-teal-500 rounded-full animate-spin" />
                  <p>Leyendo el catálogo del proveedor...</p>
                </div>
              )}

              {!mappingLoading && mappingError && (
                <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{mappingError}</div>
              )}

              {!mappingLoading && feedColumns.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-400">{feedColumns.length} columna(s) detectada(s) en el feed. Las ya sugeridas vienen preseleccionadas — solo corrige lo que no calce.</p>
                  {MAPPING_FIELDS.map((f) => (
                    <div key={f.key} className="flex items-center gap-3">
                      <label className="w-56 shrink-0 text-sm text-gray-700">
                        {f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}
                      </label>
                      <select value={mapping[f.key] || ''}
                        onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                        <option value="">— No mapear —</option>
                        {feedColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2 shrink-0">
              <button onClick={() => setMappingSupplier(null)} disabled={mappingSaving}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={saveMapping} disabled={mappingSaving || mappingLoading || feedColumns.length === 0}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                {mappingSaving ? 'Guardando...' : 'Guardar mapeo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {credentialsSupplier && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">Credenciales — {credentialsSupplier.supplier?.name}</h3>
                <p className="text-xs text-gray-500 mt-0.5">Acceso a la API de Noriega. Se guardan en el servidor, no se muestran de vuelta.</p>
              </div>
              <button onClick={() => setCredentialsSupplier(null)} disabled={credentialsSaving}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none disabled:opacity-30">×</button>
            </div>

            <div className="px-6 py-5 space-y-3">
              {credentialsError && (
                <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{credentialsError}</div>
              )}
              {credentialsNotice && (
                <div className="px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">{credentialsNotice}</div>
              )}
              <input placeholder="RUT (ej. 78363206)" value={credentialsForm.rut}
                onChange={(e) => setCredentialsForm((f) => ({ ...f, rut: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input placeholder="Usuario" value={credentialsForm.usuario}
                onChange={(e) => setCredentialsForm((f) => ({ ...f, usuario: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input type="password" placeholder="Contraseña" value={credentialsForm.password}
                onChange={(e) => setCredentialsForm((f) => ({ ...f, password: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              {credentialsSupplier.hasCredentials && (
                <p className="text-[11px] text-gray-400">Ya hay credenciales guardadas. Déjalas en blanco si solo quieres probar la conexión actual; escribe nuevas para reemplazarlas.</p>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-between gap-2">
              <button onClick={testCredentials} disabled={credentialsTesting || credentialsSaving}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm disabled:opacity-50">
                {credentialsTesting ? 'Probando...' : 'Probar conexión'}
              </button>
              <div className="flex gap-2">
                <button onClick={() => setCredentialsSupplier(null)} disabled={credentialsSaving}
                  className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm disabled:opacity-50">
                  Cancelar
                </button>
                <button onClick={saveCredentials} disabled={credentialsSaving || credentialsTesting}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                  {credentialsSaving ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingLogoKey && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Logo del proveedor</h3>
              <button onClick={() => setEditingLogoKey(null)} disabled={logoSaving}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none disabled:opacity-30">×</button>
            </div>
            <div className="px-6 py-5 space-y-3">
              {logoError && (
                <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{logoError}</div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nombre a mostrar</label>
                <input value={logoForm.displayName} placeholder="Noriega Vanzulli"
                  onChange={(e) => setLogoForm((f) => ({ ...f, displayName: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">URL del logo</label>
                <input value={logoForm.logoUrl} placeholder="https://ejemplo.com/logo.png" type="url"
                  onChange={(e) => setLogoForm((f) => ({ ...f, logoUrl: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                {logoForm.logoUrl && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-gray-500">Vista previa:</span>
                    <img src={logoForm.logoUrl} alt="preview" className="w-16 h-10 object-contain rounded border border-gray-200"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  </div>
                )}
                <p className="text-xs text-gray-400 mt-1">Se muestra en Mis conexiones y en esta tabla en vez del ícono genérico.</p>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setEditingLogoKey(null)} disabled={logoSaving}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={saveLogoEdit} disabled={logoSaving}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                {logoSaving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {catalogSupplier && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
              <div>
                <h3 className="font-semibold text-gray-900">Agregar productos — {catalogSupplier.supplier?.name}</h3>
                <p className="text-xs text-gray-500 mt-0.5">Busca en el catálogo del proveedor y elige solo los productos que quieres vender.</p>
              </div>
              <button onClick={() => setCatalogSupplier(null)} disabled={catalogImporting}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none disabled:opacity-30">×</button>
            </div>

            <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-2 shrink-0">
              <input value={catalogQuery} placeholder="Buscar por SKU, nombre, marca o modelo..."
                onChange={(e) => setCatalogQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') loadCatalogPage(catalogSupplier.id, 1, catalogQuery); }}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <button disabled={catalogLoading} onClick={() => loadCatalogPage(catalogSupplier.id, 1, catalogQuery)}
                className="px-3 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm disabled:opacity-50 whitespace-nowrap">
                Buscar
              </button>
              <button disabled={catalogLoading} onClick={() => loadCatalogPage(catalogSupplier.id, 1, catalogQuery, true)}
                title="Vuelve a descargar el catálogo del proveedor (puede tardar)"
                className="px-3 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm disabled:opacity-50 whitespace-nowrap">
                Actualizar
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {catalogError && (
                <div className="m-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{catalogError}</div>
              )}
              {catalogLoading && (
                <div className="p-10 flex flex-col items-center justify-center gap-3 text-gray-400 text-sm">
                  <div className="w-8 h-8 border-4 border-gray-200 border-t-teal-500 rounded-full animate-spin" />
                  <p>Consultando el catálogo del proveedor...</p>
                </div>
              )}
              {!catalogLoading && !catalogError && (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200 text-left text-gray-600 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 w-8"></th>
                      <th className="px-4 py-2 w-14"></th>
                      <th className="px-4 py-2 font-medium">SKU</th>
                      <th className="px-4 py-2 font-medium">Producto</th>
                      <th className="px-4 py-2 font-medium text-right">Precio prov.</th>
                      <th className="px-4 py-2 font-medium text-right">Stock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {catalogRows.map((r) => (
                      <tr key={r.sku} className={`hover:bg-gray-50 ${r.alreadyLinked ? 'opacity-50' : ''}`}>
                        <td className="px-4 py-2">
                          <input type="checkbox" disabled={r.alreadyLinked}
                            checked={catalogSelected.has(r.sku)}
                            onChange={() => toggleCatalogRow(r.sku)} />
                        </td>
                        <td className="px-4 py-2">
                          {r.imageUrl ? (
                            <img src={r.imageUrl} alt="" className="w-10 h-10 object-contain rounded border border-gray-200 bg-white" />
                          ) : (
                            <div className="w-10 h-10 rounded border border-gray-100 bg-gray-50" />
                          )}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-gray-600">{r.sku}</td>
                        <td className="px-4 py-2 text-gray-800">
                          {r.name || '—'}
                          {r.description && <div className="text-xs text-gray-400 whitespace-pre-line">{r.description}</div>}
                          {r.alreadyLinked && <div className="text-xs text-green-600">Ya vinculado</div>}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-700">{r.cost != null ? fmt(r.cost) : '—'}</td>
                        <td className="px-4 py-2 text-right text-gray-700">{r.stock ?? '—'}</td>
                      </tr>
                    ))}
                    {catalogRows.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Sin resultados</td></tr>
                    )}
                  </tbody>
                </table>
              )}
              {!catalogLoading && catalogProviderHasMore && (
                <div className="px-4 py-3 text-center border-t border-gray-100">
                  <p className="text-xs text-gray-400 mb-2">
                    El proveedor tiene más productos que todavía no se han traído al buscador
                    {catalogQuery ? ' — si no encuentras lo que buscas, prueba cargar más' : ''}.
                  </p>
                  <button disabled={catalogLoadingMore} onClick={loadMoreFromProvider}
                    className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-xs disabled:opacity-50">
                    {catalogLoadingMore ? 'Cargando...' : 'Cargar más del proveedor'}
                  </button>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-2 shrink-0">
              <div className="text-xs text-gray-500">
                {catalogTotal} producto(s) · página {catalogPage} de {catalogPages} · {catalogSelected.size} seleccionado(s)
                <div className="flex gap-2 mt-1">
                  <button disabled={catalogLoading || catalogPage <= 1}
                    onClick={() => loadCatalogPage(catalogSupplier.id, catalogPage - 1, catalogQuery)}
                    className="text-teal-600 hover:text-teal-700 disabled:opacity-30 disabled:hover:text-teal-600">← Anterior</button>
                  <button disabled={catalogLoading || catalogPage >= catalogPages}
                    onClick={() => loadCatalogPage(catalogSupplier.id, catalogPage + 1, catalogQuery)}
                    className="text-teal-600 hover:text-teal-700 disabled:opacity-30 disabled:hover:text-teal-600">Siguiente →</button>
                </div>
              </div>
              <button onClick={importCatalogSelection} disabled={catalogImporting || catalogSelected.size === 0}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50 whitespace-nowrap">
                {catalogImporting ? 'Agregando...' : `Agregar ${catalogSelected.size || ''} producto(s)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

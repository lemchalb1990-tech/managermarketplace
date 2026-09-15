'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { useAdminCompany } from '../AdminCompanyContext';
import { useDashboardTimezone } from '@/lib/dashboardTimezone';
import { confirmDialog, alertDialog } from '../ConfirmDialog';
import { Logos } from '../ecommerce/components/logos';
import { usePlatformLogos, resolvePlatformLogo } from '@/lib/platformLogos';

// Mapeo enum del backend -> slug usado en las rutas /dashboard/ecommerce/<slug> y en Logos.
const MARKETPLACE_KEY: Record<string, string> = {
  MERCADO_LIBRE: 'mercadolibre', SHOPIFY: 'shopify', WOOCOMMERCE: 'woocommerce',
  JUMPSELLER: 'jumpseller', FALABELLA: 'falabella', PARIS: 'paris',
  HITES: 'hites', RIPLEY: 'ripley', WALMART: 'walmart',
};
const MARKETPLACE_LABEL: Record<string, string> = {
  MERCADO_LIBRE: 'Mercado Libre', SHOPIFY: 'Shopify', WOOCOMMERCE: 'WooCommerce',
  JUMPSELLER: 'JumpSeller', FALABELLA: 'Falabella', PARIS: 'Paris',
  HITES: 'Hites', RIPLEY: 'Ripley', WALMART: 'Walmart (Líder)',
};

const BILLING_KEY: Record<string, string> = {
  OPENFACTURA: 'openfactura', FACTO: 'facto', BSALE: 'bsale',
  DEFONTANA: 'defontana', NUBOX: 'nubox', SIIGO: 'siigo',
};
const BILLING_LABEL: Record<string, string> = {
  OPENFACTURA: 'OpenFactura', FACTO: 'Facto', BSALE: 'Bsale',
  DEFONTANA: 'Defontana', NUBOX: 'Nubox', SIIGO: 'Siigo',
};
const BILLING_COLOR: Record<string, string> = {
  OPENFACTURA: 'bg-sky-500', FACTO: 'bg-violet-500', BSALE: 'bg-orange-500',
  DEFONTANA: 'bg-teal-500', NUBOX: 'bg-indigo-500', SIIGO: 'bg-rose-500',
};

// Conectores de proveedor dropship (connectorType del backend). El feed genérico no tiene
// marca propia; NORIEGA_API es el conector de Noriega Vanzulli, el proveedor ya integrado.
const DROPSHIP_LABEL: Record<string, string> = {
  NORIEGA_API: 'Noriega Vanzulli', FEED: 'Proveedor (feed)',
};
const DROPSHIP_COLOR: Record<string, string> = {
  NORIEGA_API: 'bg-emerald-600', FEED: 'bg-gray-400',
};

const CATEGORIES = [
  {
    title: 'Marketplaces',
    codes: ['MERCADO_LIBRE', 'WALMART', 'RIPLEY', 'PARIS', 'FALABELLA', 'HITES'],
    addHref: '/dashboard/ecommerce',
  },
  {
    title: 'E-commerce',
    codes: ['SHOPIFY', 'WOOCOMMERCE', 'JUMPSELLER'],
    addHref: '/dashboard/ecommerce',
  },
  {
    title: 'Facturación',
    codes: ['OPENFACTURA', 'FACTO', 'BSALE', 'DEFONTANA', 'NUBOX', 'SIIGO'],
    addHref: '/dashboard/billing',
  },
  {
    title: 'Dropshipping',
    codes: ['FEED', 'NORIEGA_API'],
    addHref: '/dashboard/dropshipping',
  },
  {
    title: 'Encomiendas',
    codes: ['STARKEN', 'CHILEXPRESS', 'BLUE_EXPRESS'],
    addHref: '/dashboard/encomiendas',
  },
] as const;

type Row = {
  id: string;
  kind: 'ml' | 'ecommerce' | 'billing' | 'dropship';
  code: string;
  key: string;
  platformLabel: string;
  name: string;
  active: boolean;
  authorized: boolean;
  createdAt: string;
  settingsHref: string;
};

export default function MisConexionesPage() {
  const { isSuperAdmin, selectedCompanyId } = useAdminCompany();
  const tz = useDashboardTimezone();
  const logoMap = usePlatformLogos();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const companyId = isSuperAdmin ? selectedCompanyId || undefined : undefined;
  const showContent = !isSuperAdmin || !!selectedCompanyId;

  async function load() {
    if (!showContent) return;
    setLoading(true);
    setError('');
    try {
      const token = getToken()!;
      const [ml, other, billing, dropship] = await Promise.all([
        api.marketplace.connections(token, companyId).catch(() => []),
        api.connections.list(token, { companyId }).catch(() => []),
        api.billing.connections.list(token, { companyId }).catch(() => []),
        api.dropshipping.suppliers.list(token, companyId).catch(() => []),
      ]);

      const mlRows: Row[] = (ml as any[]).map((c) => ({
        id: c.id, kind: 'ml', code: 'MERCADO_LIBRE', key: 'mercadolibre',
        platformLabel: MARKETPLACE_LABEL.MERCADO_LIBRE, name: c.name,
        active: c.active, authorized: c.authorized ?? true, createdAt: c.createdAt,
        settingsHref: '/dashboard/ecommerce/mercadolibre',
      }));

      const otherRows: Row[] = (other as any[]).map((c) => ({
        id: c.id, kind: 'ecommerce', code: c.marketplace, key: MARKETPLACE_KEY[c.marketplace] || c.marketplace.toLowerCase(),
        platformLabel: MARKETPLACE_LABEL[c.marketplace] || c.marketplace, name: c.name,
        active: c.active, authorized: true, createdAt: c.createdAt,
        settingsHref: `/dashboard/ecommerce/${MARKETPLACE_KEY[c.marketplace] || c.marketplace.toLowerCase()}`,
      }));

      const billingRows: Row[] = (billing as any[]).map((c) => ({
        id: c.id, kind: 'billing', code: c.provider, key: BILLING_KEY[c.provider] || c.provider.toLowerCase(),
        platformLabel: BILLING_LABEL[c.provider] || c.provider, name: c.name,
        active: c.active, authorized: true, createdAt: c.createdAt,
        settingsHref: `/dashboard/billing/${BILLING_KEY[c.provider] || c.provider.toLowerCase()}`,
      }));

      const dropshipRows: Row[] = (dropship as any[]).map((s) => ({
        id: s.id, kind: 'dropship', code: s.connectorType, key: `dropship-${s.connectorType.toLowerCase()}`,
        platformLabel: DROPSHIP_LABEL[s.connectorType] || s.connectorType, name: s.supplier?.name || DROPSHIP_LABEL[s.connectorType],
        active: s.active, authorized: true, createdAt: s.createdAt,
        settingsHref: '/dashboard/dropshipping',
      }));

      setRows([...mlRows, ...otherRows, ...billingRows, ...dropshipRows].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ));
    } catch (err: any) {
      setError(err.message || 'No se pudieron cargar tus conexiones.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [showContent, companyId]);

  async function handleDisconnect(row: Row) {
    if (!(await confirmDialog(`¿Desconectar "${row.name}" (${row.platformLabel})?`, { danger: true }))) return;
    setBusyId(row.id);
    try {
      const token = getToken()!;
      if (row.kind === 'ml') await api.marketplace.deleteConnection(row.id, token);
      else if (row.kind === 'billing') await api.billing.connections.remove(row.id, token);
      else if (row.kind === 'dropship') await api.dropshipping.suppliers.remove(row.id, token);
      else await api.connections.remove(row.id, token);
      await load();
    } catch (err: any) {
      await alertDialog(err.message || 'No se pudo desconectar.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleTest(row: Row) {
    setBusyId(row.id);
    try {
      const token = getToken()!;
      const result = row.kind === 'billing'
        ? await api.billing.connections.test(row.id, token).catch((e) => ({ success: false, message: e.message }))
        : row.kind === 'ecommerce'
        ? await api.connections.test(row.id, token).catch((e) => ({ success: false, message: e.message }))
        : { success: true, message: 'Renueva el token desde Ajustes.' };
      await alertDialog(result.success ? `✓ ${result.message || 'Conexión exitosa'}` : `✗ ${result.message || 'Error de conexión'}`);
    } finally {
      setBusyId(null);
    }
  }

  const filtered = rows.filter((r) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return r.platformLabel.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
  });

  function BillingBadge({ code }: { code: string }) {
    return (
      <div className={`w-full h-full rounded-lg flex items-center justify-center text-white text-[10px] font-bold ${BILLING_COLOR[code] || 'bg-gray-400'}`}>
        {(BILLING_LABEL[code] || code).slice(0, 2).toUpperCase()}
      </div>
    );
  }

  function DropshipBadge({ code }: { code: string }) {
    return (
      <div className={`w-full h-full rounded-lg flex items-center justify-center text-white text-[10px] font-bold ${DROPSHIP_COLOR[code] || 'bg-gray-400'}`}>
        {(DROPSHIP_LABEL[code] || code).slice(0, 2).toUpperCase()}
      </div>
    );
  }

  function PlatformIcon({ row }: { row: Row }) {
    if (row.kind === 'billing') {
      return <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0"><BillingBadge code={row.code} /></div>;
    }
    if (row.kind === 'dropship') {
      return (
        <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0">
          {resolvePlatformLogo(logoMap, row.key, <DropshipBadge code={row.code} />, row.platformLabel)}
        </div>
      );
    }
    return (
      <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0">
        {resolvePlatformLogo(logoMap, row.key, Logos[row.key], row.platformLabel)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-1">
        <Link href="/dashboard/ecommerce" className="text-sm text-gray-400 hover:text-gray-600">Sincronizaciones</Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm text-gray-600 font-medium">Mis conexiones</span>
      </div>

      <div>
        <h1 className="text-[1.375rem] font-bold text-gray-900">Mis conexiones</h1>
        <p className="text-xs text-gray-500 mt-1">
          {loading ? 'Cargando…' : `${rows.length} conexion${rows.length === 1 ? '' : 'es'} conectada${rows.length === 1 ? '' : 's'}.`}
        </p>
      </div>

      {!showContent ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          <p className="text-sm">Selecciona una empresa para ver sus conexiones.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {CATEGORIES.map((cat) => {
              const catRows = rows.filter((r) => (cat.codes as readonly string[]).includes(r.code));
              const uniqueKeys = Array.from(new Set(catRows.map((r) => r.key)));
              return (
                <div key={cat.title} className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{cat.title}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {uniqueKeys.map((key) => {
                      const r = catRows.find((x) => x.key === key)!;
                      return (
                        <div key={key} className="w-9 h-9 rounded-lg overflow-hidden border border-gray-100" title={r.platformLabel}>
                          <PlatformIcon row={r} />
                        </div>
                      );
                    })}
                    <Link href={cat.addHref}
                      className="w-9 h-9 rounded-lg border border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:border-gray-400 transition-colors">
                      +
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button onClick={load} disabled={loading}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              ↻ Actualizar
            </button>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar canal..."
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm flex-1 min-w-[220px]"
            />
          </div>

          {error && (
            <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">Canal</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">Cuenta</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">Estado</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">Conectada el</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading && (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">Cargando...</td></tr>
                )}
                {!loading && filtered.map((r) => (
                  <tr key={`${r.kind}-${r.id}`} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg overflow-hidden shrink-0"><PlatformIcon row={r} /></div>
                        <span className="font-medium text-gray-900">{r.platformLabel}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{r.name}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        r.authorized && r.active ? 'bg-green-100 text-green-700'
                          : r.authorized ? 'bg-gray-100 text-gray-500'
                          : 'bg-amber-100 text-amber-700'
                      }`}>
                        {r.authorized && r.active ? 'Activa' : r.authorized ? 'Inactiva' : 'Pendiente de autorizar'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {new Date(r.createdAt).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric', timeZone: tz })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center gap-3 justify-end">
                        {r.kind !== 'ml' && r.kind !== 'dropship' && (
                          <button onClick={() => handleTest(r)} disabled={busyId === r.id}
                            className="text-xs text-blue-500 hover:text-blue-700 font-medium disabled:opacity-50">
                            Probar
                          </button>
                        )}
                        <Link href={r.settingsHref} className="text-xs text-gray-500 hover:text-gray-700 font-medium">
                          Ajustes
                        </Link>
                        <button onClick={() => handleDisconnect(r)} disabled={busyId === r.id}
                          className="text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-50">
                          {busyId === r.id ? '...' : 'Desconectar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-gray-400">
                      <p className="text-sm mb-1">Sin conexiones</p>
                      <p className="text-xs">Conecta un canal desde alguna de las categorías de arriba.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

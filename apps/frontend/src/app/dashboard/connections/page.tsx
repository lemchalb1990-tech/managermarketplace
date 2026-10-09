'use client';

import { useEffect, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useDashboardTimezone } from '@/lib/dashboardTimezone';
import { SkeletonRows } from '@/components/Skeleton';
import { FilterBar, FilterField, filterSelectCls } from '@/components/FilterBar';

const MARKETPLACE_LABEL: Record<string, string> = {
  MERCADO_LIBRE: 'Mercado Libre', SHOPIFY: 'Shopify', WOOCOMMERCE: 'WooCommerce',
  JUMPSELLER: 'JumpSeller', FALABELLA: 'Falabella', PARIS: 'Paris',
  HITES: 'Hites', RIPLEY: 'Ripley', WALMART: 'Walmart',
};

const BILLING_LABEL: Record<string, string> = {
  OPENFACTURA: 'OpenFactura', FACTO: 'Facto', BSALE: 'Bsale',
  DEFONTANA: 'Defontana', NUBOX: 'Nubox', SIIGO: 'Siigo',
};

type Row = {
  id: string;
  companyId: string | null;
  companyName: string;
  type: 'E-commerce' | 'Facturación';
  platform: string;
  name: string;
  active: boolean;
  authorized: boolean;
  expiresAt: string | null;
  createdAt: string;
  isMercadoLibre: boolean;
};

export default function ConnectionsPage() {
  const tz = useDashboardTimezone();
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'ecommerce' | 'billing'>('all');
  const [search, setSearch] = useState('');
  // Filtro por empresa: lista de todas las empresas ingresadas ('' = todas).
  const [companyFilter, setCompanyFilter] = useState('');
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [authorizingId, setAuthorizingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const token = getToken()!;
      const [mlConns, otherConns, billingConns, companyList] = await Promise.all([
        api.marketplace.connections(token),
        api.connections.list(token),
        api.billing.connections.list(token),
        api.companies.list(token).catch(() => []),
      ]);
      setCompanies(
        (companyList as any[]).map((c) => ({ id: c.id, name: c.name }))
          .sort((a, b) => a.name.localeCompare(b.name, 'es')),
      );

      const ecommerceRows: Row[] = [...mlConns, ...otherConns].map((c: any) => ({
        id: c.id,
        companyId: c.companyId ?? c.company?.id ?? null,
        companyName: c.company?.name || '—',
        type: 'E-commerce',
        platform: MARKETPLACE_LABEL[c.marketplace] || c.marketplace,
        name: c.name,
        active: c.active,
        authorized: c.authorized ?? true,
        expiresAt: c.expiresAt || null,
        createdAt: c.createdAt,
        isMercadoLibre: c.marketplace === 'MERCADO_LIBRE',
      }));

      const billingRows: Row[] = billingConns.map((c: any) => ({
        id: c.id,
        companyId: c.companyId ?? c.company?.id ?? null,
        companyName: c.company?.name || '—',
        type: 'Facturación',
        platform: BILLING_LABEL[c.provider] || c.provider,
        name: c.name,
        active: c.active,
        authorized: true,
        expiresAt: null,
        createdAt: c.createdAt,
        isMercadoLibre: false,
      }));

      setRows(
        [...ecommerceRows, ...billingRows].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
      );
    } catch (err: any) {
      setError(err.message || 'No se pudieron cargar las conexiones.');
    } finally {
      setLoading(false);
    }
  }

  // Conexiones globales (todas las empresas): solo Super Admin. El admin de empresa
  // gestiona las suyas en "Mis conexiones".
  useEffect(() => {
    if (getUser()?.role !== 'SUPER_ADMIN') {
      router.replace('/dashboard');
      return;
    }
    setAllowed(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRefreshToken(id: string) {
    setRefreshingId(id);
    setError('');
    try {
      const token = getToken()!;
      await api.marketplace.refreshConnection(id, token);
      await load();
    } catch (err: any) {
      setError(err.message || 'No se pudo renovar el token.');
    } finally {
      setRefreshingId(null);
    }
  }

  async function handleAuthorize(id: string) {
    setAuthorizingId(id);
    setError('');
    try {
      const token = getToken()!;
      const { authUrl } = await api.marketplace.authorize(id, token);
      window.open(authUrl, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      setError(err.message || 'No se pudo iniciar la autorización.');
    } finally {
      setAuthorizingId(null);
    }
  }

  const filtered = rows.filter((r) => {
    if (companyFilter && r.companyId !== companyFilter) return false;
    if (typeFilter === 'ecommerce' && r.type !== 'E-commerce') return false;
    if (typeFilter === 'billing' && r.type !== 'Facturación') return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return r.companyName.toLowerCase().includes(q)
        || r.platform.toLowerCase().includes(q)
        || r.name.toLowerCase().includes(q);
    }
    return true;
  });

  if (!allowed) return null;

  return (
    <div className="space-y-6">
      <div className="-mb-3">
        <h1 className="ui-page-title">Conexiones</h1>
        <p className="ui-page-subtitle">
          Todas las APIs de e-commerce y facturación conectadas, en todas las empresas.
        </p>
      </div>

      <FilterBar
        className="!mb-0"
        search={{ label: 'Buscar conexión', value: search, onChange: setSearch, placeholder: 'Empresa, plataforma o nombre...' }}
        activeCount={(typeFilter !== 'all' ? 1 : 0) + (companyFilter ? 1 : 0)}
        onClear={() => { setSearch(''); setTypeFilter('all' as any); setCompanyFilter(''); }}
      >
        <FilterField label="Empresa">
          <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} className={filterSelectCls}>
            <option value="">Todas las empresas</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({rows.filter((r) => r.companyId === c.id).length})
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Tipo">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} className={filterSelectCls}>
            <option value="all">Todos los tipos</option>
            <option value="ecommerce">E-commerce</option>
            <option value="billing">Facturación</option>
          </select>
        </FilterField>
      </FilterBar>

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Empresa</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Tipo</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Plataforma</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Conexión</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Estado</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Token expira</th>
              <th className="text-left px-4 py-3 text-gray-600 font-medium">Conectada el</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <SkeletonRows cols={8} />
            )}
            {!loading && filtered.map((r) => {
              const expired = r.expiresAt && new Date(r.expiresAt) < new Date();
              return (
                <tr key={`${r.type}-${r.id}`} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{r.companyName}</td>
                  <td className="px-4 py-3 text-gray-600">{r.type}</td>
                  <td className="px-4 py-3 text-gray-600">{r.platform}</td>
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
                  <td className="px-4 py-3">
                    {r.expiresAt ? (
                      <span className={`text-xs ${expired ? 'text-red-500 font-medium' : 'text-gray-500'}`}>
                        {expired ? 'Expirado · ' : ''}{new Date(r.expiresAt).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric', timeZone: tz })}
                      </span>
                    ) : <span className="text-gray-400 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {new Date(r.createdAt).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric', timeZone: tz })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.isMercadoLibre && !r.authorized && (
                      <button onClick={() => handleAuthorize(r.id)}
                        disabled={authorizingId === r.id}
                        className="text-xs text-green-600 hover:text-green-800 font-medium disabled:opacity-50">
                        {authorizingId === r.id ? 'Redirigiendo...' : 'Autorizar'}
                      </button>
                    )}
                    {r.isMercadoLibre && r.active && (
                      <button onClick={() => handleRefreshToken(r.id)}
                        disabled={refreshingId === r.id}
                        className="text-xs text-amber-600 hover:text-amber-800 font-medium disabled:opacity-50">
                        {refreshingId === r.id ? 'Renovando...' : 'Renovar token'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                  <p className="text-sm">No hay conexiones que coincidan con el filtro.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

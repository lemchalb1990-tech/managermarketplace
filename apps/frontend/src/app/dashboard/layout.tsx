'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { getToken, getUser, clearSession } from '@/lib/auth';
import { hasModule } from '@/lib/modules';
import { can } from '@/lib/permissions';

type NavItem = { href: string; label: string; perm: string; roles: string[]; module: string | null };
type NavGroup = { key: string; label: string; items: NavItem[] };

// Estructura por secciones (estilo consola de operación). Cada ítem conserva su
// gate por rol y por módulo; los grupos sin ítems visibles se ocultan solos.
const navGroups: NavGroup[] = [
  {
    key: 'inicio',
    label: '',
    items: [
      { href: '/dashboard', label: 'Inicio', perm: 'dashboard', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: null },
    ],
  },
  {
    key: 'ventas',
    label: 'Ventas',
    items: [
      { href: '/dashboard/pos', label: 'Punto de Venta', perm: 'pos', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR'], module: 'pos' },
      { href: '/dashboard/clientes', label: 'Registro de Clientes', perm: 'clientes', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR', 'ORDER_MANAGER'], module: null },
      { href: '/dashboard/devoluciones', label: 'Devoluciones', perm: 'returns', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR'], module: null },
      { href: '/dashboard/envios', label: 'Órdenes y envíos', perm: 'shipping', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR'], module: null },
      { href: '/dashboard/sales', label: 'Reporte de Ventas', perm: 'sales', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR'], module: 'sales' },
    ],
  },
  {
    key: 'canales',
    label: 'Canales',
    items: [
      { href: '/dashboard/ecommerce', label: 'E-commerce', perm: 'ecommerce', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'ecommerce' },
      { href: '/dashboard/billing', label: 'Facturación', perm: 'billing', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'billing' },
    ],
  },
  {
    key: 'catalogo',
    label: 'Catálogo y bodega',
    items: [
      { href: '/dashboard/catalog', label: 'Catálogo', perm: 'catalog', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'catalog' },
      { href: '/dashboard/warehouses', label: 'Bodegas', perm: 'warehouses', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'catalog' },
      { href: '/dashboard/purchases', label: 'Compras', perm: 'purchases', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'purchases' },
      { href: '/dashboard/suppliers', label: 'Proveedores', perm: 'suppliers', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'purchases' },
      { href: '/dashboard/rentabilidad', label: 'Rentabilidad', perm: 'rentabilidad', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'rentabilidad' },
    ],
  },
  {
    key: 'operacion',
    label: 'Operación',
    items: [
      { href: '/dashboard/bodega', label: 'Tablero de bodega', perm: 'warehouse.board', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: null },
      { href: '/dashboard/bodega/picking', label: 'Picking', perm: 'warehouse.picking', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR', 'DESPACHADOR'], module: null },
      { href: '/dashboard/bodega/packing', label: 'Packing', perm: 'warehouse.packing', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR', 'DESPACHADOR'], module: null },
    ],
  },
  {
    key: 'repartidores',
    label: 'Repartidores',
    items: [
      { href: '/dashboard/despachos', label: 'Rutas', perm: 'despachos', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'dispatch' },
      { href: '/dashboard/mis-rutas', label: 'Mis rutas', perm: 'mis-rutas', roles: ['DESPACHADOR'], module: 'dispatch' },
      { href: '/dashboard/repartidores/flota', label: 'Flota', perm: 'drivers.fleet', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'dispatch' },
      { href: '/dashboard/repartidores/metricas', label: 'Métricas', perm: 'drivers.metrics', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'dispatch' },
      { href: '/dashboard/repartidores/remuneracion', label: 'Remuneración', perm: 'drivers.payments', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'], module: 'dispatch' },
      { href: '/dashboard/repartidores/zonas', label: 'Zonas de demanda', perm: 'drivers.zones', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'dispatch' },
    ],
  },
  {
    key: 'colaboradores',
    label: 'Colaboradores',
    items: [
      { href: '/dashboard/users', label: 'Usuarios', perm: 'users', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'], module: null },
      { href: '/dashboard/access-profiles', label: 'Perfiles de acceso', perm: 'access-profiles', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'], module: null },
    ],
  },
  {
    key: 'admin',
    label: 'Administración',
    items: [
      { href: '/dashboard/companies', label: 'Empresas', perm: 'companies', roles: ['SUPER_ADMIN'], module: null },
      { href: '/dashboard/connections', label: 'Conexiones', perm: 'connections', roles: ['SUPER_ADMIN'], module: null },
      { href: '/dashboard/emails', label: 'Correos', perm: 'emails', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'], module: null },
      { href: '/dashboard/settings', label: 'Configuración', perm: 'settings', roles: ['SUPER_ADMIN'], module: null },
    ],
  },
];

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  COMPANY_ADMIN: 'Admin empresa',
  CATALOG_MANAGER: 'Gestor catálogo',
  VENDEDOR: 'Vendedor',
  DESPACHADOR: 'Despachador',
  ORDER_MANAGER: 'Admin. Pedidos',
};

function isActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(href + '/');
}

// Iconos por sección (stroke, 16px). currentColor hereda el color del titular.
const ICON_PATHS: Record<string, string> = {
  inicio: 'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5',
  ventas: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4ZM3 6h18M16 10a4 4 0 0 1-8 0',
  canales: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 13v7M13 16.5h7',
  catalogo: 'M21 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2M3 8h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM9 12h6',
  operacion: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2Zm0 8 2 2 4-4',
  repartidores: 'M3 16V7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9M16 10h3l2 3v3h-5M7.5 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  colaboradores: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-7.13a4 4 0 0 1 0 7.75',
  admin: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.2.61.76 1.03 1.4 1.09H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
};

function GroupIcon({ k }: { k: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d={ICON_PATHS[k] ?? ICON_PATHS.canales} />
    </svg>
  );
}

const OPEN_KEY = 'mp_nav_open';
const COLLAPSE_KEY = 'mp_nav_collapsed';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}'); } catch { return {}; }
  });
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1'); } catch { /* ignore */ }
  }, []);

  function toggleCollapsed() {
    setCollapsed((c) => {
      try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); } catch { /* ignore */ }
      return !c;
    });
  }

  const activeGroupKey = useMemo(() => {
    const g = navGroups.find((grp) => grp.items.some((it) => isActive(pathname, it.href)));
    return g?.key ?? null;
  }, [pathname]);

  useEffect(() => {
    const token = getToken();
    const u = getUser();
    if (!token || !u) {
      router.push('/login');
      return;
    }
    setUser(u);
  }, [router]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  // Al navegar, deja abierto el grupo de la ruta actual.
  useEffect(() => {
    if (activeGroupKey) setOpenGroups((s) => (s[activeGroupKey] ? s : { ...s, [activeGroupKey]: true }));
  }, [activeGroupKey]);

  function toggleGroup(key: string) {
    setOpenGroups((s) => {
      const next = { ...s, [key]: !s[key] };
      try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  function logout() {
    clearSession();
    router.push('/login');
  }

  const visibleGroups = useMemo(() => {
    if (!user) return [];
    return navGroups
      .map((g) => ({
        ...g,
        items: g.items.filter((n) => can(user, n.perm, n.roles) && hasModule(user, n.module)),
      }))
      .filter((g) => g.items.length > 0);
  }, [user]);

  if (!user) return null;

  const roleLabel = roleLabels[user.role as string] ?? user.role;

  const sidebarContent = (
    <>
      <div className="md:hidden h-[var(--topbar-h)] px-4 flex items-center justify-between shrink-0 border-b border-[var(--border-soft)]">
        <span className="font-bold text-[var(--text)] text-base tracking-tight">Marketplace</span>
        <button
          onClick={() => setSidebarOpen(false)}
          className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none"
          aria-label="Cerrar menú"
        >
          ✕
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-1 px-2 min-h-0">
        {visibleGroups.map((g) => {
          const links = g.items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center pl-[2.1rem] pr-3 py-1.5 rounded-lg text-sm transition-colors ${
                  active
                    ? 'bg-[var(--brand-light)] text-[var(--brand-ink)] font-semibold'
                    : 'text-[var(--text-2)] font-medium hover:bg-[var(--surface-soft)]'
                }`}
              >
                {item.label}
              </Link>
            );
          });

          // Grupo sin nombre (Inicio): link directo con icono.
          if (!g.label) {
            const item = g.items[0];
            const active = item && isActive(pathname, item.href);
            return (
              <div key={g.key} className="border-b border-[var(--border-soft)]">
                <Link
                  href={item.href}
                  className={`flex items-center gap-2.5 px-2 py-2 my-0.5 rounded-lg text-[0.8125rem] font-semibold transition-colors ${
                    active ? 'text-[var(--brand-ink)]' : 'text-[var(--text-2)] hover:text-[var(--text)]'
                  }`}
                >
                  <span className="w-3.5" />
                  <GroupIcon k="inicio" />
                  <span>{item.label}</span>
                </Link>
              </div>
            );
          }

          const open = !!openGroups[g.key];
          const hasActive = g.key === activeGroupKey;
          return (
            <div key={g.key} className="border-b border-[var(--border-soft)] last:border-b-0">
              <button
                onClick={() => toggleGroup(g.key)}
                className={`w-full flex items-center gap-2.5 px-2 py-2 my-0.5 text-left transition-colors ${
                  open || hasActive ? 'text-[var(--brand-ink)]' : 'text-[var(--text-2)] hover:text-[var(--text)]'
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  strokeLinecap="round" strokeLinejoin="round"
                  className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}>
                  <path d="M9 6l6 6-6 6" />
                </svg>
                <GroupIcon k={g.key} />
                <span className={open ? 'font-bold uppercase tracking-wide text-[0.75rem]' : 'font-semibold text-[0.8125rem]'}>
                  {g.label}
                </span>
              </button>
              {open && <div className="pb-1.5 space-y-0.5">{links}</div>}
            </div>
          );
        })}
      </nav>

      <div className="px-4 py-3 border-t border-[var(--border-soft)] shrink-0">
        <p className="text-xs text-[var(--text-muted)] truncate mb-0.5">{user.email}</p>
        <p className="text-xs font-medium text-[var(--text-2)] mb-2">{roleLabel}</p>
        <button
          onClick={logout}
          className="w-full text-xs text-[var(--danger)] hover:underline text-left"
        >
          Cerrar sesión
        </button>
      </div>
    </>
  );

  const MenuIcon = (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );

  return (
    <div className="h-dvh flex overflow-hidden bg-[var(--page-bg)]">
      {/* Sidebar desktop: alto fijo (viewport), colapsable */}
      <aside
        className={`hidden md:flex md:shrink-0 bg-[var(--surface)] border-r border-[var(--border)] flex-col overflow-hidden transition-[width] duration-200 ${
          collapsed ? 'md:w-0 md:border-r-0' : 'md:w-[var(--side-w)]'
        }`}
      >
        {sidebarContent}
      </aside>

      {/* Drawer mobile */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setSidebarOpen(false)} />
      )}
      <aside
        className={`md:hidden fixed inset-y-0 left-0 z-50 w-64 max-w-[80vw] bg-[var(--surface)] border-r border-[var(--border)] flex flex-col transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebarContent}
      </aside>

      <div className="flex-1 flex flex-col min-w-0 h-dvh">
        <header className="flex items-center gap-3 px-4 h-[var(--topbar-h)] bg-[var(--topbar-bg)] text-[var(--topbar-fg)] shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden p-1 -ml-1"
            aria-label="Abrir menú"
          >
            {MenuIcon}
          </button>
          <button
            onClick={toggleCollapsed}
            className="hidden md:inline-flex p-1 -ml-1 hover:opacity-80"
            aria-label={collapsed ? 'Mostrar menú' : 'Ocultar menú'}
          >
            {MenuIcon}
          </button>
          <span className="font-bold tracking-tight">Marketplace</span>
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 min-w-0">{children}</main>
      </div>
    </div>
  );
}

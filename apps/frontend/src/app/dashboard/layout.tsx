'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { getToken, getUser, clearSession } from '@/lib/auth';
import { hasModule } from '@/lib/modules';

type NavItem = { href: string; label: string; roles: string[]; module: string | null };
type NavGroup = { key: string; label: string; items: NavItem[] };

// Estructura por secciones (estilo consola de operación). Cada ítem conserva su
// gate por rol y por módulo; los grupos sin ítems visibles se ocultan solos.
const navGroups: NavGroup[] = [
  {
    key: 'inicio',
    label: '',
    items: [
      { href: '/dashboard', label: 'Inicio', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: null },
    ],
  },
  {
    key: 'ventas',
    label: 'Ventas',
    items: [
      { href: '/dashboard/orders', label: 'Órdenes', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR'], module: null },
      { href: '/dashboard/sales', label: 'Ventas', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR'], module: 'sales' },
      { href: '/dashboard/pos', label: 'Punto de Venta', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR'], module: 'pos' },
      { href: '/dashboard/clientes', label: 'Clientes', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR', 'ORDER_MANAGER'], module: null },
    ],
  },
  {
    key: 'canales',
    label: 'Canales',
    items: [
      { href: '/dashboard/ecommerce', label: 'E-commerce', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'ecommerce' },
      { href: '/dashboard/billing', label: 'Facturación', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'billing' },
    ],
  },
  {
    key: 'catalogo',
    label: 'Catálogo y bodega',
    items: [
      { href: '/dashboard/catalog', label: 'Catálogo', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'catalog' },
      { href: '/dashboard/warehouses', label: 'Bodegas', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'catalog' },
      { href: '/dashboard/purchases', label: 'Compras', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'purchases' },
      { href: '/dashboard/suppliers', label: 'Proveedores', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'purchases' },
      { href: '/dashboard/rentabilidad', label: 'Rentabilidad', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'rentabilidad' },
    ],
  },
  {
    key: 'pedidos',
    label: 'Pedidos internos',
    items: [
      { href: '/dashboard/pedidos/nueva-solicitud', label: 'Nueva solicitud', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR', 'ORDER_MANAGER'], module: null },
      { href: '/dashboard/pedidos/mis-solicitudes', label: 'Mis solicitudes', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR', 'ORDER_MANAGER'], module: null },
      { href: '/dashboard/pedidos/aprobaciones', label: 'Aprobación de pedidos', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'ORDER_MANAGER'], module: null },
    ],
  },
  {
    key: 'despacho',
    label: 'Despacho',
    items: [
      { href: '/dashboard/despachos', label: 'Despachos', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'dispatch' },
      { href: '/dashboard/mis-rutas', label: 'Mis rutas', roles: ['DESPACHADOR'], module: 'dispatch' },
    ],
  },
  {
    key: 'colaboradores',
    label: 'Colaboradores',
    items: [
      { href: '/dashboard/users', label: 'Usuarios', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'], module: null },
    ],
  },
  {
    key: 'admin',
    label: 'Administración',
    items: [
      { href: '/dashboard/companies', label: 'Empresas', roles: ['SUPER_ADMIN'], module: null },
      { href: '/dashboard/connections', label: 'Conexiones', roles: ['SUPER_ADMIN'], module: null },
      { href: '/dashboard/emails', label: 'Correos', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'], module: null },
      { href: '/dashboard/settings', label: 'Configuración', roles: ['SUPER_ADMIN'], module: null },
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

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

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

  function logout() {
    clearSession();
    router.push('/login');
  }

  const visibleGroups = useMemo(() => {
    if (!user) return [];
    return navGroups
      .map((g) => ({
        ...g,
        items: g.items.filter((n) => n.roles.includes(user.role) && hasModule(user, n.module)),
      }))
      .filter((g) => g.items.length > 0);
  }, [user]);

  if (!user) return null;

  const roleLabel = roleLabels[user.role as string] ?? user.role;

  const sidebarContent = (
    <>
      <div className="h-[var(--topbar-h)] px-4 flex items-center justify-between shrink-0 border-b border-[var(--border-soft)]">
        <span className="font-bold text-[var(--text)] text-base tracking-tight">Marketplace</span>
        <button
          onClick={() => setSidebarOpen(false)}
          className="md:hidden text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none"
          aria-label="Cerrar menú"
        >
          ✕
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-3 min-h-0">
        {visibleGroups.map((g) => (
          <div key={g.key} className="mb-3 last:mb-0">
            {g.label && (
              <p className="px-3 pt-2 pb-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {g.label}
              </p>
            )}
            <div className="space-y-0.5">
              {g.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      active
                        ? 'bg-[var(--brand-light)] text-[var(--brand-ink)]'
                        : 'text-[var(--text-2)] hover:bg-[var(--surface-soft)]'
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
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

  return (
    <div className="min-h-screen flex bg-[var(--page-bg)]">
      <aside className="hidden md:flex md:w-[var(--side-w)] md:shrink-0 bg-[var(--surface)] border-r border-[var(--border)] flex-col">
        {sidebarContent}
      </aside>

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

      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden flex items-center justify-between px-4 h-[var(--topbar-h)] bg-[var(--topbar-bg)] text-[var(--topbar-fg)] sticky top-0 z-30">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1 -ml-1"
            aria-label="Abrir menú"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <span className="font-bold tracking-tight">Marketplace</span>
          <div className="w-6" />
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto min-w-0">{children}</main>
      </div>
    </div>
  );
}

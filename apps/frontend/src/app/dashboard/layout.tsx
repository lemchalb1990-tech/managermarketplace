'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { getToken, getUser, clearSession } from '@/lib/auth';
import { hasModule } from '@/lib/modules';

// module: null = siempre visible (sin restricción por módulos)
// module: 'ecommerce' = visible si user tiene ecommerce_ml, ecommerce_shopify, etc. (prefijo)
const navItems = [
  { href: '/dashboard', label: 'Inicio', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: null },
  { href: '/dashboard/companies', label: 'Empresas', roles: ['SUPER_ADMIN'], module: null },
  { href: '/dashboard/connections', label: 'Conexiones', roles: ['SUPER_ADMIN'], module: null },
  { href: '/dashboard/users', label: 'Usuarios', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'], module: null },
  { href: '/dashboard/catalog', label: 'Catálogo', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'catalog' },
  { href: '/dashboard/warehouses', label: 'Bodegas', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'catalog' },
  { href: '/dashboard/rentabilidad', label: 'Rentabilidad', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'rentabilidad' },
  { href: '/dashboard/purchases', label: 'Compras', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'purchases' },
  { href: '/dashboard/suppliers', label: 'Proveedores', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'purchases' },
  { href: '/dashboard/ecommerce', label: 'E-commerce', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'ecommerce' },
  { href: '/dashboard/pos', label: 'Punto de Venta', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR'], module: 'pos' },
  { href: '/dashboard/sales', label: 'Ventas', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR'], module: 'sales' },
  { href: '/dashboard/orders', label: 'Órdenes', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR'], module: null },
  { href: '/dashboard/clientes', label: 'Clientes', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR', 'ORDER_MANAGER'], module: null },
  { href: '/dashboard/pedidos/nueva-solicitud', label: 'Nueva Solicitud', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR', 'ORDER_MANAGER'], module: null },
  { href: '/dashboard/pedidos/mis-solicitudes', label: 'Mis Solicitudes', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER', 'VENDEDOR', 'ORDER_MANAGER'], module: null },
  { href: '/dashboard/pedidos/aprobaciones', label: 'Aprobación de Pedidos', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'ORDER_MANAGER'], module: null },
  { href: '/dashboard/despachos', label: 'Despachos', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'dispatch' },
  { href: '/dashboard/mis-rutas', label: 'Mis Rutas', roles: ['DESPACHADOR'], module: 'dispatch' },
  { href: '/dashboard/emails', label: 'Correos', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'], module: null },
  { href: '/dashboard/billing', label: 'Facturación', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'], module: 'billing' },
  { href: '/dashboard/settings', label: 'Configuración', roles: ['SUPER_ADMIN'], module: null },
];

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

  // Cierra el drawer mobile automáticamente al navegar a otra ruta.
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  function logout() {
    clearSession();
    router.push('/login');
  }

  if (!user) return null;

  const visibleNav = navItems.filter(
    (n) => n.roles.includes(user.role) && hasModule(user, n.module),
  );

  const roleLabel = { SUPER_ADMIN: 'Super Admin', COMPANY_ADMIN: 'Admin empresa', CATALOG_MANAGER: 'Gestor catálogo', VENDEDOR: 'Vendedor', DESPACHADOR: 'Despachador', ORDER_MANAGER: 'Admin. Pedidos' }[user.role as string] ?? user.role;

  const sidebarContent = (
    <>
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
        <span className="font-bold text-gray-900 text-lg">Marketplace</span>
        <button
          onClick={() => setSidebarOpen(false)}
          className="md:hidden text-gray-400 hover:text-gray-600 text-xl leading-none"
          aria-label="Cerrar menú"
        >
          ✕
        </button>
      </div>
      <nav className="flex-1 py-3 px-3 space-y-0.5 min-h-0">
        {visibleNav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
                ? 'bg-blue-50 text-blue-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="px-4 py-3 border-t border-gray-200 shrink-0">
        <p className="text-xs text-gray-500 truncate mb-0.5">{user.email}</p>
        <p className="text-xs font-medium text-gray-700 mb-2">{roleLabel}</p>
        <button
          onClick={logout}
          className="w-full text-xs text-red-600 hover:text-red-700 text-left"
        >
          Cerrar sesión
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Sidebar: fija en desktop, drawer off-canvas en mobile */}
      <aside className="hidden md:flex md:w-56 md:shrink-0 bg-white border-r border-gray-200 flex-col">
        {sidebarContent}
      </aside>

      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setSidebarOpen(false)} />
      )}
      <aside
        className={`md:hidden fixed inset-y-0 left-0 z-50 w-64 max-w-[80vw] bg-white border-r border-gray-200 flex flex-col transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebarContent}
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200 sticky top-0 z-30">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-gray-600 hover:text-gray-900 p-1 -ml-1"
            aria-label="Abrir menú"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <span className="font-bold text-gray-900">Marketplace</span>
          <div className="w-6" />
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto min-w-0">{children}</main>
      </div>
    </div>
  );
}

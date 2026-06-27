'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { getToken, getUser, clearSession } from '@/lib/auth';

const navItems = [
  { href: '/dashboard', label: 'Inicio', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'] },
  { href: '/dashboard/companies', label: 'Empresas', roles: ['SUPER_ADMIN'] },
  { href: '/dashboard/users', label: 'Usuarios', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN'] },
  { href: '/dashboard/catalog', label: 'Catálogo', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'] },
  { href: '/dashboard/ecommerce', label: 'E-commerce', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'] },
  { href: '/dashboard/pos', label: 'Punto de Venta', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'] },
  { href: '/dashboard/sales', label: 'Ventas', roles: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'] },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const token = getToken();
    const u = getUser();
    if (!token || !u) {
      router.push('/login');
      return;
    }
    setUser(u);
  }, [router]);

  function logout() {
    clearSession();
    router.push('/login');
  }

  if (!user) return null;

  const visibleNav = navItems.filter((n) => n.roles.includes(user.role));

  return (
    <div className="min-h-screen flex bg-gray-50">
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="px-6 py-5 border-b border-gray-200">
          <span className="font-bold text-gray-900 text-lg">Marketplace</span>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-1">
          {visibleNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname === item.href
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-gray-200">
          <p className="text-xs text-gray-500 truncate mb-1">{user.email}</p>
          <p className="text-xs font-medium text-gray-700 mb-3">{user.role.replace('_', ' ')}</p>
          <button
            onClick={logout}
            className="w-full text-xs text-red-600 hover:text-red-700 text-left"
          >
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="flex-1 p-8 overflow-auto">{children}</main>
    </div>
  );
}

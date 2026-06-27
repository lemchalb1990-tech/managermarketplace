'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [stats, setStats] = useState({ products: 0, companies: 0, users: 0 });

  useEffect(() => {
    const u = getUser();
    const token = getToken();
    if (!u || !token) return;
    if (u.role === 'VENDEDOR') { router.replace('/dashboard/pos'); return; }
    setUser(u);

    (async () => {
      try {
        const products = await api.catalog.list(token);
        setStats((s) => ({ ...s, products: products.length }));
        if (u.role === 'SUPER_ADMIN') {
          const companies = await api.companies.list(token);
          const users = await api.users.list(token);
          setStats({ products: products.length, companies: companies.length, users: users.length });
        }
      } catch (_) {}
    })();
  }, []);

  const cards = [
    { label: 'Productos', value: stats.products, visible: true },
    { label: 'Empresas', value: stats.companies, visible: user?.role === 'SUPER_ADMIN' },
    { label: 'Usuarios', value: stats.users, visible: ['SUPER_ADMIN', 'COMPANY_ADMIN'].includes(user?.role) },
  ].filter((c) => c.visible);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">
        Bienvenido, {user?.name}
      </h1>
      <p className="text-gray-500 mb-8 text-sm">{user?.company?.name || 'Super Administrador'}</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-6">
            <p className="text-sm text-gray-500 mb-1">{card.label}</p>
            <p className="text-3xl font-bold text-gray-900">{card.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

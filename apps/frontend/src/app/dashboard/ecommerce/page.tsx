'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getUser } from '@/lib/auth';

const PLATFORMS = [
  {
    id: 'mercadolibre', moduleKey: 'ecommerce_ml', name: 'Mercado Libre',
    description: 'Publica y sincroniza productos en Mercado Libre Chile.',
    href: '/dashboard/ecommerce/mercadolibre',
    bg: '#FFE600', textColor: '#333', badge: 'Activo', badgeColor: 'bg-green-100 text-green-700',
    border: 'border-yellow-300 hover:border-yellow-400', available: true,
  },
  {
    id: 'shopify', moduleKey: 'ecommerce_shopify', name: 'Shopify',
    description: 'Sincroniza inventario y pedidos con tu tienda Shopify.',
    href: '/dashboard/ecommerce/shopify',
    bg: '#96BF48', textColor: '#fff', badge: 'Activo', badgeColor: 'bg-green-100 text-green-700',
    border: 'border-green-200 hover:border-green-400', available: true,
  },
  {
    id: 'woocommerce', moduleKey: 'ecommerce_woocommerce', name: 'WooCommerce',
    description: 'Conecta tu tienda WordPress/WooCommerce para gestionar pedidos y stock.',
    href: '/dashboard/ecommerce/woocommerce',
    bg: '#7F54B3', textColor: '#fff', badge: 'Activo', badgeColor: 'bg-green-100 text-green-700',
    border: 'border-purple-200 hover:border-purple-400', available: true,
  },
  {
    id: 'jumpseller', moduleKey: 'ecommerce_jumpseller', name: 'JumpSeller',
    description: 'Gestiona tu tienda JumpSeller con sincronización automática de stock.',
    href: '/dashboard/ecommerce/jumpseller',
    bg: '#FF6B35', textColor: '#fff', badge: 'Activo', badgeColor: 'bg-green-100 text-green-700',
    border: 'border-orange-200 hover:border-orange-400', available: true,
  },
  {
    id: 'falabella', moduleKey: 'ecommerce_falabella', name: 'Falabella',
    description: 'Publica en Falabella Marketplace y sincroniza tu inventario.',
    href: '/dashboard/ecommerce/falabella',
    bg: '#7CB342', textColor: '#fff', badge: 'Beta', badgeColor: 'bg-blue-100 text-blue-700',
    border: 'border-green-200 hover:border-green-400', available: true,
  },
  {
    id: 'paris', moduleKey: 'ecommerce_paris', name: 'Paris',
    description: 'Vende en Paris Marketplace (Cencosud) con sincronización de inventario.',
    href: '/dashboard/ecommerce/paris',
    bg: '#1565C0', textColor: '#fff', badge: 'Beta', badgeColor: 'bg-blue-100 text-blue-700',
    border: 'border-blue-200 hover:border-blue-400', available: true,
  },
  {
    id: 'hites', moduleKey: 'ecommerce_hites', name: 'Hites',
    description: 'Publica en Hites Marketplace y gestiona tu stock automáticamente.',
    href: '/dashboard/ecommerce/hites',
    bg: '#E53935', textColor: '#fff', badge: 'Beta', badgeColor: 'bg-blue-100 text-blue-700',
    border: 'border-red-200 hover:border-red-400', available: true,
  },
  {
    id: 'ripley', moduleKey: 'ecommerce_ripley', name: 'Ripley',
    description: 'Conecta tu cuenta de Ripley Marketplace para centralizar tu inventario.',
    href: '/dashboard/ecommerce/ripley',
    bg: '#6A1B9A', textColor: '#fff', badge: 'Beta', badgeColor: 'bg-blue-100 text-blue-700',
    border: 'border-purple-200 hover:border-purple-400', available: true,
  },
  {
    id: 'walmart', moduleKey: 'ecommerce_walmart', name: 'Walmart',
    description: 'Vende en Walmart Chile con sincronización automática de precios y stock.',
    href: '/dashboard/ecommerce/walmart',
    bg: '#0071CE', textColor: '#fff', badge: 'Beta', badgeColor: 'bg-blue-100 text-blue-700',
    border: 'border-blue-200 hover:border-blue-400', available: true,
  },
];

function hasModule(user: any, moduleKey: string): boolean {
  if (!user || user.role === 'SUPER_ADMIN') return true;
  const companyMods = user.company?.modules;
  if (companyMods && Array.isArray(companyMods) && !companyMods.includes(moduleKey)) return false;
  const userMods = user.modules;
  if (!userMods || !Array.isArray(userMods)) return true;
  return userMods.includes(moduleKey);
}

export default function EcommercePage() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  useEffect(() => { setCurrentUser(getUser()); }, []);

  const visible = PLATFORMS.filter((p) => hasModule(currentUser, p.moduleKey));

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">E-commerce</h1>
        <p className="text-gray-500 text-sm">
          Conecta y gestiona todos tus canales de venta online. El catálogo central sincroniza stock y precios en cada plataforma automáticamente.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visible.map((p) => (
          <Link key={p.id} href={p.href} className="block group">
            <div className={`bg-white border-2 rounded-2xl p-5 transition-all hover:shadow-md ${p.border}`}>
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-8 rounded-lg flex items-center justify-center text-xs font-bold"
                  style={{ background: p.bg, color: p.textColor }}>
                  {p.name.slice(0, 2).toUpperCase()}
                </div>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${p.badgeColor}`}>
                  {p.badge}
                </span>
              </div>
              <h2 className="font-semibold text-gray-900 mb-1">{p.name}</h2>
              <p className="text-xs text-gray-500 leading-relaxed">{p.description}</p>
              <p className="mt-3 text-xs font-semibold text-blue-600 group-hover:text-blue-700">
                Gestionar →
              </p>
            </div>
          </Link>
        ))}

        {visible.length === 0 && (
          <div className="col-span-3 text-center py-12 text-gray-400">
            <p className="text-sm">No tienes plataformas de e-commerce habilitadas.</p>
            <p className="text-xs mt-1">Contacta al administrador para activar los módulos.</p>
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';

const platforms = [
  {
    id: 'mercadolibre',
    name: 'Mercado Libre',
    description: 'Publica y sincroniza productos en Mercado Libre Chile.',
    href: '/dashboard/ecommerce/mercadolibre',
    available: true,
    logo: (
      <svg viewBox="0 0 120 40" className="h-8" aria-label="Mercado Libre">
        <rect width="120" height="40" rx="6" fill="#FFE600" />
        <text x="60" y="27" textAnchor="middle" fontSize="14" fontWeight="bold" fill="#333333" fontFamily="sans-serif">
          Mercado Libre
        </text>
      </svg>
    ),
    color: 'border-yellow-300 hover:border-yellow-400 hover:shadow-yellow-100',
    badge: 'Conectado',
    badgeColor: 'bg-green-100 text-green-700',
  },
  {
    id: 'shopify',
    name: 'Shopify',
    description: 'Sincroniza inventario y pedidos con tu tienda Shopify.',
    href: '#',
    available: false,
    logo: (
      <svg viewBox="0 0 120 40" className="h-8" aria-label="Shopify">
        <rect width="120" height="40" rx="6" fill="#96BF48" />
        <text x="60" y="27" textAnchor="middle" fontSize="14" fontWeight="bold" fill="#FFFFFF" fontFamily="sans-serif">
          Shopify
        </text>
      </svg>
    ),
    color: 'border-gray-200 opacity-60 cursor-not-allowed',
    badge: 'Próximamente',
    badgeColor: 'bg-gray-100 text-gray-500',
  },
  {
    id: 'woocommerce',
    name: 'WooCommerce',
    description: 'Conecta tu tienda WooCommerce para gestionar pedidos y stock.',
    href: '#',
    available: false,
    logo: (
      <svg viewBox="0 0 120 40" className="h-8" aria-label="WooCommerce">
        <rect width="120" height="40" rx="6" fill="#7F54B3" />
        <text x="60" y="27" textAnchor="middle" fontSize="13" fontWeight="bold" fill="#FFFFFF" fontFamily="sans-serif">
          WooCommerce
        </text>
      </svg>
    ),
    color: 'border-gray-200 opacity-60 cursor-not-allowed',
    badge: 'Próximamente',
    badgeColor: 'bg-gray-100 text-gray-500',
  },
];

export default function EcommercePage() {
  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">E-commerce</h1>
        <p className="text-gray-500 text-sm">
          Conecta y gestiona tus canales de venta online. Cada plataforma sincroniza stock, precios y pedidos automáticamente.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {platforms.map((p) => {
          const card = (
            <div
              className={`bg-white border-2 rounded-2xl p-5 transition-shadow ${p.color} ${p.available ? 'hover:shadow-md' : ''}`}
            >
              <div className="flex items-start justify-between mb-4">
                {p.logo}
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${p.badgeColor}`}>
                  {p.badge}
                </span>
              </div>
              <h2 className="font-semibold text-gray-900 mb-1">{p.name}</h2>
              <p className="text-xs text-gray-500 leading-relaxed">{p.description}</p>
              {p.available && (
                <p className="mt-3 text-xs font-semibold text-blue-600">Gestionar →</p>
              )}
            </div>
          );

          return p.available ? (
            <Link key={p.id} href={p.href} className="block">
              {card}
            </Link>
          ) : (
            <div key={p.id}>{card}</div>
          );
        })}
      </div>
    </div>
  );
}

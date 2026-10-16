'use client';

import { connectorStatus, connectorVisibleTo, VisibilityBadge } from '@/lib/connectors';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { Logos } from './components/logos';
import { logoScaleStyle, viewScale, useReservedPlatforms } from '@/lib/platformLogos';
import { PlatformEditModal } from '@/components/PlatformEditModal';
import { useAdminCompany } from '../AdminCompanyContext';

const DEFAULT_PLATFORMS = [
  {
    id: 'mercadolibre', moduleKey: 'ecommerce_ml', name: 'Mercado Libre',
    description: 'Publica y sincroniza productos en Mercado Libre Chile.',
    href: '/dashboard/ecommerce/mercadolibre',
    activeBorder: 'border-yellow-400',
  },
  {
    id: 'shopify', moduleKey: 'ecommerce_shopify', name: 'Shopify',
    description: 'Sincroniza inventario y pedidos con tu tienda Shopify.',
    href: '/dashboard/ecommerce/shopify',
    activeBorder: 'border-green-400',
  },
  {
    id: 'woocommerce', moduleKey: 'ecommerce_woocommerce', name: 'WooCommerce',
    description: 'Conecta tu tienda WordPress/WooCommerce para gestionar pedidos y stock.',
    href: '/dashboard/ecommerce/woocommerce',
    activeBorder: 'border-purple-400',
  },
  {
    id: 'jumpseller', moduleKey: 'ecommerce_jumpseller', name: 'JumpSeller',
    description: 'Gestiona tu tienda JumpSeller con sincronización automática de stock.',
    href: '/dashboard/ecommerce/jumpseller',
    activeBorder: 'border-orange-400',
  },
  {
    id: 'falabella', moduleKey: 'ecommerce_falabella', name: 'Falabella',
    description: 'Publica en Falabella Marketplace y sincroniza tu inventario.',
    href: '/dashboard/ecommerce/falabella',
    activeBorder: 'border-green-500',
  },
  {
    id: 'paris', moduleKey: 'ecommerce_paris', name: 'Paris',
    description: 'Vende en Paris Marketplace (Cencosud) con sincronización de inventario.',
    href: '/dashboard/ecommerce/paris',
    activeBorder: 'border-blue-400',
  },
  {
    id: 'hites', moduleKey: 'ecommerce_hites', name: 'Hites',
    description: 'Publica en Hites Marketplace y gestiona tu stock automáticamente.',
    href: '/dashboard/ecommerce/hites',
    activeBorder: 'border-red-400',
  },
  {
    id: 'ripley', moduleKey: 'ecommerce_ripley', name: 'Ripley',
    description: 'Conecta tu cuenta de Ripley Marketplace para centralizar tu inventario.',
    href: '/dashboard/ecommerce/ripley',
    activeBorder: 'border-purple-500',
  },
  {
    id: 'walmart', moduleKey: 'ecommerce_walmart', name: 'Walmart',
    description: 'Vende en Walmart Chile con sincronización automática de precios y stock.',
    href: '/dashboard/ecommerce/walmart',
    activeBorder: 'border-blue-500',
  },
];

const PLATFORM_TO_MARKETPLACE: Record<string, string> = {
  mercadolibre: 'MERCADO_LIBRE',
  shopify: 'SHOPIFY',
  woocommerce: 'WOOCOMMERCE',
  jumpseller: 'JUMPSELLER',
  falabella: 'FALABELLA',
  paris: 'PARIS',
  hites: 'HITES',
  ripley: 'RIPLEY',
  walmart: 'WALMART',
};

function hasModule(user: any, moduleKey: string): boolean {
  if (!user || user.role === 'SUPER_ADMIN') return true;
  const companyMods = user.company?.modules;
  if (companyMods && Array.isArray(companyMods) && !companyMods.includes(moduleKey)) return false;
  const userMods = user.modules;
  if (!userMods || !Array.isArray(userMods)) return true;
  return userMods.includes(moduleKey);
}

export default function EcommercePage() {
  const { selectedCompanyId } = useAdminCompany();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [customSettings, setCustomSettings] = useState<Record<string, any>>({});
  const [activeMarketplaces, setActiveMarketplaces] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const reserved = useReservedPlatforms();

  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';

  useEffect(() => {
    const token = getToken();
    const u = getUser();
    if (!token || !u) return;
    setCurrentUser(u);

    api.settings.platforms.list(token)
      .then((rows) => {
        const map: Record<string, any> = {};
        rows.forEach((r: any) => { map[r.platform] = r; });
        setCustomSettings(map);
      })
      .catch(() => {});

    // Sin esto, Super Admin veía como "activas" las conexiones de OTRAS empresas: las
    // llamadas no llevaban companyId y el backend no filtra nada por defecto para ese rol.
    const isSuper = u.role === 'SUPER_ADMIN';
    if (isSuper && !selectedCompanyId) { setActiveMarketplaces(new Set()); return; }
    const companyId = isSuper ? selectedCompanyId : undefined;

    Promise.all([
      api.connections.list(token, { companyId }).catch(() => [] as any[]),
      api.marketplace.connections(token, companyId).catch(() => [] as any[]),
    ]).then(([nonMl, ml]) => {
      const active = new Set<string>();
      (nonMl as any[])
        .filter((c: any) => c.active)
        .forEach((c: any) => { if (c.marketplace) active.add(c.marketplace as string); });
      if ((ml as any[]).some((c: any) => c.active && c.authorized)) active.add('MERCADO_LIBRE');
      setActiveMarketplaces(active);
    });
  }, [selectedCompanyId]);

  function openEdit(id: string) {
    setEditingId(id);
  }

  const platforms = DEFAULT_PLATFORMS.map((p) => {
    const c = customSettings[p.id];
    return {
      ...p,
      displayName: c?.displayName || p.name,
      displayDescription: c?.description || p.description,
      logoUrl: c?.logoUrl || null,
      logoScale: c?.logoScale || 100,
      logoScales: c?.logoScales || null,
    };
  });

  const visible = platforms.filter((p) => hasModule(currentUser, p.moduleKey));

  return (
    <div className="max-w-4xl">
      <div className="mb-3">
        <h1 className="ui-page-title mb-1">E-commerce</h1>
        <p className="ui-page-subtitle">
          Conecta y gestiona todos tus canales de venta online. El catálogo central sincroniza stock y precios en cada plataforma automáticamente.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visible.map((p) => {
          const isActive = activeMarketplaces.has(PLATFORM_TO_MARKETPLACE[p.id]);
          // Estado definido por el Super Admin en Sincronizadores.
          const st = connectorStatus(customSettings, p.id);
          if (!isSuperAdmin && st === 'DISABLED' && !isActive) return null;
          // Reservado: solo las empresas elegidas (quien ya lo tiene conectado lo sigue viendo).
          if (!connectorVisibleTo(customSettings, p.id, reserved) && !isActive) return null;
          const locked = !isSuperAdmin && st === 'SOON' && !isActive;
          return (
            <Link key={p.id} href={p.href} aria-disabled={locked} className={`block group ${locked ? 'pointer-events-none opacity-70' : ''}`}>
              <div className={`bg-white border-2 rounded-2xl p-5 transition-all hover:shadow-md relative ${
                isActive ? p.activeBorder : 'border-gray-200 hover:border-gray-300'
              }`}>
                {st !== 'AVAILABLE' && (
                  <span className={`absolute left-3 top-3 z-10 rounded-full px-2 py-0.5 text-[10px] font-semibold ${st === 'SOON' ? 'bg-[var(--brand)] text-white' : 'bg-gray-700 text-white'}`}>
                    {st === 'SOON' ? 'Próximamente' : 'Desactivado'}
                  </span>
                )}
                {isSuperAdmin && <VisibilityBadge map={customSettings} k={p.id} className="absolute right-12 top-3" />}

                {isSuperAdmin && (
                  <button
                    onClick={(e) => { e.preventDefault(); openEdit(p.id); }}
                    className="absolute top-3 right-3 w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 hover:text-gray-700 transition-colors z-10"
                    title="Editar plataforma"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                )}

                <div className="flex justify-center mb-4">
                  <div className={`w-24 h-16 rounded-lg overflow-hidden transition-all ${isActive ? '' : 'grayscale opacity-50'}`}>
                    {p.logoUrl
                      ? <img src={p.logoUrl} alt={p.displayName} className="w-full h-full object-contain" style={logoScaleStyle(viewScale(p, 'panel'))} />
                      : Logos[p.id]}
                  </div>
                </div>
                <h2 className="ui-section-title mb-1">{p.displayName}</h2>
                <p className="text-xs text-gray-500 leading-relaxed">{p.displayDescription}</p>
                <p className={`mt-3 text-xs font-semibold group-hover:underline ${
                  isActive ? 'text-green-600' : 'text-blue-600 group-hover:text-blue-700'
                }`}>
                  {isActive ? 'Gestionar →' : 'Conectar →'}
                </p>
              </div>
            </Link>
          );
        })}

        {visible.length === 0 && (
          <div className="col-span-3 text-center py-12 text-gray-400">
            <p className="text-sm">No tienes plataformas de e-commerce habilitadas.</p>
            <p className="text-xs mt-1">Contacta al administrador para activar los módulos.</p>
          </div>
        )}
      </div>

      {/* Edición de nombre, descripción, logo y visibilidad (solo Super Admin) */}
      {editingId && (
        <PlatformEditModal
          platform={editingId}
          defaultName={DEFAULT_PLATFORMS.find((p) => p.id === editingId)?.name || editingId}
          defaultDescription={DEFAULT_PLATFORMS.find((p) => p.id === editingId)?.description || ''}
          current={customSettings[editingId]}
          fallback={Logos[editingId]}
          onClose={() => setEditingId(null)}
          onSaved={(u) => { setCustomSettings((prev) => ({ ...prev, [u.platform]: u })); setEditingId(null); }}
        />
      )}
    </div>
  );
}

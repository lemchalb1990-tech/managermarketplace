'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { Logos } from './components/logos';

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

const emptyEdit = { displayName: '', description: '', logoUrl: '' };

export default function EcommercePage() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [customSettings, setCustomSettings] = useState<Record<string, any>>({});
  const [activeMarketplaces, setActiveMarketplaces] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(emptyEdit);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

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

    Promise.all([
      api.connections.list(token, {}).catch(() => [] as any[]),
      api.marketplace.connections(token).catch(() => [] as any[]),
    ]).then(([nonMl, ml]) => {
      const active = new Set<string>();
      (nonMl as any[])
        .filter((c: any) => c.active)
        .forEach((c: any) => { if (c.marketplace) active.add(c.marketplace as string); });
      if ((ml as any[]).length > 0) active.add('MERCADO_LIBRE');
      setActiveMarketplaces(active);
    });
  }, []);

  function openEdit(id: string) {
    const c = customSettings[id];
    setEditForm({
      displayName: c?.displayName || '',
      description: c?.description || '',
      logoUrl: c?.logoUrl || '',
    });
    setEditingId(id);
    setSaveError('');
  }

  async function handleSave() {
    if (!editingId) return;
    setSaving(true);
    setSaveError('');
    try {
      const token = getToken()!;
      const updated = await api.settings.platforms.update(editingId, {
        displayName: editForm.displayName.trim() || undefined,
        description: editForm.description.trim() || undefined,
        logoUrl: editForm.logoUrl.trim() || undefined,
      }, token);
      setCustomSettings((prev) => ({ ...prev, [editingId]: updated }));
      setEditingId(null);
    } catch (err: any) {
      setSaveError(err.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  const platforms = DEFAULT_PLATFORMS.map((p) => {
    const c = customSettings[p.id];
    return {
      ...p,
      displayName: c?.displayName || p.name,
      displayDescription: c?.description || p.description,
      logoUrl: c?.logoUrl || null,
    };
  });

  const visible = platforms.filter((p) => hasModule(currentUser, p.moduleKey));

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">E-commerce</h1>
        <p className="text-gray-500 text-sm">
          Conecta y gestiona todos tus canales de venta online. El catálogo central sincroniza stock y precios en cada plataforma automáticamente.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visible.map((p) => {
          const isActive = activeMarketplaces.has(PLATFORM_TO_MARKETPLACE[p.id]);
          return (
            <Link key={p.id} href={p.href} className="block group">
              <div className={`bg-white border-2 rounded-2xl p-5 transition-all hover:shadow-md relative ${
                isActive ? p.activeBorder : 'border-gray-200 hover:border-gray-300'
              }`}>

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

                <div className="flex items-start justify-between mb-4">
                  <div className="w-16 h-10 rounded-lg overflow-hidden">
                    {p.logoUrl
                      ? <img src={p.logoUrl} alt={p.displayName} className="w-full h-full object-contain" />
                      : Logos[p.id]}
                  </div>
                  {isActive && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                      Activo
                    </span>
                  )}
                </div>
                <h2 className="font-semibold text-gray-900 mb-1">{p.displayName}</h2>
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

      {/* Modal edición (solo Super Admin) */}
      {editingId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-900">
                Editar — {DEFAULT_PLATFORMS.find(p => p.id === editingId)?.name}
              </h2>
              <button onClick={() => setEditingId(null)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Nombre de la plataforma</label>
                <input
                  value={editForm.displayName}
                  onChange={(e) => setEditForm((f) => ({ ...f, displayName: e.target.value }))}
                  placeholder={DEFAULT_PLATFORMS.find(p => p.id === editingId)?.name}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1">Deja vacío para usar el nombre por defecto.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Descripción</label>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder={DEFAULT_PLATFORMS.find(p => p.id === editingId)?.description}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">URL del logo</label>
                <input
                  value={editForm.logoUrl}
                  onChange={(e) => setEditForm((f) => ({ ...f, logoUrl: e.target.value }))}
                  placeholder="https://ejemplo.com/logo.png"
                  type="url"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {editForm.logoUrl && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-gray-500">Vista previa:</span>
                    <img
                      src={editForm.logoUrl}
                      alt="preview"
                      className="w-16 h-10 object-contain rounded border border-gray-200"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>
                )}
                <p className="text-xs text-gray-400 mt-1">Deja vacío para usar el logo SVG por defecto.</p>
              </div>

              {saveError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveError}</p>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex gap-2 justify-end">
              <button onClick={() => setEditingId(null)}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
                {saving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

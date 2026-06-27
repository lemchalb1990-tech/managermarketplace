'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { BillingLogos } from './components/logos';

const PROVIDERS = [
  {
    id: 'openfactura', name: 'OpenFactura',
    description: 'Proveedor DTE de Haulmer. API REST con amplia documentación. Emisión de facturas, boletas y notas de crédito.',
    href: '/dashboard/billing/openfactura',
    activeColor: '#1A3C8F', activeBorder: 'border-blue-400',
  },
  {
    id: 'bsale', name: 'Bsale',
    description: 'Plataforma de ventas y facturación electrónica. Ideal para comercios con sistema POS integrado.',
    href: '/dashboard/billing/bsale',
    activeColor: '#FF6B00', activeBorder: 'border-orange-400',
  },
  {
    id: 'facto', name: 'Facto',
    description: 'Solución de facturación electrónica simple y rápida. Autorizada por el SII para emitir DTEs en Chile.',
    href: '/dashboard/billing/facto',
    activeColor: '#00B274', activeBorder: 'border-emerald-400',
  },
  {
    id: 'defontana', name: 'Defontana',
    description: 'ERP empresarial chileno con módulo de facturación electrónica. Para empresas con alta demanda operativa.',
    href: '/dashboard/billing/defontana',
    activeColor: '#1B2A4A', activeBorder: 'border-slate-500',
  },
  {
    id: 'nubox', name: 'Nubox',
    description: 'Software contable y de facturación para PYMES. Integración directa con el SII de Chile.',
    href: '/dashboard/billing/nubox',
    activeColor: '#0057B8', activeBorder: 'border-blue-500',
  },
  {
    id: 'siigo', name: 'Siigo',
    description: 'Software contable en la nube con facturación electrónica. API moderna y de fácil integración.',
    href: '/dashboard/billing/siigo',
    activeColor: '#6B21A8', activeBorder: 'border-purple-500',
  },
];

// Mapea provider ID del frontend al enum del backend
const PROVIDER_ENUM: Record<string, string> = {
  openfactura: 'OPENFACTURA',
  bsale: 'BSALE',
  facto: 'FACTO',
  defontana: 'DEFONTANA',
  nubox: 'NUBOX',
  siigo: 'SIIGO',
};

export default function BillingPage() {
  const [activeProviders, setActiveProviders] = useState<Set<string>>(new Set());

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api.billing.connections.list(token, {})
      .then((conns) => {
        const active = new Set(
          conns.filter((c: any) => c.active).map((c: any) => c.provider as string)
        );
        setActiveProviders(active);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="max-w-4xl">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Facturación Electrónica</h1>
          <p className="text-gray-500 text-sm">
            Conecta con tu proveedor DTE autorizado por el SII y emite facturas, boletas y notas de crédito directamente desde la plataforma.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/dashboard/billing/invoices"
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 whitespace-nowrap">
            Ver documentos
          </Link>
          <Link href="/dashboard/billing/invoices/new"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold whitespace-nowrap">
            + Emitir DTE
          </Link>
        </div>
      </div>

      <div className="mb-6 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
        <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-xs text-amber-700 leading-relaxed">
          Todos los proveedores son <strong>emisores electrónicos autorizados por el SII</strong>.
          Asegúrate de que tu empresa esté habilitada para facturación electrónica antes de conectar.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {PROVIDERS.map((p) => {
          const isActive = activeProviders.has(PROVIDER_ENUM[p.id]);
          return (
            <Link key={p.id} href={p.href} className="block group">
              <div className={`bg-white border-2 rounded-2xl p-5 transition-all hover:shadow-md ${
                isActive ? p.activeBorder : 'border-gray-200 hover:border-gray-300'
              }`}>
                <div className="flex items-start justify-between mb-4">
                  <div className="w-16 h-10 rounded-lg overflow-hidden">{BillingLogos[p.id]}</div>
                  {isActive && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                      Activado
                    </span>
                  )}
                </div>
                <h2 className="font-semibold text-gray-900 mb-1">{p.name}</h2>
                <p className="text-xs text-gray-500 leading-relaxed">{p.description}</p>
                <p className={`mt-3 text-xs font-semibold group-hover:underline ${
                  isActive ? 'text-green-600' : 'text-blue-600 group-hover:text-blue-700'
                }`}>
                  {isActive ? 'Gestionar conexión →' : 'Conectar →'}
                </p>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="mt-8 grid grid-cols-3 gap-4">
        {[
          { icon: '🧾', label: 'Tipos de DTE', desc: 'Facturas, boletas, NC, ND y facturas exentas' },
          { icon: '⚡', label: 'Emisión automática', desc: 'Genera DTE al cerrar ventas del POS o catálogo' },
          { icon: '📥', label: 'PDF y XML', desc: 'Descarga y envía documentos directamente al cliente' },
        ].map((item) => (
          <div key={item.label} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-2xl mb-2">{item.icon}</div>
            <p className="text-sm font-semibold text-gray-800">{item.label}</p>
            <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

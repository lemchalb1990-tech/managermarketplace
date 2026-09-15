'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { useAdminCompany } from '../../AdminCompanyContext';

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  PENDING:    { label: 'Pendiente',  color: 'bg-amber-100 text-amber-700' },
  PREPARING:  { label: 'Preparando', color: 'bg-blue-100 text-blue-700' },
  READY:      { label: 'Listo',      color: 'bg-indigo-100 text-indigo-700' },
  IN_TRANSIT: { label: 'En camino',  color: 'bg-yellow-100 text-yellow-700' },
  DELIVERED:  { label: 'Entregado',  color: 'bg-green-100 text-green-700' },
  CANCELLED:  { label: 'Cancelado',  color: 'bg-gray-100 text-gray-500' },
};

const CHANNEL_LABEL: Record<string, string> = {
  POS: 'POS', MERCADO_LIBRE: 'Mercado Libre', SHOPIFY: 'Shopify',
  WOOCOMMERCE: 'WooCommerce', JUMPSELLER: 'JumpSeller', FALABELLA: 'Falabella',
  PARIS: 'Paris', HITES: 'Hites', RIPLEY: 'Ripley', WALMART: 'Walmart', MANUAL: 'Manual',
};

const shortId = (id: string) => id.slice(-6).toUpperCase();

export default function EscanearVentaPage() {
  const router = useRouter();
  const { isSuperAdmin, selectedCompanyId } = useAdminCompany();
  const companyId = isSuperAdmin ? selectedCompanyId || undefined : undefined;

  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [matches, setMatches] = useState<any[]>([]);
  const [lastCode, setLastCode] = useState('');

  const [showManual, setShowManual] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [manualError, setManualError] = useState('');

  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);

  const handleSearch = useCallback(async (rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;
    const token = getToken();
    if (!token) return;
    setSearching(true);
    setError('');
    setMatches([]);
    setLastCode(code);
    try {
      const res = await api.orders.list(token, { search: code, companyId, page: 1 });
      if (res.total === 1) {
        router.push(`/dashboard/orders/${res.orders[0].id}`);
        return;
      }
      if (res.total === 0) {
        setError(`No se encontró ninguna venta con el código "${code}".`);
      } else {
        setMatches(res.orders);
      }
    } catch (err: any) {
      setError(err.message || 'Error al buscar la venta.');
    } finally {
      setSearching(false);
    }
  }, [companyId, router]);

  // Captura la lectura de una pistola de escaneo: emula tecleo rápido terminado en Enter.
  // Se desactiva mientras el modal de entrada manual está abierto o el foco está en un input,
  // para no duplicar la búsqueda ni interceptar el tecleo normal del usuario.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (showManual || tag === 'INPUT' || tag === 'TEXTAREA') return;

      const now = Date.now();
      if (now - lastKeyTimeRef.current > 300) bufferRef.current = '';
      lastKeyTimeRef.current = now;

      if (e.key === 'Enter') {
        const code = bufferRef.current;
        bufferRef.current = '';
        if (code.length >= 4) handleSearch(code);
        return;
      }
      if (e.key.length === 1) bufferRef.current += e.key;
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showManual, handleSearch]);

  function openManual() {
    setManualValue('');
    setManualError('');
    setShowManual(true);
  }

  async function submitManual() {
    const code = manualValue.trim();
    if (!/^[a-zA-Z0-9-]+$/.test(code)) {
      setManualError('Ingresa solo el número de envío o de venta.');
      return;
    }
    setShowManual(false);
    await handleSearch(code);
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <a href="/dashboard/orders" className="text-sm text-gray-400 hover:text-gray-600">Órdenes</a>
        <span className="text-gray-300">/</span>
        <span className="text-sm text-gray-600 font-medium">Escanear para buscar venta</span>
      </div>
      <h1 className="text-[1.375rem] font-bold text-gray-900 mb-6">Escanear para buscar venta</h1>

      <div className="bg-white rounded-2xl border border-gray-200 p-10 max-w-lg mx-auto text-center">
        <div className="relative w-48 h-32 mx-auto mb-5">
          <svg viewBox="0 0 192 128" className="w-full h-full">
            <path d="M8 30 V10 a4 4 0 0 1 4-4 H32" stroke="#c9b896" strokeWidth="3" fill="none" strokeLinecap="round" />
            <path d="M184 30 V10 a4 4 0 0 0-4-4 H160" stroke="#c9b896" strokeWidth="3" fill="none" strokeLinecap="round" />
            <path d="M8 98 V118 a4 4 0 0 0 4 4 H32" stroke="#c9b896" strokeWidth="3" fill="none" strokeLinecap="round" />
            <path d="M184 98 V118 a4 4 0 0 1-4 4 H160" stroke="#c9b896" strokeWidth="3" fill="none" strokeLinecap="round" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-12 h-12 text-gray-300" fill="currentColor">
              <path d="M4 4h2v16H4zM7 4h1v16H7zM9.5 4h2v16h-2zM13 4h1v16h-1zM15.5 4h1v16h-1zM18 4h2v16h-2z" />
            </svg>
          </div>
        </div>

        {searching ? (
          <p className="text-sm text-blue-600 font-medium flex items-center justify-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" /> Buscando "{lastCode}"...
          </p>
        ) : (
          <p className="text-sm text-green-600 font-medium flex items-center justify-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500" /> Listo para escanear
          </p>
        )}
        <p className="text-xs text-gray-400 mt-2 mb-4">
          Escanea la etiqueta con la pistola de escanear o ingresa el número de envío o de venta de manera manual
        </p>
        <button onClick={openManual} className="text-sm text-blue-600 hover:text-blue-700 font-medium">
          ✎ Entrada manual
        </button>

        {error && (
          <div className="mt-5 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      {matches.length > 0 && (
        <div className="max-w-lg mx-auto mt-4 bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          <p className="px-4 py-2 text-xs text-gray-500">{matches.length} ventas coinciden con "{lastCode}", elige una:</p>
          {matches.map((o) => {
            const cfg = STATUS_LABEL[o.status] ?? { label: o.status, color: 'bg-gray-100 text-gray-500' };
            return (
              <button key={o.id} onClick={() => router.push(`/dashboard/orders/${o.id}`)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50">
                <div>
                  <p className="font-mono text-xs font-bold text-gray-700">
                    #{o.sale && o.sale.channel !== 'POS' && o.sale.externalId ? o.sale.externalId : shortId(o.id)}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {o.customerName || 'Sin nombre'} · {o.sale ? (CHANNEL_LABEL[o.sale.channel] || o.sale.channel) : 'Manual'}
                  </p>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {showManual && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-900 text-base">Entrada manual</h2>
              <button onClick={() => setShowManual(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none w-8 h-8 flex items-center justify-center">×</button>
            </div>
            <div className="px-6 py-5 space-y-2">
              <label className="block text-sm text-gray-700">Ingresa el número de envío o de venta</label>
              <input
                autoFocus
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitManual(); }}
                placeholder="Ej: 46406313891"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              {manualError && <p className="text-xs text-red-600">{manualError}</p>}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={submitManual}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600">
                Buscar
              </button>
              <button onClick={() => setShowManual(false)}
                className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

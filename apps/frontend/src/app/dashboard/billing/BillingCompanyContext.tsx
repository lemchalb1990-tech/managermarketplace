'use client';

import { createContext, useContext, useEffect, useState, Fragment, ReactNode } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';

// Selección de empresa compartida por todo el módulo de facturación. Para el Super Admin
// funciona igual que en Catálogo o Inicio: primero elige la empresa y recién ahí se
// muestra el contenido. La elección se guarda para no tener que repetirla al navegar
// entre las subpáginas (proveedores, documentos, perfil, etc.).
const STORAGE_KEY = 'mp_billing_company';

interface BillingCompanyCtx {
  isSuperAdmin: boolean;
  // companyId a pasar en las llamadas API (undefined para usuarios de una sola empresa)
  companyId: string | undefined;
  selectedCompanyId: string;
}

const Ctx = createContext<BillingCompanyCtx | null>(null);

export function useBillingCompany(): BillingCompanyCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useBillingCompany debe usarse dentro de <BillingCompanyProvider>');
  return ctx;
}

export function BillingCompanyProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [ready, setReady] = useState(false);
  const [companies, setCompanies] = useState<any[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');

  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';

  function selectCompany(id: string) {
    setSelectedCompanyId(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }

  useEffect(() => {
    const u = getUser();
    setCurrentUser(u);
    const token = getToken();
    if (token && u?.role === 'SUPER_ADMIN') {
      let stored = '';
      try { stored = localStorage.getItem(STORAGE_KEY) || ''; } catch {}
      api.companies.list(token)
        .then((comps) => {
          setCompanies(comps);
          if (stored && comps.some((c: any) => c.id === stored)) setSelectedCompanyId(stored);
        })
        .catch(() => {})
        .finally(() => setReady(true));
    } else {
      setReady(true);
    }
  }, []);

  const value: BillingCompanyCtx = {
    isSuperAdmin,
    companyId: isSuperAdmin ? (selectedCompanyId || undefined) : undefined,
    selectedCompanyId,
  };

  return (
    <Ctx.Provider value={value}>
      {isSuperAdmin && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
          <label className="block text-xs font-semibold text-blue-700 mb-1">Empresa a gestionar</label>
          <select
            value={selectedCompanyId}
            onChange={(e) => selectCompany(e.target.value)}
            className="w-full sm:w-96 px-3 py-2 border border-blue-300 rounded-lg text-sm bg-white"
          >
            <option value="">— Selecciona una empresa —</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      {!ready ? null : isSuperAdmin && !selectedCompanyId ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 px-4 py-16 text-center text-gray-400">
          <p className="text-3xl mb-2">🏢</p>
          <p className="text-sm">Selecciona una empresa para gestionar su facturación.</p>
        </div>
      ) : (
        // key => al cambiar de empresa se reinicia el estado de la subpágina activa
        <Fragment key={selectedCompanyId || 'self'}>{children}</Fragment>
      )}
    </Ctx.Provider>
  );
}

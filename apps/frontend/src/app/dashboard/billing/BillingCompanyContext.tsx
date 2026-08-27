'use client';

import { createContext, useContext, useEffect, useState, Fragment, ReactNode } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';

// Selección de empresa compartida por todo el módulo de facturación. Para el Super Admin
// funciona igual que en Catálogo o Inicio: al entrar aparece un modal que obliga a elegir
// la empresa y recién ahí se muestra el contenido. Todo lo que se ve dentro del módulo
// (documentos, DTE, clientes, proveedores, perfil) queda filtrado por esa empresa y no se
// mezcla con las demás. La elección se guarda para no repetirla al navegar entre subpáginas.
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftCompanyId, setDraftCompanyId] = useState('');

  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const selectedCompany = companies.find((c) => c.id === selectedCompanyId);

  function commitCompany(id: string) {
    setSelectedCompanyId(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setPickerOpen(false);
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

  // Usuario de una sola empresa: sin cambios, se muestra el contenido directamente.
  if (!isSuperAdmin) {
    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
  }

  const mustChoose = ready && !selectedCompanyId;
  const showModal = mustChoose || pickerOpen;

  function openPicker() {
    setDraftCompanyId(selectedCompanyId);
    setPickerOpen(true);
  }

  return (
    <Ctx.Provider value={value}>
      {selectedCompanyId && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 mb-6">
          <p className="text-sm text-blue-900">
            Gestionando la facturación de <strong>{selectedCompany?.name ?? 'la empresa seleccionada'}</strong>
          </p>
          <button
            onClick={openPicker}
            className="text-xs font-semibold text-blue-700 hover:text-blue-900 underline underline-offset-2"
          >
            Cambiar empresa
          </button>
        </div>
      )}

      {ready && selectedCompanyId && (
        // key => al cambiar de empresa se reinicia el estado de la subpágina activa
        <Fragment key={selectedCompanyId}>{children}</Fragment>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-900">Selecciona una empresa</h2>
              {!mustChoose && (
                <button onClick={() => setPickerOpen(false)}
                  className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
              )}
            </div>
            <div className="px-6 py-5 space-y-3">
              <p className="text-sm text-gray-500">
                El módulo de facturación —documentos, emisión de DTE, clientes y proveedores— se
                gestiona por empresa. Elige con cuál vas a trabajar.
              </p>
              <select
                autoFocus
                value={draftCompanyId}
                onChange={(e) => setDraftCompanyId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
              >
                <option value="">— Selecciona una empresa —</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              {!mustChoose && (
                <button onClick={() => setPickerOpen(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                  Cancelar
                </button>
              )}
              <button
                onClick={() => commitCompany(draftCompanyId)}
                disabled={!draftCompanyId}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold"
              >
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

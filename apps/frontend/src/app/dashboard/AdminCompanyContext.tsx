'use client';

import { createContext, useContext, useEffect, useState, Fragment, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';

// Selección de empresa única para todo el panel del Super Admin: se elige una vez (modal
// bloqueante) y esa misma empresa aplica en Catálogo, POS, Ventas, Compras, Mercado Libre,
// Facturación, etc. — ya no cada módulo pide su propia empresa por separado. El resto de
// los usuarios ya está acotado a la suya por el backend y no ve nada de esto.
const STORAGE_KEY = 'mp_admin_company';

// Vistas de administración global que no pertenecen a una empresa en particular (acá se
// gestionan las empresas mismas, los usuarios, las conexiones globales, etc.) — no tiene
// sentido bloquearlas pidiendo elegir una empresa primero.
const EXEMPT_PREFIXES = [
  '/dashboard/companies',
  '/dashboard/users',
  '/dashboard/access-profiles',
  '/dashboard/connections',
  '/dashboard/emails',
  '/dashboard/settings',
];

interface AdminCompanyCtx {
  isSuperAdmin: boolean;
  // companyId a pasar en las llamadas API (undefined para usuarios de una sola empresa,
  // o en las vistas exentas de la lista de arriba)
  companyId: string | undefined;
  selectedCompanyId: string;
  companies: any[];
}

const Ctx = createContext<AdminCompanyCtx | null>(null);

export function useAdminCompany(): AdminCompanyCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAdminCompany debe usarse dentro de <AdminCompanyProvider>');
  return ctx;
}

export function AdminCompanyProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [ready, setReady] = useState(false);
  const [companies, setCompanies] = useState<any[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftCompanyId, setDraftCompanyId] = useState('');

  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const isExempt = EXEMPT_PREFIXES.some((p) => pathname?.startsWith(p));
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

  const value: AdminCompanyCtx = {
    isSuperAdmin,
    companyId: isSuperAdmin && !isExempt ? (selectedCompanyId || undefined) : undefined,
    selectedCompanyId,
    companies,
  };

  // Usuario de una sola empresa, o vista exenta (administración global): sin selector, se
  // muestra el contenido directamente.
  if (!isSuperAdmin || isExempt) {
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
            Gestionando <strong>{selectedCompany?.name ?? 'la empresa seleccionada'}</strong>
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
        // key => al cambiar de empresa se reinicia el estado de la página activa
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
                El panel se gestiona por empresa. Elige con cuál vas a trabajar — aplica en
                Catálogo, POS, Ventas, Compras, Mercado Libre, Facturación y el resto de los
                módulos.
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

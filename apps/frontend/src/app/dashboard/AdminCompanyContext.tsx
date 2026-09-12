'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';

// Selección de empresa única para todo el panel del Super Admin: se elige una vez (modal
// bloqueante, ver CompanyGate) y esa misma empresa aplica en Catálogo, POS, Ventas,
// Compras, Mercado Libre, Facturación, etc. — ya no cada módulo pide su propia empresa
// por separado. El resto de los usuarios ya está acotado a la suya por el backend.
const STORAGE_KEY = 'mp_admin_company';

interface AdminCompanyCtx {
  isSuperAdmin: boolean;
  ready: boolean;
  // companyId a pasar en las llamadas API (undefined para usuarios de una sola empresa)
  companyId: string | undefined;
  selectedCompanyId: string;
  companies: any[];
  selectCompany: (id: string) => void;
}

const Ctx = createContext<AdminCompanyCtx | null>(null);

export function useAdminCompany(): AdminCompanyCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAdminCompany debe usarse dentro de <AdminCompanyProvider>');
  return ctx;
}

// Solo provee el contexto (empresa activa) — no bloquea ni oculta nada, para que el
// sidebar, el header y la campanita de notificaciones estén siempre disponibles aunque
// el Super Admin todavía no haya elegido empresa. El bloqueo real vive en <CompanyGate>,
// envolviendo solo el contenido de cada página.
export function AdminCompanyProvider({ children }: { children: ReactNode }) {
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

  const value: AdminCompanyCtx = {
    isSuperAdmin,
    ready,
    companyId: isSuperAdmin ? (selectedCompanyId || undefined) : undefined,
    selectedCompanyId,
    companies,
    selectCompany,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

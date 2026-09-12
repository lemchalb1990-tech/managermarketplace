'use client';

// La empresa activa ahora es una sola para todo el panel (ver AdminCompanyContext, provisto
// una vez en dashboard/layout.tsx) — este archivo queda como alias de compatibilidad para no
// tocar cada página del módulo de Mercado Libre que ya importaba useMlCompany.
import type { ReactNode } from 'react';
import { useAdminCompany } from '../AdminCompanyContext';

export const useMlCompany = useAdminCompany;

export function MlCompanyProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

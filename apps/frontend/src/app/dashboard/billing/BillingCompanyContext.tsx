'use client';

// La empresa activa ahora es una sola para todo el panel (ver AdminCompanyContext, provisto
// una vez en dashboard/layout.tsx) — este archivo queda como alias de compatibilidad para no
// tocar cada página de Facturación que ya importaba useBillingCompany.
import type { ReactNode } from 'react';
import { useAdminCompany } from '../AdminCompanyContext';

export const useBillingCompany = useAdminCompany;

export function BillingCompanyProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

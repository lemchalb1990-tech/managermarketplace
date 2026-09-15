'use client';

import { useState, useEffect, Fragment, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useAdminCompany } from './AdminCompanyContext';

// Vistas de administración global que no pertenecen a una empresa en particular (acá se
// gestionan las empresas mismas, los usuarios, las conexiones globales, etc.) — no tiene
// sentido bloquearlas pidiendo elegir una empresa primero.
const EXEMPT_PREFIXES = [
  '/dashboard/companies',
  '/dashboard/users',
  '/dashboard/access-profiles',
  '/dashboard/connections',
  '/dashboard/mercadolibre/registros-sin-conexion',
  '/dashboard/emails',
  '/dashboard/settings',
];

// Bloquea el contenido de la página (no el sidebar/header, que siguen visibles) hasta que
// el Super Admin elija una empresa. El resto de los usuarios pasa directo.
export function CompanyGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { isSuperAdmin, ready, selectedCompanyId, companies, selectCompany, pickerOpen, openPicker, closePicker } = useAdminCompany();
  const [draftCompanyId, setDraftCompanyId] = useState('');

  const isExempt = EXEMPT_PREFIXES.some((p) => pathname?.startsWith(p));
  // El home del dashboard dibuja su propio selector de empresa junto al título
  // (para no gastar una fila entera arriba solo para el chip) — acá no se duplica.
  const rendersOwnChip = pathname === '/dashboard';
  const selectedCompany = companies.find((c) => c.id === selectedCompanyId);
  const mustChoose = ready && !selectedCompanyId;
  const showModal = mustChoose || pickerOpen;

  // Sincroniza el borrador con la empresa activa cada vez que el modal se abre — sin
  // importar si lo disparó este banner o el título de otra página (p.ej. Catálogo).
  // Tiene que llamarse SIEMPRE, antes del return condicional de abajo — un hook detrás de
  // un early return rompe las Rules of Hooks (React error #310) en cuanto isSuperAdmin
  // cambia entre renders.
  useEffect(() => {
    if (showModal) setDraftCompanyId(selectedCompanyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModal]);

  if (!isSuperAdmin || isExempt) {
    return <>{children}</>;
  }

  function commit(id: string) {
    selectCompany(id);
    closePicker();
  }

  return (
    <>
      {selectedCompanyId && !rendersOwnChip && (
        // Chip compacto (no un banner de fila completa) para no restar espacio vertical —
        // mismo estilo en todas las vistas gestionadas por empresa.
        <div className="flex justify-end mb-3">
          <button
            onClick={openPicker}
            title="Cambiar empresa"
            className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-900 text-xs font-medium hover:bg-blue-100 max-w-full truncate"
          >
            Gestionando <strong className="truncate">{selectedCompany?.name ?? 'empresa'}</strong>
            <span className="text-blue-500">▾</span>
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
                <button onClick={closePicker}
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
                <button onClick={closePicker}
                  className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                  Cancelar
                </button>
              )}
              <button
                onClick={() => commit(draftCompanyId)}
                disabled={!draftCompanyId}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold"
              >
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

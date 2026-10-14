'use client';

import { useCallback, useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api, imgUrl } from '@/lib/api';
import { useAdminCompany } from '../AdminCompanyContext';
import { PRINT_FORMAT_LABEL, type PrintFormat } from '@/app/imprimir/printLayout';
import CompanyDataModal from './CompanyDataModal';
import TicketFormatModal, { FORMAT_HELP } from './TicketFormatModal';

type Open = 'empresa' | 'ticket' | null;

// Configuración propia de la empresa (la edita su administrador o el Super Admin con la
// empresa seleccionada): datos de la empresa y formato de ticket, cada uno en su modal.
// ?abrir=empresa | ?abrir=ticket abre el modal directo (enlaces y rutas antiguas).
export default function CompanySection() {
  const { isSuperAdmin, selectedCompanyId, companyId, companies, openPicker } = useAdminCompany();
  const [profile, setProfile] = useState<any>(null);
  const [format, setFormat] = useState<PrintFormat | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState('');

  const noCompany = isSuperAdmin && !selectedCompanyId;

  const load = useCallback(async () => {
    const token = getToken();
    if (!token || noCompany) { setLoading(false); return; }
    setLoading(true);
    const [p, s] = await Promise.all([
      api.billing.profile.get(token, companyId).catch(() => null),
      api.pos.settings.get(token, companyId).catch(() => null),
    ]);
    setProfile(p);
    setFormat(s?.workOrderPrintFormat ?? null);
    setLoading(false);
  }, [companyId, noCompany]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('abrir');
    if (q === 'empresa' || q === 'ticket') setOpen(q);
  }, []);

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(''), 3000);
  }

  const companyLabel = isSuperAdmin ? companies.find((c: any) => c.id === selectedCompanyId)?.name : null;
  const address = [profile?.address, profile?.commune, profile?.city].filter(Boolean).join(', ');

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden mb-6">
      <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
        <h2 className="ui-section-title">Empresa{companyLabel ? ` · ${companyLabel}` : ''}</h2>
        <p className="text-xs text-gray-400 mt-0.5">Datos que salen en tickets, órdenes y documentos, y el formato de impresión. Cada empresa tiene los suyos.</p>
      </div>

      {noCompany ? (
        <div className="px-5 py-4 text-sm text-gray-500">
          Selecciona una empresa para editar sus datos.{' '}
          <button type="button" onClick={openPicker} className="text-blue-600 hover:underline">Elegir empresa</button>
        </div>
      ) : loading ? (
        <div className="px-5 py-4 text-sm text-gray-400">Cargando…</div>
      ) : (
        <div className="divide-y divide-gray-50">
          <div className="px-5 py-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden shrink-0">
              {profile?.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imgUrl(profile.logoUrl)} alt="Logo" className="w-full h-full object-contain" />
              ) : (
                <span className="text-gray-300 text-[10px]">Sin logo</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-800">Datos de la empresa</p>
              <p className="text-xs text-gray-500 truncate">
                {[profile?.companyName, profile?.rut ? `RUT ${profile.rut}` : null].filter(Boolean).join(' · ') || 'Sin completar'}
              </p>
              {address && <p className="text-xs text-gray-400 truncate">{address}</p>}
            </div>
            <button type="button" onClick={() => setOpen('empresa')}
              className="px-3 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-50 shrink-0">
              Editar
            </button>
          </div>

          <div className="px-5 py-4 flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-800">Configuración de ticket</p>
              <p className="text-xs text-gray-500">
                {format ? `${PRINT_FORMAT_LABEL[format]} — ${FORMAT_HELP[format]}` : 'Sin configurar'}
              </p>
            </div>
            <button type="button" onClick={() => setOpen('ticket')} disabled={!format}
              className="px-3 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 shrink-0">
              Cambiar
            </button>
          </div>

          {notice && <p className="px-5 py-2 text-xs text-green-600">{notice}</p>}
        </div>
      )}

      {open === 'empresa' && !noCompany && !loading && (
        <CompanyDataModal
          profile={profile}
          companyId={companyId}
          // El logo se guarda al subirlo: al cerrar sin guardar igual se recarga.
          onClose={() => { setOpen(null); load(); }}
          onSaved={(p) => { setProfile(p); setOpen(null); flash('Datos de la empresa guardados.'); }}
        />
      )}
      {open === 'ticket' && format && (
        <TicketFormatModal
          current={format}
          companyId={companyId}
          onClose={() => setOpen(null)}
          onSaved={(f) => { setFormat(f); setOpen(null); flash('Formato de ticket guardado.'); }}
        />
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { useAdminCompany } from '../../AdminCompanyContext';
import { PRINT_FORMAT_LABEL, type PrintFormat } from '@/app/imprimir/printLayout';

const FORMAT_HELP: Record<PrintFormat, string> = {
  CARTA: 'Hoja completa con firmas, para impresora normal.',
  TICKET: 'Rollo de 80 mm, impresora térmica estándar.',
  TICKET_58: 'Rollo de 58 mm, impresora térmica angosta.',
};

// Configuración de ticket del usuario: el formato queda predeterminado y ya no se elige en
// cada venta directa u orden de trabajo.
export default function TicketSettingsPage() {
  const { selectedCompanyId } = useAdminCompany();
  const [token, setToken] = useState('');
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [companyFormat, setCompanyFormat] = useState<PrintFormat | null>(null);
  // '' = usar el predeterminado de la empresa.
  const [userFormat, setUserFormat] = useState<PrintFormat | ''>('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    setToken(getToken() || '');
    setIsSuperAdmin(getUser()?.role === 'SUPER_ADMIN');
  }, []);

  useEffect(() => {
    if (!token) return;
    if (isSuperAdmin && !selectedCompanyId) return;
    api.pos.settings.get(token, isSuperAdmin ? selectedCompanyId : undefined)
      .then((s) => {
        setCompanyFormat(s.workOrderPrintFormat);
        setUserFormat(s.userPrintFormat ?? '');
        setLoaded(true);
      })
      .catch((e) => { setMsg(e.message || 'No se pudo cargar la configuración.'); setIsError(true); });
  }, [token, isSuperAdmin, selectedCompanyId]);

  async function save(value: PrintFormat | '') {
    const prev = userFormat;
    setUserFormat(value);
    setSaving(true);
    setMsg('');
    try {
      await api.pos.settings.updateMyTicketFormat(value || null, token);
      setMsg('Guardado. Se usará en tus próximas impresiones.');
      setIsError(false);
    } catch (e: any) {
      setUserFormat(prev);
      setMsg(e.message || 'No se pudo guardar.');
      setIsError(true);
    } finally {
      setSaving(false);
    }
  }

  const options: { value: PrintFormat | ''; label: string; help: string }[] = [
    {
      value: '',
      label: companyFormat ? `Usar el de la empresa (${PRINT_FORMAT_LABEL[companyFormat]})` : 'Usar el de la empresa',
      help: 'Sigue el formato que definió el administrador.',
    },
    ...(Object.keys(PRINT_FORMAT_LABEL) as PrintFormat[]).map((f) => ({ value: f, label: PRINT_FORMAT_LABEL[f], help: FORMAT_HELP[f] })),
  ];

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="ui-page-title">Configuración de ticket</h1>
        <p className="ui-page-subtitle">
          Elige una vez el formato de impresión de tus comprobantes de venta y órdenes de trabajo. Queda predeterminado: no se pregunta en cada venta.
        </p>
      </div>

      {isSuperAdmin && !selectedCompanyId ? (
        <p className="text-sm text-gray-500">Selecciona una empresa para ver la configuración.</p>
      ) : !loaded ? (
        msg ? null : <p className="text-sm text-gray-400">Cargando…</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
          {options.map((o) => (
            <label key={o.value || 'empresa'} className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50">
              <input
                type="radio"
                name="ticketFormat"
                checked={userFormat === o.value}
                disabled={saving}
                onChange={() => save(o.value)}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium text-gray-800">{o.label}</span>
                <span className="block text-xs text-gray-500">{o.help}</span>
              </span>
            </label>
          ))}
        </div>
      )}

      {msg && <p className={`text-xs ${isError ? 'text-red-600' : 'text-green-600'}`}>{msg}</p>}
    </div>
  );
}

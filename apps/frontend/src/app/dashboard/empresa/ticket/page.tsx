'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { useAdminCompany } from '../../AdminCompanyContext';
import { PRINT_FORMAT_LABEL, type PrintFormat } from '@/app/imprimir/printLayout';

const FORMAT_HELP: Record<PrintFormat, string> = {
  CARTA: 'Hoja completa con firmas, para impresora normal.',
  TICKET: 'Rollo de 80 mm, impresora térmica estándar.',
  TICKET_58: 'Rollo de 58 mm, impresora térmica angosta.',
};

// Configuración de ticket de la empresa: el formato se guarda en la empresa (cada empresa
// el suyo) y lo usan todos sus usuarios al imprimir ventas directas y órdenes de trabajo.
export default function TicketSettingsPage() {
  const { isSuperAdmin, selectedCompanyId, companyId } = useAdminCompany();
  const [token, setToken] = useState('');
  const [format, setFormat] = useState<PrintFormat | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [isError, setIsError] = useState(false);

  useEffect(() => { setToken(getToken() || ''); }, []);

  useEffect(() => {
    if (!token) return;
    if (isSuperAdmin && !selectedCompanyId) return;
    setFormat(null);
    setMsg('');
    api.pos.settings.get(token, companyId)
      .then((s) => setFormat(s.workOrderPrintFormat))
      .catch((e) => { setMsg(e.message || 'No se pudo cargar la configuración.'); setIsError(true); });
  }, [token, isSuperAdmin, selectedCompanyId, companyId]);

  async function save(value: PrintFormat) {
    const prev = format;
    setFormat(value);
    setSaving(true);
    setMsg('');
    try {
      await api.pos.settings.update({ workOrderPrintFormat: value }, token, companyId);
      setMsg('Guardado. Todos los usuarios de la empresa imprimirán con este formato.');
      setIsError(false);
    } catch (e: any) {
      setFormat(prev);
      setMsg(e.message || 'No se pudo guardar.');
      setIsError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="ui-page-title">Configuración de ticket</h1>
        <p className="ui-page-subtitle">
          Formato de impresión de los comprobantes de venta y órdenes de trabajo de esta empresa. Aplica a todos sus usuarios; no se pregunta en cada venta.
        </p>
      </div>

      {isSuperAdmin && !selectedCompanyId ? (
        <p className="text-sm text-gray-500">Selecciona una empresa para ver la configuración.</p>
      ) : !format ? (
        msg ? null : <p className="text-sm text-gray-400">Cargando…</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
          {(Object.keys(PRINT_FORMAT_LABEL) as PrintFormat[]).map((f) => (
            <label key={f} className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50">
              <input
                type="radio"
                name="ticketFormat"
                checked={format === f}
                disabled={saving}
                onChange={() => save(f)}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium text-gray-800">{PRINT_FORMAT_LABEL[f]}</span>
                <span className="block text-xs text-gray-500">{FORMAT_HELP[f]}</span>
              </span>
            </label>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-500">
        El logo, nombre, RUT y dirección que salen en el ticket se editan en{' '}
        <a href="/dashboard/empresa" className="text-blue-600 hover:underline">Datos de la empresa</a>.
      </p>

      {msg && <p className={`text-xs ${isError ? 'text-red-600' : 'text-green-600'}`}>{msg}</p>}
    </div>
  );
}

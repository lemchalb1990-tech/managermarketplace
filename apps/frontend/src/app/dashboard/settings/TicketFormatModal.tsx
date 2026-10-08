'use client';

import { useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { Modal, btnPrimary, btnSecondary, FormError } from '@/components/ui/Modal';
import { PRINT_FORMAT_LABEL, type PrintFormat } from '@/app/imprimir/printLayout';

export const FORMAT_HELP: Record<PrintFormat, string> = {
  CARTA: 'Hoja completa con firmas, para impresora normal.',
  TICKET: 'Rollo de 80 mm, impresora térmica estándar.',
  TICKET_58: 'Rollo de 58 mm, impresora térmica angosta.',
};

// Formato de ticket de la empresa: se guarda en la empresa (cada empresa el suyo) y lo usan
// todos sus usuarios al imprimir ventas directas y órdenes de trabajo.
export default function TicketFormatModal({ current, companyId, onClose, onSaved }: {
  current: PrintFormat;
  companyId?: string;
  onClose: () => void;
  onSaved: (format: PrintFormat) => void;
}) {
  const [format, setFormat] = useState<PrintFormat>(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.pos.settings.update({ workOrderPrintFormat: format }, getToken()!, companyId);
      onSaved(format);
    } catch (err: any) {
      setError(err.message || 'No se pudo guardar.');
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Configuración de ticket"
      subtitle="Formato de impresión de los comprobantes de venta y órdenes de trabajo. Aplica a todos los usuarios de la empresa."
      busy={saving}
      onClose={onClose}
      onSubmit={handleSave}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={saving} className={btnSecondary}>Cancelar</button>
          <button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Guardando...' : 'Guardar'}</button>
        </>
      )}
    >
      <div className="space-y-3">
        <div className="border border-gray-200 rounded-xl divide-y divide-gray-100">
          {(Object.keys(PRINT_FORMAT_LABEL) as PrintFormat[]).map((f) => (
            <label key={f} className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 ${format === f ? 'bg-blue-50/50' : ''}`}>
              <input type="radio" name="ticketFormat" checked={format === f} disabled={saving}
                onChange={() => setFormat(f)} className="mt-1" />
              <span>
                <span className="block text-sm font-medium text-gray-800">{PRINT_FORMAT_LABEL[f]}</span>
                <span className="block text-xs text-gray-500">{FORMAT_HELP[f]}</span>
              </span>
            </label>
          ))}
        </div>
        <FormError message={error} />
      </div>
    </Modal>
  );
}

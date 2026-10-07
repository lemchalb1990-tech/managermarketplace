'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clearSession, getToken } from '@/lib/auth';
import { api, apiDownload } from '@/lib/api';
import { SkeletonForm } from '@/components/Skeleton';

// Zona de peligro del administrador de la empresa: descargar un respaldo y dar de baja la
// cuenta. La baja bloquea el acceso de inmediato y borra todos los datos a los 30 días.
export default function AccountClosureSection() {
  const router = useRouter();
  const [status, setStatus] = useState<any>(undefined);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ companyName: '', password: '', reason: '', understood: false });
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (token) api.companyAccount.closureStatus(token).then(setStatus).catch(() => setStatus(null));
  }, []);

  async function download() {
    setDownloading(true);
    try {
      await apiDownload('/company-account/export', getToken()!, `respaldo-${status?.name || 'empresa'}.zip`);
      setDownloaded(true);
    } catch (e: any) {
      setError(e.message || 'No se pudo generar el respaldo');
    } finally {
      setDownloading(false);
    }
  }

  async function submit() {
    setError('');
    setSending(true);
    try {
      const res = await api.companyAccount.requestClosure({ companyName: form.companyName, password: form.password, reason: form.reason || undefined }, getToken()!);
      const date = new Date(res.scheduledFor).toLocaleDateString('es-CL');
      clearSession();
      router.replace(`/login?closed=${encodeURIComponent(date)}`);
    } catch (e: any) {
      setError(e.message || 'No se pudo dar de baja la cuenta');
      setSending(false);
    }
  }

  if (status === undefined) return <div className="ui-card p-5"><SkeletonForm fields={2} columns={1} /></div>;
  if (!status) return null;
  const canSubmit = form.understood && form.companyName.trim().toLowerCase() === status.name.trim().toLowerCase() && form.password;

  return (
    <div className="mt-8 border border-red-200 rounded-2xl bg-white">
      <div className="px-5 py-4 border-b border-red-100">
        <h2 className="ui-section-title text-red-700">Dar de baja la cuenta</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Cierra la cuenta de <b>{status.name}</b> y elimina todos sus datos: productos, ventas, órdenes, clientes, documentos, finanzas, usuarios y conexiones.
        </p>
      </div>
      <div className="px-5 py-4 space-y-4 text-sm">
        <div>
          <p className="font-medium text-gray-800">1. Descarga un respaldo</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Un ZIP con un Excel de todos tus datos y los PDF/XML de las boletas y facturas emitidas. Por ley debes conservar los documentos tributarios 6 años.
          </p>
          <button onClick={download} disabled={downloading}
            className="mt-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {downloading ? 'Generando respaldo...' : downloaded ? '✓ Respaldo descargado — descargar de nuevo' : 'Descargar respaldo'}
          </button>
        </div>
        <div>
          <p className="font-medium text-gray-800">2. Solicita la baja</p>
          <p className="text-xs text-gray-500 mt-0.5">
            La cuenta se bloquea de inmediato para todos los usuarios de la empresa y se detienen las sincronizaciones con los marketplaces.
            Los datos se eliminan definitivamente en {status.graceDays} días; hasta entonces, soporte puede revertirla si fue un error.
          </p>
          <button onClick={() => { setOpen(true); setError(''); }}
            className="mt-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold">
            Dar de baja la cuenta
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-3">
            <h3 className="font-semibold text-red-700">¿Dar de baja {status.name}?</h3>
            <p className="text-xs text-gray-600">
              Nadie de la empresa podrá volver a entrar y, en {status.graceDays} días, se borrarán todos los datos sin posibilidad de recuperarlos.
              {!downloaded && <b className="block mt-1 text-amber-700">Todavía no descargas el respaldo.</b>}
            </p>
            <div>
              <label className="text-xs text-gray-500">Escribe el nombre de la empresa: <b>{status.name}</b></label>
              <input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm mt-1" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Tu contraseña</label>
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm mt-1" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Motivo (opcional)</label>
              <textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={2}
                className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm mt-1" />
            </div>
            <label className="flex items-start gap-2 text-xs text-gray-700">
              <input type="checkbox" checked={form.understood} onChange={(e) => setForm({ ...form, understood: e.target.checked })} className="mt-0.5" />
              Entiendo que todos los datos de la empresa se eliminarán definitivamente en {status.graceDays} días.
            </label>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setOpen(false)} disabled={sending} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">Cancelar</button>
              <button onClick={submit} disabled={!canSubmit || sending}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold disabled:opacity-40">
                {sending ? 'Procesando...' : 'Dar de baja definitivamente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

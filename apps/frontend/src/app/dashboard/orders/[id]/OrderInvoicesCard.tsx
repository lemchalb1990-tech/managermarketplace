'use client';

import { useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';

const DTE_LABEL: Record<string, string> = {
  FACTURA: 'Factura', BOLETA: 'Boleta', NOTA_CREDITO: 'Nota de crédito', NOTA_DEBITO: 'Nota de débito', FACTURA_EXENTA: 'Factura exenta',
};

const STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT:     { label: 'Borrador', cls: 'bg-gray-100 text-gray-500' },
  ISSUED:    { label: 'Emitida',  cls: 'bg-green-100 text-green-700' },
  ACCEPTED:  { label: 'Aceptada', cls: 'bg-green-100 text-green-700' },
  REJECTED:  { label: 'Rechazada', cls: 'bg-red-100 text-red-700' },
  CANCELLED: { label: 'Anulada',  cls: 'bg-gray-100 text-gray-500' },
};

// Plataformas a las que el sistema puede adjuntar el documento en la orden del marketplace.
const PUSH_MARKETPLACES: Record<string, string> = { FALABELLA: 'Falabella', RIPLEY: 'Ripley' };

// Boletas/facturas emitidas para la venta de la orden: ver el PDF, reenviarlas por correo o
// volver a adjuntarlas a la orden del marketplace (Falabella/Ripley).
export default function OrderInvoicesCard({ invoices, marketplace, canManage, fmtDateTime, onChanged }: {
  invoices: any[];
  marketplace?: string | null;
  canManage: boolean;
  fmtDateTime: (d: string) => string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [emailFor, setEmailFor] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const pushLabel = marketplace ? PUSH_MARKETPLACES[marketplace] : undefined;

  const run = async (id: string, key: string, fn: (token: string) => Promise<string>) => {
    setBusy(`${id}:${key}`);
    setMessage(null);
    try {
      const text = await fn(getToken()!);
      setMessage({ id, ok: true, text });
    } catch (err: any) {
      setMessage({ id, ok: false, text: err.message || 'No se pudo completar la acción' });
    } finally {
      setBusy(null);
    }
  };

  // La ventana se abre antes de pedir el documento: si se abre después del await, el
  // navegador la trata como popup no solicitado y la bloquea.
  const viewPdf = (id: string) => {
    const win = window.open('', '_blank');
    run(id, 'pdf', async (token) => {
      try {
        const inv = await api.billing.invoices.get(id, token);
        if (!inv.pdfUrl) throw new Error('El proveedor no entregó un PDF para este documento');
        let url = inv.pdfUrl as string;
        if (url.startsWith('data:')) {
          url = URL.createObjectURL(await fetch(url).then((r) => r.blob()));
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        }
        if (win) { win.opener = null; win.location.href = url; } else window.open(url, '_blank', 'noopener,noreferrer');
        return '';
      } catch (err) {
        win?.close();
        throw err;
      }
    });
  };

  const sendEmail = (inv: { id: string }) => run(inv.id, 'email', async (token) => {
    const res = await api.billing.invoices.sendEmail(inv.id, email.trim() || undefined, token);
    setEmailFor(null);
    return `Enviada a ${res.to}`;
  });

  const sendMarketplace = (inv: { id: string }) => run(inv.id, 'mkt', async (token) => {
    try {
      await api.billing.invoices.sendMarketplace(inv.id, token);
      return `Enviada a ${pushLabel}`;
    } finally {
      onChanged();
    }
  });

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5">
      <h2 className="ui-section-title mb-3">Boleta / factura</h2>
      {!invoices.length ? (
        <p className="text-xs text-gray-400">La venta todavía no tiene documento tributario emitido.</p>
      ) : (
        <ul className="space-y-3">
          {invoices.map((inv) => {
            const st = STATUS[inv.status] ?? STATUS.DRAFT;
            const issued = inv.status === 'ISSUED' || inv.status === 'ACCEPTED';
            return (
              <li key={inv.id} className="text-xs border border-gray-100 rounded-xl p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-800">
                    {DTE_LABEL[inv.dteType] ?? inv.dteType}{inv.folio != null ? ` N° ${inv.folio}` : ''}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${st.cls}`}>{st.label}</span>
                </div>
                <p className="text-gray-500 mt-1">
                  {inv.razonSocial} · ${Number(inv.totalAmount).toLocaleString('es-CL')}
                  {inv.issuedAt ? ` · ${fmtDateTime(inv.issuedAt)}` : ''}
                </p>
                {/* ¿El marketplace recibió el documento? ✓ si se le envió y lo aceptó; ✗ si el envío
                    falló o aún no se envía; Paris y Walmart no informan la recepción por su API. */}
                {marketplace && marketplace !== 'MERCADO_LIBRE' && issued && (
                  <p className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="text-gray-500">Recibido por el marketplace:</span>
                    {pushLabel ? (
                      inv.marketplaceSentAt && !inv.marketplaceError ? (
                        <span className="font-semibold text-green-700" title={`Enviado a ${pushLabel} el ${fmtDateTime(inv.marketplaceSentAt)}`}>✓</span>
                      ) : (
                        <span className="font-semibold text-red-600" title={inv.marketplaceError ? `Error: ${inv.marketplaceError}` : `Aún no se envía a ${pushLabel}`}>
                          ✗{inv.marketplaceError ? <span className="font-normal"> ({inv.marketplaceError})</span> : null}
                        </span>
                      )
                    ) : (
                      <span className="text-gray-400" title="Este marketplace no informa por su API si recibió el documento">— sin confirmación del marketplace</span>
                    )}
                  </p>
                )}

                {canManage && issued && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                    <button onClick={() => viewPdf(inv.id)} disabled={!!busy}
                      className="text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50">
                      {busy === `${inv.id}:pdf` ? 'Abriendo...' : 'Ver PDF'}
                    </button>
                    <button onClick={() => { setEmailFor(emailFor === inv.id ? null : inv.id); setEmail(inv.email || ''); }} disabled={!!busy}
                      className="text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50">
                      Reenviar por correo
                    </button>
                    {pushLabel && (
                      <button onClick={() => sendMarketplace(inv)} disabled={!!busy}
                        className="text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50">
                        {busy === `${inv.id}:mkt` ? 'Enviando...' : `${inv.marketplaceSentAt ? 'Reenviar' : 'Enviar'} a ${pushLabel}`}
                      </button>
                    )}
                  </div>
                )}

                {emailFor === inv.id && (
                  <div className="flex gap-2 mt-2">
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@cliente.cl"
                      className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2 py-1 text-xs" />
                    <button onClick={() => sendEmail(inv)} disabled={!!busy || !email.trim()}
                      className="px-3 py-1 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-50">
                      {busy === `${inv.id}:email` ? 'Enviando...' : 'Enviar'}
                    </button>
                  </div>
                )}

                {message && message.id === inv.id && message.text && (
                  <p className={`mt-2 ${message.ok ? 'text-green-700' : 'text-red-600'}`}>{message.text}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

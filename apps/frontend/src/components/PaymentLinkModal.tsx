'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api, type PaymentRequestInfo } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { Modal, btnPrimary, btnSecondary, inputCls } from '@/components/ui/Modal';

const fmtCLP = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;
const fmtDate = (d: string) => new Date(d).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });

// Teléfono chileno para wa.me: solo dígitos y con 56 adelante.
function waPhone(phone?: string | null): string {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('56')) return d;
  if (d.length === 9) return `56${d}`;
  return d;
}

// Link/QR de un cobro en línea (Flow / Mercado Pago). Mientras está pendiente consulta el estado
// cada pocos segundos; al confirmarse el pago llama a onPaid una sola vez.
export function PaymentLinkModal({ request, onClose, onPaid, note }: {
  request: PaymentRequestInfo;
  onClose: (req: PaymentRequestInfo) => void;
  onPaid?: (req: PaymentRequestInfo) => void;
  note?: string;
}) {
  const [req, setReq] = useState(request);
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState(request.customerEmail || '');
  const [emailMsg, setEmailMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<'' | 'email' | 'cancel'>('');
  const [error, setError] = useState('');
  const paidFired = useRef(false);

  useEffect(() => {
    if (!req.paymentUrl) return;
    QRCode.toDataURL(req.paymentUrl, { width: 260, margin: 1 }).then(setQr).catch(() => setQr(''));
  }, [req.paymentUrl]);

  const open = req.status === 'PENDING' || req.status === 'PROCESSING';
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => {
      const token = getToken();
      if (!token) return;
      api.payments.get(req.id, token).then(setReq).catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [open, req.id]);

  useEffect(() => {
    if (req.status === 'PAID' && !paidFired.current) {
      paidFired.current = true;
      onPaid?.(req);
    }
  }, [req, onPaid]);

  async function copy() {
    if (!req.paymentUrl) return;
    try {
      await navigator.clipboard.writeText(req.paymentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* sin permiso de portapapeles */ }
  }

  async function sendEmail() {
    setBusy('email');
    setEmailMsg(null);
    try {
      await api.payments.sendEmail(req.id, email.trim(), getToken()!);
      setEmailMsg({ ok: true, text: `Enviado a ${email.trim()}` });
    } catch (e) {
      setEmailMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy('');
    }
  }

  async function cancel() {
    setBusy('cancel');
    setError('');
    try {
      setReq(await api.payments.cancel(req.id, getToken()!));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  const waText = encodeURIComponent(`Hola${req.customerName ? ` ${req.customerName}` : ''}, este es tu link para pagar ${fmtCLP(req.amount)} con ${req.providerName}: ${req.paymentUrl}`);
  const waHref = `https://wa.me/${waPhone(req.customerPhone)}?text=${waText}`;

  return (
    <Modal
      title={`Cobro con ${req.providerName}`}
      subtitle={req.workOrderFolio ? `Orden de trabajo N° ${String(req.workOrderFolio).padStart(4, '0')}` : req.remote ? 'Link de pago a distancia' : 'Pago en tienda'}
      onClose={() => onClose(req)}
      busy={busy === 'cancel'}
      footer={(
        <>
          {req.status === 'PENDING' && (
            <button type="button" onClick={cancel} disabled={!!busy} className="mr-auto px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50">
              {busy === 'cancel' ? 'Cancelando…' : 'Cancelar cobro'}
            </button>
          )}
          <button type="button" onClick={() => onClose(req)} className={open ? btnSecondary : btnPrimary}>
            {open ? 'Cerrar (sigue pendiente)' : 'Listo'}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="text-center">
          <p className="text-xs text-gray-500">Total a pagar</p>
          <p className="text-3xl font-bold text-gray-900">{fmtCLP(req.amount)}</p>
        </div>

        {req.status === 'PAID' && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <p className="font-semibold">Pago recibido{req.saleNumber ? ` · Venta N° ${req.saleNumber}` : ''}</p>
            {req.paymentMethodName && <p className="text-xs mt-0.5">{req.paymentMethodName}</p>}
          </div>
        )}
        {req.status === 'PROCESSING' && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Pago recibido, registrando la venta…</div>
        )}
        {req.status === 'NEEDS_REVIEW' && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p className="font-semibold">Pago recibido, pero requiere revisión</p>
            <p className="text-xs mt-0.5">{req.error}</p>
            <p className="text-xs mt-1">Resuélvelo en Ventas → Cobros en línea.</p>
          </div>
        )}
        {(req.status === 'CANCELLED' || req.status === 'EXPIRED') && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
            {req.status === 'CANCELLED' ? 'Cobro cancelado.' : 'El link venció sin pago.'}
          </div>
        )}

        {req.status === 'PENDING' && req.paymentUrl && (
          <>
            <div className="flex flex-col items-center gap-2">
              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qr} alt="Código QR del link de pago" className="h-52 w-52 rounded-lg border border-gray-200" />
              ) : (
                <div className="h-52 w-52 rounded-lg border border-gray-200 bg-gray-50" />
              )}
              <p className="flex items-center gap-2 text-xs text-gray-500">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
                Esperando el pago · el cliente escanea el QR con su celular
              </p>
              {req.statusDetail && <p className="text-xs text-amber-700">{req.statusDetail}</p>}
              <p className="text-[11px] text-gray-400">Vence el {fmtDate(req.expiresAt)}</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={copy} className={btnSecondary}>{copied ? '¡Copiado!' : 'Copiar link'}</button>
              <a href={waHref} target="_blank" rel="noopener noreferrer"
                className="px-4 py-2 rounded-lg text-sm font-semibold text-center text-white bg-[#25D366] hover:bg-[#1ebe5b]">
                WhatsApp
              </a>
            </div>

            <div>
              <div className="flex gap-2">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@cliente.com" className={inputCls} />
                <button type="button" onClick={sendEmail} disabled={busy === 'email' || !email.trim()} className={`${btnPrimary} shrink-0`}>
                  {busy === 'email' ? 'Enviando…' : 'Enviar'}
                </button>
              </div>
              {emailMsg && <p className={`mt-1 text-xs ${emailMsg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{emailMsg.text}</p>}
            </div>

            {note && <p className="text-[11px] leading-relaxed text-gray-500">{note}</p>}
          </>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}

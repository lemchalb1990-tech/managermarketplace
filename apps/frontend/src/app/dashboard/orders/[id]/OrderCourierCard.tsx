'use client';

import { useCallback, useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api, imgUrl, type CourierShipmentInfo } from '@/lib/api';
import { Modal, btnPrimary, btnSecondary, inputCls, labelCls, FormError } from '@/components/ui/Modal';

const STATUS: Record<CourierShipmentInfo['status'], [string, string]> = {
  CREATED: ['Creado', 'bg-gray-100 text-gray-700'],
  IN_TRANSIT: ['En tránsito', 'bg-blue-50 text-blue-700'],
  OUT_FOR_DELIVERY: ['En reparto', 'bg-indigo-50 text-indigo-700'],
  DELIVERED: ['Entregado', 'bg-green-50 text-green-700'],
  EXCEPTION: ['Con problema', 'bg-red-50 text-red-700'],
  CANCELLED: ['Anulado', 'bg-gray-100 text-gray-500'],
};
const NAMES: Record<string, string> = { CHILEXPRESS: 'Chilexpress', STARKEN: 'Starken', BLUEXPRESS: 'Blue Express' };
const clp = (n: number | string | null | undefined) => (n == null ? '—' : `$${Number(n).toLocaleString('es-CL', { maximumFractionDigits: 0 })}`);

/** Envíos con courier de la orden: crear (cotizando), etiqueta y seguimiento. */
// Solo aparece si la empresa de la orden tiene un courier activo (o si la orden ya tiene envíos);
// sin courier, la orden se entrega como retiro en tienda o despacho propio.
export default function OrderCourierCard({ orderId, companyId, canCreate, fmtDateTime, onChanged }: {
  orderId: string; companyId?: string; canCreate: boolean; fmtDateTime: (d: string) => string; onChanged: () => void;
}) {
  const [shipments, setShipments] = useState<CourierShipmentInfo[]>([]);
  const [hasCourier, setHasCourier] = useState(false);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.couriers.orderShipments(orderId, getToken()!).then(setShipments).catch(() => setShipments([]));
  }, [orderId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.couriers.connections(getToken()!, companyId)
      .then((rows) => setHasCourier(rows.some((r) => r.active)))
      .catch(() => setHasCourier(false));
  }, [companyId]);

  if (!hasCourier && shipments.length === 0) return null;

  async function refresh(id: string) {
    setBusyId(id);
    setError('');
    try {
      await api.couriers.refresh(id, getToken()!);
      load();
      onChanged();
    } catch (e) {
      setError((e as Error).message || 'No se pudo actualizar el seguimiento');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="ui-section-title">Envío con courier</h2>
        {canCreate && hasCourier && (
          <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
            {shipments.length ? 'Nuevo envío' : 'Despachar con courier'}
          </button>
        )}
      </div>
      {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {shipments.length === 0 ? (
        <p className="text-xs text-gray-400">Sin envíos. Cotiza con Chilexpress, Starken o Blue Express y crea el envío con su etiqueta.</p>
      ) : (
        <ul className="space-y-2">
          {shipments.map((s) => {
            const [label, cls] = STATUS[s.status];
            return (
              <li key={s.id} className="rounded-xl border border-gray-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{NAMES[s.provider]} · <span className="font-mono">{s.trackingNumber}</span></p>
                    <p className="text-xs text-gray-400">{s.serviceName || 'Envío'} · {clp(s.price)} · {fmtDateTime(s.createdAt)}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span>
                </div>
                {s.statusText && <p className="mt-1.5 text-xs text-gray-600">{s.statusText}</p>}
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {s.labelUrl && (
                    <a href={imgUrl(s.labelUrl)} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-gray-300 px-2.5 py-1 font-medium text-gray-700 hover:bg-gray-50">
                      🖨️ Etiqueta
                    </a>
                  )}
                  <button type="button" onClick={() => refresh(s.id)} disabled={busyId === s.id}
                    className="rounded-lg border border-gray-300 px-2.5 py-1 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                    {busyId === s.id ? 'Actualizando…' : 'Actualizar seguimiento'}
                  </button>
                  {(s.events?.length || 0) > 0 && (
                    <button type="button" onClick={() => setExpanded(expanded === s.id ? null : s.id)} className="px-1 font-medium text-blue-600 hover:underline">
                      {expanded === s.id ? 'Ocultar historial' : `Ver historial (${s.events!.length})`}
                    </button>
                  )}
                </div>
                {expanded === s.id && (
                  <ol className="mt-2 space-y-1 border-l-2 border-gray-100 pl-3">
                    {[...(s.events || [])].reverse().map((e, i) => (
                      <li key={i} className="text-xs text-gray-600">
                        <span className="text-gray-400">{fmtDateTime(e.date)}</span> · {e.description}{e.location ? ` · ${e.location}` : ''}
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {open && <CreateShipmentModal orderId={orderId} onClose={() => setOpen(false)} onCreated={() => { setOpen(false); load(); onChanged(); }} />}
    </div>
  );
}

type QuoteRow = Awaited<ReturnType<typeof api.couriers.quote>>[number];

function CreateShipmentModal({ orderId, onClose, onCreated }: { orderId: string; onClose: () => void; onCreated: () => void }) {
  const [pkg, setPkg] = useState({ weight: '', length: '', width: '', height: '' });
  const [quotes, setQuotes] = useState<QuoteRow[] | null>(null);
  const [pick, setPick] = useState<{ provider: string; serviceCode?: string; price?: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pkgBody = () => Object.fromEntries(Object.entries(pkg).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)]));

  async function quote() {
    setBusy(true);
    setError('');
    setPick(null);
    try {
      const rows = await api.couriers.quote(orderId, { package: pkgBody() }, getToken()!);
      setQuotes(rows);
      const first = rows.find((r) => r.options.length);
      if (first) setPick({ provider: first.provider, serviceCode: first.options[0].serviceCode, price: first.options[0].price });
    } catch (e) {
      setError((e as Error).message || 'No se pudo cotizar');
    } finally {
      setBusy(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!pick) return;
    setBusy(true);
    setError('');
    try {
      await api.couriers.createShipment(orderId, { ...pick, package: pkgBody() }, getToken()!);
      onCreated();
    } catch (err) {
      setError((err as Error).message || 'No se pudo crear el envío');
      setBusy(false);
    }
  }

  return (
    <Modal title="Despachar con courier" subtitle="Cotiza con tus couriers conectados y crea el envío con su etiqueta." size="lg" busy={busy} onClose={onClose} onSubmit={create}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className={btnSecondary}>Cancelar</button>
          <button type="submit" disabled={busy || !pick} className={btnPrimary}>{busy && quotes ? 'Creando…' : 'Crear envío'}</button>
        </>
      )}>
      <div className="space-y-4">
        <div>
          <p className={labelCls}>Paquete (vacío = el por defecto de cada courier)</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([['weight', 'Peso kg'], ['length', 'Largo cm'], ['width', 'Ancho cm'], ['height', 'Alto cm']] as const).map(([k, l]) => (
              <input key={k} value={pkg[k]} onChange={(e) => setPkg((p) => ({ ...p, [k]: e.target.value }))} placeholder={l} inputMode="decimal" className={inputCls} />
            ))}
          </div>
          <button type="button" onClick={quote} disabled={busy} className={`${btnSecondary} mt-2`}>{busy && !quotes ? 'Cotizando…' : 'Cotizar'}</button>
        </div>

        {quotes && (
          <div className="space-y-2">
            {quotes.map((q) => (
              <div key={q.provider} className="rounded-xl border border-gray-200 p-3">
                <p className="text-sm font-semibold text-gray-800">{q.name}</p>
                {q.error && (
                  <div className="mt-1">
                    <p className="text-xs text-red-600">{q.error}</p>
                    <label className="mt-1 flex items-center gap-2 text-xs text-gray-700">
                      <input type="radio" name="courier" checked={pick?.provider === q.provider && !pick?.serviceCode}
                        onChange={() => setPick({ provider: q.provider })} />
                      Crear igual, sin cotizar (servicio por defecto)
                    </label>
                  </div>
                )}
                {q.options.map((o) => (
                  <label key={o.serviceCode} className="mt-1 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50">
                    <input type="radio" name="courier" checked={pick?.provider === q.provider && pick?.serviceCode === o.serviceCode}
                      onChange={() => setPick({ provider: q.provider, serviceCode: o.serviceCode, price: o.price })} />
                    <span className="flex-1">{o.serviceName}{o.days ? <span className="text-xs text-gray-400"> · {o.days}</span> : null}</span>
                    <span className="font-semibold">{clp(o.price)}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}
        <FormError message={error} />
      </div>
    </Modal>
  );
}

'use client';

import { use, useEffect, useState } from 'react';
import { api, type ProductionPublicView } from '@/lib/api';

const STATUS_TEXT: Record<string, string> = {
  PENDING: 'Por iniciar',
  IN_PROGRESS: 'En proceso',
  WAITING_APPROVAL: 'Esperando tu aprobación',
  ON_HOLD: 'En pausa',
  DONE: 'Listo',
  CANCELLED: 'Anulado',
};

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('es-CL', { day: 'numeric', month: 'long' }) : '');

// Seguimiento público del pedido: el cliente ve el avance por etapa, las fotos y aprueba cuando se le pide.
export default function TrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<ProductionPublicView | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.production.publicView(token).then(setData).catch(() => setError('No encontramos este pedido. Revisa el link que te enviaron.'));
  }, [token]);

  async function respond(stageId: string, approved: boolean) {
    setBusy(stageId);
    setMsg('');
    try {
      setData(await api.production.publicApproval(token, stageId, approved, note[stageId]));
      setMsg(approved ? '¡Gracias! Registramos tu aprobación.' : 'Gracias, le avisamos al equipo los cambios que necesitas.');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  if (error) return <Shell><p className="text-center text-sm text-gray-600">{error}</p></Shell>;
  if (!data) return <Shell><p className="text-center text-sm text-gray-500">Cargando…</p></Shell>;

  const done = data.status === 'DONE';
  return (
    <Shell>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{data.companyName}</p>
      <h1 className="mt-1 text-xl font-bold text-gray-900">{data.productName}{data.quantity > 1 && ` × ${data.quantity}`}</h1>
      <p className="text-sm text-gray-500">Pedido OF-{String(data.number).padStart(4, '0')}{data.customerName && ` · ${data.customerName}`}</p>

      <div className="mt-5 rounded-2xl bg-gray-50 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className={`font-semibold ${done ? 'text-green-700' : data.status === 'WAITING_APPROVAL' ? 'text-amber-700' : 'text-gray-800'}`}>{STATUS_TEXT[data.status]}</span>
          <span className="text-gray-500">{data.progress}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200">
          <div className={`h-full rounded-full ${done ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${data.progress}%` }} />
        </div>
        {!done && data.dueDate && <p className="mt-2 text-xs text-gray-500">Entrega estimada: <strong>{fmtDate(data.dueDate)}</strong></p>}
        {done && data.completedAt && <p className="mt-2 text-xs text-green-700">Terminado el {fmtDate(data.completedAt)}</p>}
        {data.balanceDue > 0 && <p className="mt-1 text-xs text-amber-700">Saldo pendiente: ${Math.round(data.balanceDue).toLocaleString('es-CL')}</p>}
      </div>

      {msg && <p className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">{msg}</p>}

      <ol className="mt-6 space-y-4">
        {data.stages.map((s) => {
          const waiting = s.status === 'WAITING_APPROVAL';
          return (
            <li key={s.id} className="flex gap-3">
              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.status === 'DONE' ? 'bg-green-500 text-white' : waiting ? 'bg-amber-400 text-white' : s.status === 'IN_PROGRESS' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                {s.status === 'DONE' ? '✓' : s.status === 'SKIPPED' ? '–' : '•'}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold ${s.status === 'PENDING' ? 'text-gray-400' : 'text-gray-900'}`}>{s.name}</p>
                <p className="text-xs text-gray-500">
                  {s.status === 'DONE' && s.completedAt ? `Listo el ${fmtDate(s.completedAt)}` : s.status === 'IN_PROGRESS' ? 'En curso' : waiting ? 'Necesitamos tu aprobación' : s.dueDate ? `Estimado para el ${fmtDate(s.dueDate)}` : ''}
                </p>
                {s.approval?.status === 'APPROVED' && <p className="text-xs text-green-700">Aprobado{s.approval.note && `: ${s.approval.note}`}</p>}
                {s.approval?.status === 'CHANGES_REQUESTED' && <p className="text-xs text-amber-700">Pediste cambios{s.approval.note && `: ${s.approval.note}`}</p>}
                {s.attachments.length > 0 && <Photos items={s.attachments} />}
                {waiting && (
                  <div className="mt-2 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <textarea value={note[s.id] || ''} onChange={(e) => setNote((n) => ({ ...n, [s.id]: e.target.value }))} rows={2}
                      placeholder="Comentario (obligatorio si pides cambios)" className="w-full resize-none rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm" />
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => respond(s.id, true)} disabled={busy === s.id} className="rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">Aprobar</button>
                      <button onClick={() => respond(s.id, false)} disabled={busy === s.id || !note[s.id]?.trim()} className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50">Pedir cambios</button>
                    </div>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {data.attachments.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-gray-800">Fotos y archivos</h2>
          <Photos items={data.attachments} />
        </section>
      )}

      {data.specs && Object.keys(data.specs).length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-gray-800">Lo que pediste</h2>
          <dl className="mt-2 space-y-1 text-sm">
            {Object.entries(data.specs).filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="flex gap-2"><dt className="capitalize text-gray-500">{k.replace(/_/g, ' ')}:</dt><dd className="text-gray-900">{v}</dd></div>
            ))}
          </dl>
        </section>
      )}

      {data.events.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-gray-800">Novedades</h2>
          <ul className="mt-2 space-y-1.5">
            {data.events.map((e, i) => (
              <li key={i} className="text-xs text-gray-600"><span className="text-gray-400">{new Date(e.createdAt).toLocaleDateString('es-CL')} · </span>{e.message}</li>
            ))}
          </ul>
        </section>
      )}
    </Shell>
  );
}

function Photos({ items }: { items: Array<{ id: string; url: string; name: string; mimeType: string | null }> }) {
  return (
    <div className="mt-2 grid grid-cols-3 gap-2">
      {items.map((a) => (
        <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="block aspect-square overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
          {a.mimeType?.startsWith('image/')
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={a.url} alt={a.name} className="h-full w-full object-cover" />
            : <span className="flex h-full items-center justify-center p-1 text-center text-[10px] text-gray-500">{a.name}</span>}
        </a>
      ))}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-[100dvh] bg-gray-100 px-4 py-8">
      <div className="mx-auto w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">{children}</div>
    </main>
  );
}

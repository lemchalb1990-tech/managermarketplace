'use client';

import { useEffect, useState } from 'react';

// Estado de una unificación en curso: espera (con tiempo transcurrido), confirmación o error.
export type MergeStatus =
  | { kind: 'working'; survivorSku: string; count: number }
  | { kind: 'done'; survivorSku: string; survivorName: string; removedSkus: string[] }
  | { kind: 'error'; message: string };

export default function MergeStatusModal({ status, onClose }: { status: MergeStatus; onClose: () => void }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (status.kind !== 'working') return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [status.kind]);

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center space-y-3">
        {status.kind === 'working' && (
          <>
            <div className="mx-auto w-12 h-12 rounded-full border-4 border-blue-100 border-t-blue-600 animate-spin" aria-hidden="true" />
            <h3 className="font-semibold text-gray-900">Unificando {status.count} productos…</h3>
            <p className="text-sm text-gray-500">
              Se están moviendo ventas, stock y publicaciones a <span className="font-mono">{status.survivorSku}</span>.
              No cierres ni recargues la página.
            </p>
            <p className="text-xs text-gray-400 tabular-nums">{seconds} s</p>
          </>
        )}
        {status.kind === 'done' && (
          <>
            <div className="mx-auto w-12 h-12 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-2xl" aria-hidden="true">✓</div>
            <h3 className="font-semibold text-gray-900">Productos unificados</h3>
            <p className="text-sm text-gray-600">
              Quedó <span className="font-mono font-medium">{status.survivorSku}</span> — {status.survivorName}.
            </p>
            {status.removedSkus.length > 0 && (
              <p className="text-xs text-gray-500">
                Se eliminaron: <span className="font-mono">{status.removedSkus.join(', ')}</span>
              </p>
            )}
            <button onClick={onClose} autoFocus
              className="w-full mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold">
              Aceptar
            </button>
          </>
        )}
        {status.kind === 'error' && (
          <>
            <div className="mx-auto w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-2xl font-bold" aria-hidden="true">!</div>
            <h3 className="font-semibold text-gray-900">No se pudo unificar</h3>
            <p className="text-sm text-gray-600 break-words">{status.message}</p>
            <p className="text-xs text-gray-400">No se cambió nada: los productos siguen como estaban.</p>
            <button onClick={onClose} autoFocus
              className="w-full mt-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">
              Volver
            </button>
          </>
        )}
      </div>
    </div>
  );
}

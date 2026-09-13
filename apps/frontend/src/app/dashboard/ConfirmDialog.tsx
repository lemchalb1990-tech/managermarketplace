'use client';

import { useEffect, useState, type ReactNode } from 'react';

type DialogRequest = {
  kind: 'confirm' | 'alert';
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  resolve: (value: boolean) => void;
};

// Puente imperativo hacia el modal montado por DialogProvider: permite llamar
// confirmDialog()/alertDialog() desde cualquier función (no solo componentes), igual que
// antes se llamaba a window.confirm()/window.alert(), pero renderizando un modal propio
// en vez del diálogo nativo del navegador.
let showDialogFn: ((req: DialogRequest) => void) | null = null;

export function confirmDialog(
  message: ReactNode,
  opts?: { title?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean },
): Promise<boolean> {
  return new Promise((resolve) => {
    if (!showDialogFn) { resolve(false); return; }
    showDialogFn({ kind: 'confirm', message, resolve, ...opts });
  });
}

export function alertDialog(message: ReactNode, opts?: { title?: string }): Promise<void> {
  return new Promise((resolve) => {
    if (!showDialogFn) { resolve(); return; }
    showDialogFn({ kind: 'alert', message, resolve: () => resolve(), ...opts });
  });
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<DialogRequest | null>(null);

  useEffect(() => {
    showDialogFn = (r) => setReq(r);
    return () => { showDialogFn = null; };
  }, []);

  function close(value: boolean) {
    req?.resolve(value);
    setReq(null);
  }

  return (
    <>
      {children}
      {req && (
        <div
          className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4"
          onClick={() => close(req.kind === 'confirm' ? false : true)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
            role={req.kind === 'confirm' ? 'alertdialog' : 'dialog'}
            aria-modal="true"
          >
            <div className="px-6 py-5">
              {req.title && <h2 className="font-bold text-gray-900 mb-2">{req.title}</h2>}
              <p className="text-sm text-gray-600 whitespace-pre-line leading-relaxed">{req.message}</p>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              {req.kind === 'confirm' && (
                <button
                  onClick={() => close(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50"
                >
                  {req.cancelLabel || 'Cancelar'}
                </button>
              )}
              <button
                onClick={() => close(true)}
                autoFocus
                className={`px-4 py-2 rounded-lg text-sm font-semibold text-white ${
                  req.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {req.kind === 'confirm' ? (req.confirmLabel || 'Confirmar') : 'Aceptar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

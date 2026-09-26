'use client';

import { useEffect, useRef, type ReactNode, type FormEvent } from 'react';

const SIZES = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
} as const;

// Modal único para los formularios del panel. No se cierra al hacer clic fuera (evita perder
// lo escrito); sí con Escape o el botón ✕, salvo mientras `busy`. Si recibe `onSubmit`, el
// cuerpo y el pie van dentro de un <form>, así Enter envía y los `required` validan.
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  size = 'md',
  onSubmit,
  busy = false,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof SIZES;
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  busy?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const first = panelRef.current?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea');
    first?.focus();
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const body = (
    <>
      <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      {footer && <div className="px-6 py-4 border-t border-gray-100 flex flex-wrap gap-2 justify-end shrink-0">{footer}</div>}
    </>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true">
      <div ref={panelRef}
        className={`bg-white w-full ${SIZES[size]} max-h-[100dvh] sm:max-h-[90vh] rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col`}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h2 className="font-bold text-gray-900">{title}</h2>
            {subtitle && <div className="text-xs text-gray-500 mt-0.5">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Cerrar"
            className="text-gray-400 hover:text-gray-600 text-xl leading-none disabled:opacity-40">✕</button>
        </div>
        {onSubmit ? (
          <form onSubmit={onSubmit} className="flex-1 min-h-0 flex flex-col">{body}</form>
        ) : body}
      </div>
    </div>
  );
}

export const btnPrimary = 'px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold';
export const btnSecondary = 'px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50';
export const btnDanger = 'px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold';
export const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';
export const labelCls = 'block text-xs font-semibold text-gray-600 mb-1';

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{message}</p>;
}

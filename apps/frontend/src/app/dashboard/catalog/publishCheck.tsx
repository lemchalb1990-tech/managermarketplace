'use client';

// Verificación antes de publicar — compartida por todos los marketplaces.
// Cada comprobación indica a qué campo(s) corresponde (`field`). Si falta algo obligatorio:
//  - la fila muestra "Falta" y un enlace "Ir a completar" que lleva al campo,
//  - el campo se marca con borde rojo y deja de estarlo apenas se completa (en vivo),
//  - "Publicar ahora" queda deshabilitado mientras haya obligatorios pendientes.

export type CheckStatus = 'ok' | 'warn' | 'error';

export interface PreflightCheck {
  label: string;
  value?: string | null;
  status: CheckStatus;
  /** Clave(s) de campo; el elemento del DOM tiene id `pf-<clave>`. La primera que exista recibe el foco. */
  field?: string | string[];
  /** Pestaña del producto donde está el campo (solo Mercado Libre usa pestañas). */
  tab?: 'edit' | 'images';
}

export const checkIcon: Record<CheckStatus, string> = { ok: '✅', warn: '⚠️', error: '❌' };

const fieldKeys = (c: PreflightCheck): string[] => (c.field == null ? [] : Array.isArray(c.field) ? c.field : [c.field]);

export const fieldDomId = (key: string) => `pf-${key}`;

/** ¿Hay una comprobación obligatoria pendiente para este campo? (en vivo, con `checks` recalculado en cada render) */
export function isFieldInvalid(checks: PreflightCheck[], key: string, active = true): boolean {
  return active && checks.some((c) => c.status === 'error' && fieldKeys(c).includes(key));
}

/** Clases extra para un input/select/contenedor con campo obligatorio faltante. */
export const INVALID_CLS = 'border-red-500 ring-2 ring-red-200 bg-red-50/40';

/** Borde del campo: rojo si falta, el normal si no. */
export const fieldBorder = (invalid: boolean, normal = 'border-gray-300') => (invalid ? INVALID_CLS : normal);

/** Desplaza hasta el campo y le da el foco. Prueba cada clave hasta encontrar una que exista en pantalla. */
export function focusField(field: string | string[] | undefined) {
  if (field == null) return;
  const keys = Array.isArray(field) ? field : [field];
  for (const key of keys) {
    const el = document.getElementById(fieldDomId(key));
    if (!el) continue;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const target = el.matches('input,select,textarea,button')
      ? el
      : (el.querySelector('input,select,textarea,button') as HTMLElement | null);
    // Pequeña espera para que termine el desplazamiento antes de enfocar.
    setTimeout(() => (target || el).focus?.({ preventScroll: true }), 250);
    return;
  }
}

export function PreflightRows({ checks, onGo }: { checks: PreflightCheck[]; onGo?: (c: PreflightCheck) => void }) {
  return (
    <>
      {checks.map((c, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <span className="w-5 shrink-0 text-base leading-none">{checkIcon[c.status]}</span>
          <span className="text-gray-700 flex-1">{c.label}</span>
          {c.status === 'ok' ? (
            c.value && <span className="text-gray-400 text-xs text-right max-w-[140px] truncate">{c.value}</span>
          ) : (
            <span className="flex items-center gap-2 text-right">
              {c.value
                ? <span className={`text-xs max-w-[120px] truncate ${c.status === 'error' ? 'text-red-600' : 'text-gray-400'}`}>{c.value}</span>
                : c.status === 'error' && <span className="text-xs font-medium text-red-600">Falta</span>}
              {onGo && fieldKeys(c).length > 0 && (
                <button type="button" onClick={() => onGo(c)} className="text-xs font-semibold text-blue-600 hover:text-blue-800 whitespace-nowrap">
                  {c.status === 'error' ? 'Ir a completar →' : 'Revisar →'}
                </button>
              )}
            </span>
          )}
        </div>
      ))}
    </>
  );
}

/** Mensaje bajo la lista cuando hay obligatorios pendientes. */
export function MissingNotice({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <p className="text-xs text-red-600 font-medium">
      {count === 1 ? 'Falta 1 campo obligatorio (❌).' : `Faltan ${count} campos obligatorios (❌).`} Usa «Ir a completar» para llegar al campo; luego vuelve a verificar.
    </p>
  );
}

/** Modal de verificación genérico (Paris, Ripley, Falabella, Walmart). */
export function PublishCheckModal({ marketplace, checks, isRepublish, busy, onGo, onConfirm, onClose }: {
  marketplace: string;
  checks: PreflightCheck[];
  isRepublish?: boolean;
  busy?: boolean;
  onGo: (c: PreflightCheck) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const errors = checks.filter((c) => c.status === 'error');
  const firstError = errors[0];
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="ui-section-title">Verificación antes de publicar en {marketplace}</h2>
        </div>
        {isRepublish && (
          <div className="mx-5 mt-4 px-3 py-2 bg-yellow-50 border border-yellow-300 rounded-lg text-xs text-yellow-800 flex gap-2 items-start">
            <span className="shrink-0">⚠️</span>
            <span>Esta acción <strong>republicará</strong> el producto en {marketplace}, reemplazando la publicación actual.</span>
          </div>
        )}
        <div className="p-5 space-y-2.5 overflow-y-auto">
          <PreflightRows checks={checks} onGo={onGo} />
        </div>
        {errors.length > 0 && (
          <div className="px-5 pb-2"><MissingNotice count={errors.length} /></div>
        )}
        <div className="px-5 py-4 border-t border-gray-100 flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 font-medium">Cancelar</button>
          {firstError && (
            <button onClick={() => onGo(firstError)} className="px-4 py-2 text-sm font-semibold text-blue-600 hover:text-blue-800">
              Ir al primero
            </button>
          )}
          <button onClick={onConfirm} disabled={errors.length > 0 || busy}
            className="px-4 py-2 bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 text-gray-900 rounded-lg text-sm font-semibold">
            {busy ? 'Publicando...' : 'Publicar ahora'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Franja que recuerda lo pendiente cuando el modal está cerrado y se está completando. */
export function MissingBanner({ count, onVerify }: { count: number; onVerify: () => void }) {
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
      <span className="flex-1 min-w-[180px]">
        {count === 1 ? 'Te falta 1 campo obligatorio para publicar.' : `Te faltan ${count} campos obligatorios para publicar.`}
      </span>
      <button type="button" onClick={onVerify} className="px-2.5 py-1 rounded-md bg-white border border-red-300 font-semibold hover:bg-red-100">
        Volver a verificar
      </button>
    </div>
  );
}

'use client';

// Barra de filtros común a todas las vistas (mismo estilo que el Catálogo): la búsqueda
// principal a la vista, el resto de los filtros plegados bajo "Más filtros" (con el número de
// filtros activos), botones Filtrar / Limpiar y el total de resultados a la derecha.
import { ReactNode, useState } from 'react';

export const filterInputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';
export const filterSelectCls = 'border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white';

// Un filtro con su etiqueta, para usar dentro de <FilterBar>.
export function FilterField({ label, children, grow = false, title }: { label: string; children: ReactNode; grow?: boolean; title?: string }) {
  return (
    <div className={grow ? 'flex-1 min-w-[200px]' : ''} title={title}>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}

export function FilterBar({
  search,
  primary,
  children,
  activeCount = 0,
  defaultOpen = false,
  onApply,
  onClear,
  summary,
  // Fija arriba al hacer scroll, igual que el Catálogo.
  sticky = true,
  className = '',
}: {
  // Búsqueda principal, siempre visible.
  search?: { label: string; value: string; onChange: (v: string) => void; onSubmit?: () => void; placeholder?: string };
  // Filtro principal siempre visible cuando la vista no tiene búsqueda por texto.
  primary?: ReactNode;
  // Filtros avanzados (FilterField), plegados bajo "Más filtros".
  children?: ReactNode;
  // Filtros avanzados aplicados (se muestra en el botón).
  activeCount?: number;
  defaultOpen?: boolean;
  onApply?: () => void;
  onClear?: () => void;
  // Texto a la derecha, p. ej. "128 órdenes".
  summary?: ReactNode;
  sticky?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen || activeCount > 0);
  const hasAdvanced = !!children;

  const bar = (
    <>
      <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-wrap items-end gap-2 sm:gap-3 shadow-sm">
        {search && (
          <FilterField label={search.label} grow>
            <input
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') (search.onSubmit || onApply)?.(); }}
              placeholder={search.placeholder}
              className={filterInputCls}
            />
          </FilterField>
        )}
        {primary}
        {hasAdvanced && (
          <button type="button" onClick={() => setOpen((v) => !v)}
            className={`ui-btn-secondary inline-flex items-center gap-1.5 ${open ? '!border-[var(--brand)]' : ''}`}>
            {open ? 'Menos filtros' : 'Más filtros'}
            {activeCount > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--brand)] text-[10px] font-semibold text-white inline-flex items-center justify-center">{activeCount}</span>
            )}
          </button>
        )}
        {onApply && (
          <button type="button" onClick={onApply} className="ui-btn-secondary">Filtrar</button>
        )}
        {onClear && (
          <button type="button" onClick={onClear} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm">Limpiar</button>
        )}
        {summary != null && <span className="ml-auto text-sm text-[var(--text-2)] self-center">{summary}</span>}
      </div>
      {hasAdvanced && open && (
        <div className="mt-2 bg-white border border-gray-200 rounded-xl p-3 flex flex-wrap items-end gap-2 sm:gap-3 shadow-sm">
          {children}
        </div>
      )}
    </>
  );

  return sticky
    ? <div className={`sticky top-0 z-20 -mx-1 px-1 pt-1 pb-2 mb-2 bg-[var(--page-bg)] ${className}`}>{bar}</div>
    : <div className={`mb-4 ${className}`}>{bar}</div>;
}

// Resumen "N resultados" con el número destacado, igual que el Catálogo.
export function FilterCount({ n, label }: { n: number; label: string }) {
  return <><b className="font-semibold text-[var(--text)]">{n.toLocaleString('es-CL')}</b> {label}</>;
}

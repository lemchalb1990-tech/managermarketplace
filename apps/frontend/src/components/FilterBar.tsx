'use client';

// Barra de filtros común a todas las vistas: la búsqueda principal a la vista y el resto de los
// filtros en «Más filtros», un panel flotante sobre el contenido (en celular, hoja que sube desde
// abajo) con Limpiar / Aplicar, igual que el punto de venta. Con el panel cerrado, los filtros
// aplicados se ven como chips bajo la búsqueda. Botones Filtrar / Limpiar y el total a la derecha.
import { ReactNode, useEffect, useRef, useState } from 'react';

export const filterInputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';
export const filterSelectCls = 'border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white';

// Un filtro con su etiqueta, para usar dentro de <FilterBar>.
export function FilterField({ label, children, grow = false, title }: { label: string; children: ReactNode; grow?: boolean; title?: string }) {
  return (
    <div className={grow ? 'flex-1 min-w-[200px]' : ''} title={title} data-filter-label={label}>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}

// «2026-10-14» → «14-10-2026».
const fmtDate = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split('-').reverse().join('-') : v);

// Lee del panel los filtros con valor distinto al predeterminado (primera opción de cada lista,
// campos vacíos, casillas sin marcar) para mostrarlos como chips.
function readChips(root: HTMLElement): string[] {
  const out: string[] = [];
  root.querySelectorAll<HTMLElement>('[data-filter-label]').forEach((field) => {
    const label = field.dataset.filterLabel || '';
    const sel = field.querySelector('select');
    if (sel) {
      if (sel.selectedIndex > 0) out.push(`${label}: ${sel.options[sel.selectedIndex].text}`);
      return;
    }
    const inputs = Array.from(field.querySelectorAll<HTMLInputElement>('input:not([type=checkbox]):not([type=radio])')).filter((i) => i.value.trim());
    if (inputs.length) out.push(`${label}: ${inputs.map((i) => fmtDate(i.value.trim())).join(' – ')}`);
  });
  root.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked').forEach((cb) => {
    const text = cb.closest('label')?.textContent?.trim();
    if (text && !cb.closest('[data-filter-label]')) out.push(text);
  });
  return out;
}

export function FilterBar({
  search,
  primary,
  children,
  activeCount = 0,
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
  // Filtros avanzados (FilterField), en el panel «Más filtros».
  children?: ReactNode;
  // Filtros avanzados aplicados (se muestra en el botón).
  activeCount?: number;
  // Se mantiene por compatibilidad; el panel siempre parte cerrado.
  defaultOpen?: boolean;
  onApply?: () => void;
  onClear?: () => void;
  // Texto a la derecha, p. ej. "128 órdenes".
  summary?: ReactNode;
  sticky?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [chips, setChips] = useState<string[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hasAdvanced = !!children;

  // Chips: se leen del panel (siempre montado, oculto si está cerrado) después de cada render.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const next = panelRef.current && activeCount > 0 ? readChips(panelRef.current) : [];
      setChips((cur) => (cur.join('|') === next.join('|') ? cur : next));
    });
    return () => cancelAnimationFrame(id);
  });

  // Cerrar con Escape o al hacer clic fuera (en escritorio; en celular cierra el fondo).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (window.innerWidth >= 640 && wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

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
          <div className="relative" ref={wrapRef}>
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="dialog"
              className={`ui-btn-secondary inline-flex items-center gap-1.5 ${open || activeCount > 0 ? '!border-[var(--brand)] !text-[var(--brand)] !bg-[var(--brand-light)]' : ''}`}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M3 5h18M6 12h12M10 19h4" /></svg>
              Más filtros
              {activeCount > 0 && (
                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--brand)] text-[10px] font-semibold text-white inline-flex items-center justify-center">{activeCount}</span>
              )}
            </button>
            {open && <div className="sm:hidden fixed inset-0 z-40 bg-[#02093a]/40" onClick={() => setOpen(false)} />}
            {/* Siempre montado (para leer los chips); visible solo con el panel abierto. */}
            <div
              role="dialog"
              aria-label="Más filtros"
              hidden={!open}
              className="ui-pop fixed sm:absolute inset-x-0 bottom-0 sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 z-50 sm:w-[340px] max-h-[85dvh] overflow-y-auto bg-white rounded-t-2xl sm:rounded-[14px] border border-[var(--border)] shadow-[0_16px_40px_-8px_rgba(2,9,58,0.28)] p-4 pb-[max(16px,env(safe-area-inset-bottom))]"
            >
              <div className="sm:hidden mx-auto mb-3 h-1 w-9 rounded-full bg-[var(--border)]" />
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-[var(--text)]">Más filtros</p>
                <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar" className="w-8 h-8 text-lg text-[var(--text-muted)]">×</button>
              </div>
              <div ref={panelRef} className="flex flex-col gap-3 [&_select]:w-full [&_input:not([type=checkbox]):not([type=radio])]:w-full [&>*]:min-w-0">
                {children}
              </div>
              <div className="flex gap-2 pt-4">
                {onClear && <button type="button" onClick={onClear} className="ui-btn-secondary flex-1">Limpiar</button>}
                <button type="button" onClick={() => { onApply?.(); setOpen(false); }} className="ui-btn-brand flex-1">Aplicar</button>
              </div>
            </div>
          </div>
        )}
        {onApply && (
          <button type="button" onClick={onApply} className="ui-btn-secondary">Filtrar</button>
        )}
        {onClear && (
          <button type="button" onClick={onClear} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm">Limpiar</button>
        )}
        {summary != null && <span className="ml-auto text-sm text-[var(--text-2)] self-center">{summary}</span>}
      </div>
      {hasAdvanced && !open && chips.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button key={c} type="button" onClick={() => setOpen(true)} title="Cambiar en Más filtros"
              className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs bg-[var(--brand-light)] text-[var(--brand-ink)] hover:ring-1 hover:ring-[var(--brand)]">
              {c}
            </button>
          ))}
          {onClear && <button type="button" onClick={onClear} className="text-xs text-[var(--brand)] hover:underline px-1">Limpiar filtros</button>}
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

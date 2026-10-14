'use client';

import { useEffect, useRef, useState } from 'react';

type Wh = { id: string; name: string };

export interface PosFilterValues { category: string; onlyInStock: boolean; warehouseId: string }

// Filtros del punto de venta («Panel flotante»): el botón «Filtros» abre un panel sobre los
// productos (en celular, hoja que sube desde abajo) con Categoría, Vender desde y Solo con
// stock; se eligen y se aplican de una vez con «Aplicar».
export default function PosFilters({ categories, values, warehouses, canChooseWarehouse, singleStore, activeCount, onApply }: {
  categories: string[];
  values: PosFilterValues;
  // Bodegas entre las que puede vender (vacío = no elige bodega).
  warehouses: Wh[];
  canChooseWarehouse: boolean;
  // Tienda única asignada en Usuarios (solo se informa).
  singleStore: string | null;
  activeCount: number;
  onApply: (v: PosFilterValues) => void;
}) {
  const [draft, setDraft] = useState<PosFilterValues | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const open = draft !== null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (window.innerWidth >= 640 && ref.current && !ref.current.contains(e.target as Node)) setDraft(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDraft(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const showWarehouse = warehouses.length > (canChooseWarehouse ? 0 : 1);
  const selectCls = 'w-full border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white';

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setDraft(open ? null : { ...values })} aria-expanded={open} aria-haspopup="dialog"
        className={`ui-btn-secondary inline-flex items-center gap-1.5 h-[38px] ${open || activeCount ? '!border-[var(--brand)] !text-[var(--brand)] !bg-[var(--brand-light)]' : ''}`}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M3 5h18M6 12h12M10 19h4" /></svg>
        Filtros
        {activeCount > 0 && (
          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--brand)] text-[10px] font-semibold text-white inline-flex items-center justify-center">{activeCount}</span>
        )}
      </button>

      {draft && (
        <>
          <div className="sm:hidden fixed inset-0 z-40 bg-[#02093a]/40" onClick={() => setDraft(null)} />
          <div role="dialog" aria-label="Filtros"
            className="ui-pop fixed sm:absolute inset-x-0 bottom-0 sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 z-50 sm:w-[300px] bg-white rounded-t-2xl sm:rounded-[14px] border border-[var(--border)] shadow-[0_16px_40px_-8px_rgba(2,9,58,0.28)] p-4 pb-[max(16px,env(safe-area-inset-bottom))] flex flex-col gap-3">
            <div className="sm:hidden mx-auto h-1 w-9 rounded-full bg-[var(--border)]" />
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-[var(--text)]">Filtros</p>
              <button type="button" onClick={() => setDraft(null)} aria-label="Cerrar" className="w-8 h-8 text-lg text-[var(--text-muted)]">×</button>
            </div>
            <label className="block">
              <span className="text-xs text-gray-500 block mb-1">Categoría</span>
              <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className={selectCls}>
                <option value="">Todas</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            {showWarehouse ? (
              <label className="block">
                <span className="text-xs text-gray-500 block mb-1">Vender desde</span>
                <select value={draft.warehouseId} onChange={(e) => setDraft({ ...draft, warehouseId: e.target.value })} className={selectCls}>
                  {canChooseWarehouse && <option value="">Bodega de cada producto</option>}
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                {draft.warehouseId !== values.warehouseId && (
                  <span className="block text-[11px] text-[var(--warn)] mt-1">Al cambiar la bodega se vacía el carrito.</span>
                )}
              </label>
            ) : singleStore && (
              <p className="text-xs text-[var(--text-2)]">Vendes desde <strong>{singleStore}</strong> (asignada en Usuarios).</p>
            )}
            <label className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 cursor-pointer select-none">
              <input type="checkbox" checked={draft.onlyInStock} onChange={(e) => setDraft({ ...draft, onlyInStock: e.target.checked })} className="rounded" />
              Solo con stock
            </label>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setDraft({ ...draft, category: '', onlyInStock: false })} className="ui-btn-secondary flex-1">Limpiar</button>
              <button type="button" onClick={() => { onApply(draft); setDraft(null); }} className="ui-btn-brand flex-1">Aplicar</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

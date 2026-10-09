'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export interface SearchSelectOption { value: string; label: string; hint?: string }

// Selector con búsqueda: se escribe para filtrar y se elige de la lista. value '' = opción
// "todas" (allLabel), si se indica.
export function SearchSelect({ options, value, onChange, placeholder = 'Buscar…', allLabel, className = '' }: {
  options: SearchSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  allLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
    return allLabel && !q ? [{ value: '', label: allLabel }, ...filtered] : filtered;
  }, [options, query, allLabel]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  function pick(v: string) {
    onChange(v);
    setQuery('');
    setOpen(false);
  }

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <input
        value={open ? query : (selected?.label ?? (value ? '' : allLabel ?? ''))}
        placeholder={open ? (selected?.label ?? placeholder) : placeholder}
        onFocus={() => { setOpen(true); setQuery(''); setHighlight(0); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, list.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); if (list[highlight]) pick(list[highlight].value); }
          else if (e.key === 'Escape') { setOpen(false); (e.target as HTMLInputElement).blur(); }
        }}
        className="w-full border border-gray-300 rounded-lg pl-3 pr-8 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {value && !open ? (
        <button type="button" onClick={() => pick('')} title="Quitar"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-base leading-none">×</button>
      ) : (
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">▾</span>
      )}
      {open && (
        <div className="absolute z-40 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-lg">
          {list.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-gray-400">Sin resultados</p>
          ) : list.map((o, i) => (
            <button key={o.value || '__all'} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o.value)}
              onMouseEnter={() => setHighlight(i)}
              className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 ${i === highlight ? 'bg-blue-50' : ''} ${o.value === value ? 'font-semibold text-blue-700' : 'text-gray-700'}`}>
              <span className="truncate">{o.label}</span>
              {o.hint && <span className="text-xs text-gray-400 shrink-0">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';

// Buscador de productos por nombre o SKU (hasta 20 coincidencias por búsqueda), en vez de una
// lista desplegable con todo el catálogo: con miles de productos, cargarlos todos tardaba varios
// segundos y la lista era imposible de recorrer.
export default function ProductSearchPicker({ companyId, value, label, onChange }: {
  companyId?: string;
  value: string;
  label: string;
  onChange: (product: { id: string; label: string }) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<{ id: string; sku: string; name: string; stock: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || query.trim().length < 2) { setResults([]); return; }
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api.catalog.search({ search: query.trim(), companyId, pageSize: 20, page: 1 }, getToken()!)
        .then((r) => { if (alive) setResults(r.products || []); })
        .catch(() => { if (alive) setResults([]); })
        .finally(() => { if (alive) setLoading(false); });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [query, open, companyId]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div ref={boxRef} className="relative flex-1 min-w-[160px]">
      <input
        value={open ? query : label}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={value ? label : 'Buscar producto por nombre o SKU…'}
        required={!value}
        className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs bg-white"
      />
      {open && (
        <div className="absolute z-20 left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
          {query.trim().length < 2 ? (
            <p className="px-3 py-2 text-xs text-gray-400">Escribe al menos 2 letras del nombre o el SKU.</p>
          ) : loading ? (
            <p className="px-3 py-2 text-xs text-gray-400">Buscando…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400">Sin coincidencias.</p>
          ) : results.map((p) => (
            <button key={p.id} type="button"
              onClick={() => { onChange({ id: p.id, label: `${p.sku} — ${p.name}` }); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 border-b border-gray-50 last:border-0">
              <span className="font-mono text-gray-500">{p.sku}</span>
              <span className="text-gray-800"> — {p.name}</span>
              <span className="text-gray-400"> · stock {p.stock}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

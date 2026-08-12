'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { calcProfit, calcVeredicto, effectiveMyPrice, formatCLP } from '@/lib/profitability-calc';

const STATUS_LABELS: Record<string, string> = {
  CONFIRMADO: 'Confirmado',
  DUDOSO: 'Dudoso',
  RECHAZADO: 'Rechazado',
  NO_VERIFICADO: 'No verificado',
};
const STATUS_BADGE: Record<string, string> = {
  CONFIRMADO: 'bg-emerald-100 text-emerald-700',
  DUDOSO: 'bg-amber-100 text-amber-700',
  RECHAZADO: 'bg-red-100 text-red-700',
  NO_VERIFICADO: 'bg-gray-100 text-gray-500',
};
const STATUS_BAR: Record<string, string> = {
  CONFIRMADO: 'bg-emerald-500',
  DUDOSO: 'bg-amber-400',
  RECHAZADO: 'bg-red-400',
  NO_VERIFICADO: 'bg-gray-300',
};
const STATUS_ORDER = ['CONFIRMADO', 'DUDOSO', 'RECHAZADO', 'NO_VERIFICADO'];
const VEREDICTO_BADGE: Record<string, string> = {
  'PUBLICITAR': 'bg-[#1F5E47] text-white',
  'SUBIR': 'bg-emerald-100 text-emerald-700',
  'MARGEN BAJO': 'bg-amber-100 text-amber-700',
  'NO SUBIR': 'bg-red-100 text-red-700',
  'SIN PRECIO': 'bg-gray-100 text-gray-400',
};

type FilterChip = 'todos' | 'confirmados' | 'rentables' | 'dudosos' | 'pendientes' | 'ediciones';
type SortKey = 'name' | 'cost' | 'competitorPrice' | 'myPrice' | 'ganancia' | 'margen';

const FILTER_CHIPS: { key: FilterChip; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'confirmados', label: 'Confirmados' },
  { key: 'rentables', label: 'Solo rentables' },
  { key: 'dudosos', label: 'Dudosos' },
  { key: 'pendientes', label: 'Pendientes' },
  { key: 'ediciones', label: 'Mis ediciones' },
];

const emptyForm = {
  name: '', cost: '', competitorName: '', competitorPrice: '', competitorUrl: '',
  myDimensions: '', competitorDimensions: '', note: '',
};

// Input de precio con formateo de miles en vivo (es-CL) preservando la posición
// del cursor mientras se escribe. Solo acepta dígitos.
function PriceInput({ value, onCommit, disabled }: { value: number | null; onCommit: (v: number | null) => void; disabled?: boolean }) {
  // null = no se está editando; se muestra el valor formateado que viene del servidor.
  // Al enfocar se copia a texto editable; al salir del foco se descarta de nuevo.
  const [editingText, setEditingText] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const displayText = editingText !== null ? editingText : (value != null ? formatCLP(value) : '');

  function handleFocus() {
    setEditingText(value != null ? formatCLP(value) : '');
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const prevCursor = input.selectionStart ?? input.value.length;
    const digitsBeforeCursor = input.value.slice(0, prevCursor).replace(/\D/g, '').length;
    const rawDigits = input.value.replace(/\D/g, '');
    const formatted = rawDigits ? Number(rawDigits).toLocaleString('es-CL') : '';
    setEditingText(formatted);
    requestAnimationFrame(() => {
      if (!inputRef.current) return;
      let count = 0;
      let pos = formatted.length;
      if (digitsBeforeCursor === 0) {
        pos = 0;
      } else {
        for (let i = 0; i < formatted.length; i++) {
          if (/\d/.test(formatted[i])) count++;
          if (count === digitsBeforeCursor) { pos = i + 1; break; }
        }
      }
      inputRef.current.setSelectionRange(pos, pos);
    });
  }

  function handleBlur() {
    const digits = (editingText ?? '').replace(/\D/g, '');
    const parsed = digits ? Number(digits) : null;
    setEditingText(null);
    if (parsed !== value) onCommit(parsed);
  }

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      value={displayText}
      disabled={disabled}
      placeholder="—"
      onFocus={handleFocus}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={(e) => { if (e.key === 'Enter') inputRef.current?.blur(); }}
      className="w-24 px-2 py-1 border border-gray-300 rounded-md text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-[#1F5E47] disabled:bg-gray-50 disabled:text-gray-400"
    />
  );
}

function GananciaBar({ ganancia, max }: { ganancia: number | null; max: number }) {
  if (ganancia == null) return <div className="h-1.5 w-16 rounded-full bg-gray-100" />;
  const pct = max > 0 ? Math.min(100, (Math.abs(ganancia) / max) * 100) : 0;
  const color = ganancia < 3000 ? 'bg-red-400' : ganancia < 8000 ? 'bg-amber-400' : ganancia < 15000 ? 'bg-emerald-400' : 'bg-[#1F5E47]';
  return (
    <div className="h-1.5 w-16 rounded-full bg-gray-100 overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function RentabilidadPage() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [companies, setCompanies] = useState<any[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterChip>('todos');
  const [sortKey, setSortKey] = useState<SortKey>('ganancia');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(emptyForm);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const isAdmin = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'].includes(currentUser?.role);

  async function load() {
    const token = getToken();
    if (!token) return;
    if (isSuperAdmin && !selectedCompanyId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    try {
      const data = await api.profitability.list(token, isSuperAdmin ? selectedCompanyId : undefined);
      setItems(data);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const u = getUser();
    setCurrentUser(u);
    const token = getToken();
    if (token && u?.role === 'SUPER_ADMIN') api.companies.list(token).then(setCompanies).catch(() => {});
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, selectedCompanyId]);

  // Normaliza los Decimal (llegan como string desde la API) y precalcula ganancia/margen.
  const rows = useMemo(() => {
    return items.map((it) => {
      const cost = Number(it.cost);
      const competitorPrice = it.competitorPrice != null ? Number(it.competitorPrice) : null;
      const myPriceRaw = it.myPrice != null ? Number(it.myPrice) : null;
      const myPrice = effectiveMyPrice({ myPrice: myPriceRaw, manualPrice: it.manualPrice, competitorPrice });
      const { ganancia, margen } = calcProfit(myPrice, cost);
      const veredicto = calcVeredicto(ganancia);
      return { ...it, cost, competitorPrice, myPrice, ganancia, margen, veredicto };
    });
  }, [items]);

  // KPIs: solo productos CONFIRMADOS o que edité a mano (mi precio fijado manualmente).
  const kpiRows = useMemo(() => rows.filter((r) => r.status === 'CONFIRMADO' || r.manualPrice), [rows]);
  const kpis = useMemo(() => {
    const withProfit = kpiRows.filter((r) => r.ganancia != null);
    const best = withProfit.reduce((a: any, b: any) => (a == null || b.ganancia > a.ganancia ? b : a), null as any);
    return {
      best,
      publicitar: withProfit.filter((r) => r.ganancia! >= 15000).length,
      rentables: withProfit.filter((r) => r.ganancia! >= 8000).length,
      pierden: withProfit.filter((r) => r.ganancia! < 0).length,
    };
  }, [kpiRows]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { CONFIRMADO: 0, DUDOSO: 0, RECHAZADO: 0, NO_VERIFICADO: 0 };
    for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
    return counts;
  }, [rows]);
  const totalItems = rows.length;

  const filtered = useMemo(() => {
    let list = rows;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((r) => r.name.toLowerCase().includes(q) || (r.competitorName || '').toLowerCase().includes(q));
    }
    switch (filter) {
      case 'confirmados': list = list.filter((r) => r.status === 'CONFIRMADO'); break;
      case 'rentables': list = list.filter((r) => r.ganancia != null && r.ganancia >= 8000); break;
      case 'dudosos': list = list.filter((r) => r.status === 'DUDOSO'); break;
      case 'pendientes': list = list.filter((r) => r.status === 'NO_VERIFICADO'); break;
      case 'ediciones': list = list.filter((r) => r.manualPrice); break;
    }
    return list;
  }, [rows, search, filter]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a: any, b: any) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  const maxGanancia = useMemo(() => Math.max(1, ...rows.map((r) => Math.abs(r.ganancia ?? 0))), [rows]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  }

  async function patchItem(id: string, data: any) {
    const token = getToken()!;
    setRowError((e) => ({ ...e, [id]: '' }));
    try {
      const updated = await api.profitability.update(id, data, token);
      setItems((prev) => prev.map((it) => (it.id === id ? updated : it)));
    } catch (err: any) {
      setRowError((e) => ({ ...e, [id]: err.message || 'Error al guardar' }));
    }
  }

  async function handleDelete(item: any) {
    if (!confirm(`¿Eliminar "${item.name}" del comparador? Esta acción no se puede deshacer.`)) return;
    const token = getToken()!;
    try {
      await api.profitability.remove(item.id, token);
      setItems((prev) => prev.filter((it) => it.id !== item.id));
    } catch (err: any) {
      alert(err.message || 'Error al eliminar');
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError('');
    if (!createForm.name.trim() || !createForm.cost) { setCreateError('Nombre y costo son obligatorios'); return; }
    setCreateLoading(true);
    try {
      const token = getToken()!;
      const created = await api.profitability.create({
        name: createForm.name.trim(),
        cost: Number(createForm.cost.replace(/\D/g, '')),
        competitorName: createForm.competitorName.trim() || undefined,
        competitorPrice: createForm.competitorPrice ? Number(createForm.competitorPrice.replace(/\D/g, '')) : undefined,
        competitorUrl: createForm.competitorUrl.trim() || undefined,
        myDimensions: createForm.myDimensions.trim() || undefined,
        competitorDimensions: createForm.competitorDimensions.trim() || undefined,
        note: createForm.note.trim() || undefined,
        companyId: isSuperAdmin ? selectedCompanyId : undefined,
      }, token);
      setItems((prev) => [...prev, created]);
      setCreateForm(emptyForm);
      setShowCreate(false);
    } catch (err: any) {
      setCreateError(err.message || 'Error al crear producto');
    } finally {
      setCreateLoading(false);
    }
  }

  function exportCsv() {
    const header = ['Producto', 'Medidas propias', 'Tu costo', 'Competidor', 'Medidas competidor', 'Su precio', 'Mi precio', 'Ganancia', 'Margen %', 'Verificación', 'Nota', 'Editado'];
    const csvRows = [header];
    for (const r of rows) {
      csvRows.push([
        r.name, r.myDimensions || '', String(r.cost), r.competitorName || '', r.competitorDimensions || '',
        r.competitorPrice != null ? String(r.competitorPrice) : '', r.myPrice != null ? String(r.myPrice) : '',
        r.ganancia != null ? String(r.ganancia) : '', r.margen != null ? r.margen.toFixed(1) : '',
        STATUS_LABELS[r.status] || r.status, r.note || '', r.manualPrice ? 'Sí' : 'No',
      ]);
    }
    const csv = csvRows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const BOM = String.fromCharCode(0xFEFF);
    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rentabilidad_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const investigar = {
    DUDOSO: rows.filter((r) => r.status === 'DUDOSO'),
    RECHAZADO: rows.filter((r) => r.status === 'RECHAZADO'),
    NO_VERIFICADO: rows.filter((r) => r.status === 'NO_VERIFICADO'),
  };

  return (
    <div className="max-w-[1400px]">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 font-serif">Rentabilidad por producto</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Compara tu costo contra el precio de la competencia, con IVA y comisión reales, para decidir qué subir, publicitar o descartar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isSuperAdmin && (
            <select
              value={selectedCompanyId}
              onChange={(e) => setSelectedCompanyId(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white font-medium"
            >
              <option value="">— Selecciona una empresa —</option>
              {companies.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {rows.length > 0 && (
            <button onClick={exportCsv} className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50">
              Descargar CSV
            </button>
          )}
          {isAdmin && (!isSuperAdmin || selectedCompanyId) && (
            <button
              onClick={() => { setShowCreate(true); setCreateForm(emptyForm); setCreateError(''); }}
              className="px-4 py-2 bg-[#1F5E47] text-white rounded-lg text-sm font-medium hover:bg-[#18493788]"
            >
              + Nuevo producto
            </button>
          )}
        </div>
      </div>

      {isSuperAdmin && !selectedCompanyId ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 px-4 py-12 text-center text-gray-400 text-sm">
          <p className="text-3xl mb-2">📊</p>
          <p>Selecciona una empresa arriba para ver su comparador de rentabilidad.</p>
        </div>
      ) : loading ? (
        <div className="px-4 py-10 text-center text-gray-400 text-sm">Cargando...</div>
      ) : (
      <>
        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Mejor producto</p>
            <p className="text-lg font-bold text-gray-900 font-serif tabular-nums mt-1 truncate" title={kpis.best?.name}>
              {kpis.best ? `$${formatCLP(kpis.best.ganancia)}` : '—'}
            </p>
            <p className="text-xs text-gray-500 truncate">{kpis.best?.name || 'Sin datos confirmados aún'}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Para publicitar</p>
            <p className="text-2xl font-bold text-[#1F5E47] font-serif tabular-nums mt-1">{kpis.publicitar}</p>
            <p className="text-xs text-gray-500">Ganancia ≥ $15.000</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Rentables</p>
            <p className="text-2xl font-bold text-emerald-600 font-serif tabular-nums mt-1">{kpis.rentables}</p>
            <p className="text-xs text-gray-500">Ganancia ≥ $8.000</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Pierden plata</p>
            <p className="text-2xl font-bold text-red-600 font-serif tabular-nums mt-1">{kpis.pierden}</p>
            <p className="text-xs text-gray-500">Ganancia negativa</p>
          </div>
        </div>

        {/* Barra de estado de verificación */}
        {totalItems > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Estado de verificación</p>
            <div className="h-3 w-full rounded-full overflow-hidden flex bg-gray-100">
              {STATUS_ORDER.map((s) => (
                statusCounts[s] > 0 && (
                  <div key={s} className={STATUS_BAR[s]} style={{ width: `${(statusCounts[s] / totalItems) * 100}%` }} title={`${STATUS_LABELS[s]}: ${statusCounts[s]}`} />
                )
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
              {STATUS_ORDER.map((s) => (
                <span key={s} className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span className={`w-2.5 h-2.5 rounded-full ${STATUS_BAR[s]}`} />
                  {STATUS_LABELS[s]} ({statusCounts[s]})
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Buscador + filtros */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre..."
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-[#1F5E47]"
          />
          <div className="flex flex-wrap gap-1.5">
            {FILTER_CHIPS.map((c) => (
              <button
                key={c.key}
                onClick={() => setFilter(c.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
                  filter === c.key ? 'bg-[#1F5E47] text-white border-[#1F5E47]' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tabla principal */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto mb-6">
          {sorted.length === 0 ? (
            <div className="px-4 py-12 text-center text-gray-400">
              <div className="text-4xl mb-3">📦</div>
              <p className="text-sm font-medium mb-1">Sin productos</p>
              <p className="text-xs">{items.length === 0 ? 'Crea el primer producto para empezar a comparar.' : 'Ningún producto coincide con el filtro actual.'}</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th onClick={() => toggleSort('name')} className="text-left px-4 py-3 text-gray-600 font-medium cursor-pointer select-none whitespace-nowrap">
                    Producto {sortKey === 'name' && (sortDir === 'asc' ? '▲' : '▼')}
                  </th>
                  <th onClick={() => toggleSort('cost')} className="text-right px-4 py-3 text-gray-600 font-medium cursor-pointer select-none whitespace-nowrap">
                    Tu costo {sortKey === 'cost' && (sortDir === 'asc' ? '▲' : '▼')}
                  </th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium whitespace-nowrap">Competidor</th>
                  <th onClick={() => toggleSort('competitorPrice')} className="text-right px-4 py-3 text-gray-600 font-medium cursor-pointer select-none whitespace-nowrap">
                    Su precio {sortKey === 'competitorPrice' && (sortDir === 'asc' ? '▲' : '▼')}
                  </th>
                  <th onClick={() => toggleSort('myPrice')} className="text-right px-4 py-3 text-gray-600 font-medium cursor-pointer select-none whitespace-nowrap">
                    Mi precio {sortKey === 'myPrice' && (sortDir === 'asc' ? '▲' : '▼')}
                  </th>
                  <th onClick={() => toggleSort('ganancia')} className="text-right px-4 py-3 text-gray-600 font-medium cursor-pointer select-none whitespace-nowrap">
                    Ganancia {sortKey === 'ganancia' && (sortDir === 'asc' ? '▲' : '▼')}
                  </th>
                  <th onClick={() => toggleSort('margen')} className="text-right px-4 py-3 text-gray-600 font-medium cursor-pointer select-none whitespace-nowrap">
                    Margen % {sortKey === 'margen' && (sortDir === 'asc' ? '▲' : '▼')}
                  </th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium whitespace-nowrap">Veredicto</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium whitespace-nowrap">Verificación</th>
                  {isAdmin && <th className="px-4 py-3"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map((r) => (
                  <tr key={r.id} className={r.manualPrice ? 'bg-amber-50/60 hover:bg-amber-50' : 'hover:bg-gray-50'}>
                    <td className="px-4 py-3 align-top">
                      <p className="font-medium text-gray-900">{r.name}</p>
                      {r.myDimensions && <p className="text-xs text-gray-400 mt-0.5">{r.myDimensions}</p>}
                      {rowError[r.id] && <p className="text-xs text-red-600 mt-0.5">{rowError[r.id]}</p>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700 align-top">${formatCLP(r.cost)}</td>
                    <td className="px-4 py-3 align-top">
                      {r.competitorName ? (
                        r.competitorUrl ? (
                          <a href={r.competitorUrl} target="_blank" rel="noreferrer" className="text-[#1F5E47] hover:underline font-medium">{r.competitorName}</a>
                        ) : <span className="text-gray-700">{r.competitorName}</span>
                      ) : <span className="text-gray-300">—</span>}
                      {r.competitorDimensions && <p className="text-xs text-gray-400 mt-0.5">{r.competitorDimensions}</p>}
                    </td>
                    <td className="px-4 py-3 text-right align-top">
                      <PriceInput
                        value={r.competitorPrice}
                        disabled={!isAdmin}
                        onCommit={(v) => patchItem(r.id, { competitorPrice: v })}
                      />
                    </td>
                    <td className="px-4 py-3 text-right align-top">
                      <PriceInput
                        value={r.myPrice}
                        disabled={!isAdmin}
                        onCommit={(v) => patchItem(r.id, { myPrice: v })}
                      />
                    </td>
                    <td className="px-4 py-3 text-right align-top">
                      <div className="flex flex-col items-end gap-1">
                        <span className={`tabular-nums font-semibold ${r.ganancia == null ? 'text-gray-300' : r.ganancia < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                          {r.ganancia != null ? `$${formatCLP(r.ganancia)}` : '—'}
                        </span>
                        <GananciaBar ganancia={r.ganancia} max={maxGanancia} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-500 align-top">
                      {r.margen != null ? `${r.margen.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${VEREDICTO_BADGE[r.veredicto]}`}>{r.veredicto}</span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <select
                        value={r.status}
                        disabled={!isAdmin}
                        onChange={(e) => patchItem(r.id, { status: e.target.value })}
                        className={`text-xs font-medium rounded-full px-2 py-1 border-0 focus:outline-none focus:ring-2 focus:ring-[#1F5E47] disabled:opacity-60 ${STATUS_BADGE[r.status]}`}
                      >
                        {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                      </select>
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-right align-top">
                        <button onClick={() => handleDelete(r)} className="text-xs text-red-400 hover:text-red-600 font-medium">Eliminar</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Para investigar a mano */}
        {(investigar.DUDOSO.length > 0 || investigar.RECHAZADO.length > 0 || investigar.NO_VERIFICADO.length > 0) && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Para investigar a mano</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(['DUDOSO', 'RECHAZADO', 'NO_VERIFICADO'] as const).map((s) => (
                <div key={s} className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-xs font-semibold flex items-center gap-1.5 mb-2">
                    <span className={`w-2 h-2 rounded-full ${STATUS_BAR[s]}`} />
                    {STATUS_LABELS[s]} ({investigar[s].length})
                  </p>
                  {investigar[s].length === 0 ? (
                    <p className="text-xs text-gray-300">Ninguno</p>
                  ) : (
                    <ul className="space-y-2 max-h-64 overflow-y-auto">
                      {investigar[s].map((r: any) => (
                        <li key={r.id} className="text-xs border-b border-gray-100 pb-2 last:border-0 last:pb-0">
                          <p className="font-medium text-gray-800">{r.name}</p>
                          <p className="text-gray-400">Costo: ${formatCLP(r.cost)}</p>
                          {r.note && <p className="text-gray-500 mt-0.5">{r.note}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pie */}
        <p className="text-xs text-gray-400 leading-relaxed border-t border-gray-100 pt-4">
          Ganancia = precio de venta − costo − IVA a pagar (débito de tu venta menos crédito fiscal de tu compra, ambos con IVA 19%) − comisión (6,8%, Shopify + Mercado Pago).
          No descuenta despacho ni publicidad. &ldquo;Mi precio&rdquo; sugiere por defecto (precio del competidor − $1.000) hasta que lo edites a mano; a partir de ahí queda fijo aunque cambie el precio de la competencia.
          Los datos se guardan en la base de datos de tu empresa, no en este navegador.
        </p>
      </>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
              <h2 className="font-bold text-gray-900 font-serif">Nuevo producto</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <form onSubmit={handleCreate} className="overflow-y-auto">
              <div className="px-6 py-5 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Nombre (mi catálogo) *</label>
                    <input value={createForm.name} onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                      required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Tu costo (con IVA) *</label>
                    <input value={createForm.cost} onChange={(e) => setCreateForm((f) => ({ ...f, cost: e.target.value.replace(/\D/g, '') }))}
                      required inputMode="numeric" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Tus medidas</label>
                    <input value={createForm.myDimensions} onChange={(e) => setCreateForm((f) => ({ ...f, myDimensions: e.target.value }))}
                      placeholder="ancho/prof/alto/asiento" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Producto competidor</label>
                    <input value={createForm.competitorName} onChange={(e) => setCreateForm((f) => ({ ...f, competitorName: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Su precio (con IVA)</label>
                    <input value={createForm.competitorPrice} onChange={(e) => setCreateForm((f) => ({ ...f, competitorPrice: e.target.value.replace(/\D/g, '') }))}
                      inputMode="numeric" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Medidas competidor</label>
                    <input value={createForm.competitorDimensions} onChange={(e) => setCreateForm((f) => ({ ...f, competitorDimensions: e.target.value }))}
                      placeholder="ancho/prof/alto/asiento" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Link ficha competidor</label>
                    <input value={createForm.competitorUrl} onChange={(e) => setCreateForm((f) => ({ ...f, competitorUrl: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Nota</label>
                    <textarea value={createForm.note} onChange={(e) => setCreateForm((f) => ({ ...f, note: e.target.value }))}
                      rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                </div>
                {createError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{createError}</p>}
              </div>
              <div className="px-6 py-4 border-t border-gray-100 flex gap-2 justify-end">
                <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                  Cancelar
                </button>
                <button type="submit" disabled={createLoading} className="px-4 py-2 bg-[#1F5E47] hover:bg-[#184937] disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
                  {createLoading ? 'Creando...' : 'Crear producto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

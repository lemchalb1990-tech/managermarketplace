'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type ProductionProcess, type SpecField } from '@/lib/api';
import { getToken } from '@/lib/auth';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white disabled:bg-gray-50 disabled:text-gray-400';

export const SUPPLY_LABEL: Record<string, string> = {
  STOCK: 'Inventario',
  MADE_TO_ORDER: 'Fabricación a pedido',
  MADE_FOR_STOCK: 'Fabricación para stock',
};

// Campos de fabricación del formulario (estado del formulario del catálogo).
// Forma de los campos de fabricación dentro del formulario del catálogo.
export type ProductionForm = {
  type?: string; supplyMode?: string; requiresProcess?: boolean; manufacturingDays?: string;
  productionProcessId?: string; specFields?: SpecField[]; advancePercent?: string;
};
type ProductLike = {
  supplyMode?: string | null; requiresProcess?: boolean | null; manufacturingDays?: number | null;
  productionProcessId?: string | null; specFields?: unknown; advancePercent?: number | null;
};

export const emptyProductionForm = { supplyMode: 'STOCK', requiresProcess: false, manufacturingDays: '', productionProcessId: '', specFields: [] as SpecField[], advancePercent: '' };

export function productionFormFrom(p: ProductLike | null | undefined) {
  return {
    supplyMode: p?.supplyMode || 'STOCK',
    requiresProcess: !!p?.requiresProcess,
    manufacturingDays: p?.manufacturingDays != null ? String(p.manufacturingDays) : '',
    productionProcessId: p?.productionProcessId || '',
    specFields: (p?.specFields as SpecField[]) || [],
    advancePercent: p?.advancePercent != null ? String(p.advancePercent) : '',
  };
}

export function productionPayload(f: ProductionForm) {
  return {
    supplyMode: f.type === 'SERVICIO' ? 'STOCK' : (f.supplyMode || 'STOCK'),
    requiresProcess: f.type === 'SERVICIO' ? !!f.requiresProcess : false,
    manufacturingDays: f.manufacturingDays !== '' && f.manufacturingDays != null ? Math.max(0, parseInt(f.manufacturingDays)) : null,
    productionProcessId: f.productionProcessId || null,
    specFields: (f.specFields || []).filter((s: SpecField) => s.label?.trim()),
    advancePercent: f.advancePercent !== '' && f.advancePercent != null ? Math.max(0, Math.min(100, parseInt(f.advancePercent))) : null,
  };
}

/** Bloque «Fabricación» de la ficha del producto (solo con el módulo activo). */
export function ProductionFields({ form, setForm, productId, companyId, editable }: {
  form: ProductionForm; setForm: (fn: (f: ProductionForm) => ProductionForm) => void; productId?: string | null; companyId?: string; editable: boolean;
}) {
  const [processes, setProcesses] = useState<ProductionProcess[]>([]);
  useEffect(() => {
    const t = getToken();
    if (!t) return;
    api.production.processes(t, companyId).then((p) => setProcesses(p.filter((x) => x.active))).catch(() => setProcesses([]));
  }, [companyId]);

  const isService = form.type === 'SERVICIO';
  const withProcess = isService ? !!form.requiresProcess : form.supplyMode && form.supplyMode !== 'STOCK';
  const set = (patch: Partial<ProductionForm>) => setForm((f) => ({ ...f, ...patch }));
  const specs: SpecField[] = form.specFields || [];
  const setSpec = (i: number, patch: Partial<SpecField>) => set({ specFields: specs.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  return (
    <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500">Fabricación</p>
      {isService ? (
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={!!form.requiresProcess} disabled={!editable} onChange={(e) => set({ requiresProcess: e.target.checked })} className="mt-0.5 accent-blue-600" />
          <span>Requiere proceso <span className="block text-xs text-gray-500">Reparación, instalación, tapizado… Cada venta abre una orden de fabricación con su proceso.</span></span>
        </label>
      ) : (
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Abastecimiento</label>
          <select value={form.supplyMode || 'STOCK'} disabled={!editable} onChange={(e) => set({ supplyMode: e.target.value })} className={inputCls}>
            <option value="STOCK">Inventario: se compra y se vende del stock</option>
            <option value="MADE_TO_ORDER">Fabricación a pedido: se vende sin stock y cada venta abre una orden</option>
            <option value="MADE_FOR_STOCK">Fabricación para stock: se fabrica por lotes que suman stock</option>
          </select>
          {form.supplyMode === 'MADE_TO_ORDER' && (
            <p className="mt-1 text-[11px] text-gray-500">El stock no se descuenta al vender: úsalo como los cupos que publicas en los canales.</p>
          )}
        </div>
      )}

      {withProcess && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-1">
              <label className="mb-1 block text-xs font-medium text-gray-600">Proceso</label>
              <select value={form.productionProcessId || ''} disabled={!editable} onChange={(e) => set({ productionProcessId: e.target.value })} className={inputCls}>
                <option value="">Sin proceso</option>
                {processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {processes.length === 0 && <p className="mt-1 text-[11px] text-gray-500">Crea procesos en <Link href="/dashboard/fabricacion/configuracion" className="underline">Procesos y áreas</Link>.</p>}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Días de fabricación</label>
              <input type="number" min="0" value={form.manufacturingDays ?? ''} disabled={!editable} onChange={(e) => set({ manufacturingDays: e.target.value })} placeholder="Según el proceso" className={inputCls} />
            </div>
            {form.supplyMode !== 'MADE_FOR_STOCK' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Anticipo sugerido (%)</label>
                <input type="number" min="0" max="100" value={form.advancePercent ?? ''} disabled={!editable} onChange={(e) => set({ advancePercent: e.target.value })} placeholder="Ej.: 50" className={inputCls} />
              </div>
            )}
          </div>

          {form.supplyMode !== 'MADE_FOR_STOCK' && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-medium text-gray-600">Especificaciones a pedir al vender</label>
                {editable && <button type="button" onClick={() => set({ specFields: [...specs, { key: '', label: '', type: 'text', required: false }] })} className="text-xs font-semibold text-blue-600 hover:underline">+ Agregar campo</button>}
              </div>
              {specs.length === 0 && <p className="text-[11px] text-gray-500">Ej.: Medidas, Tela, Color, Archivo de diseño. El vendedor las completa al cobrar y el cliente las ve en su seguimiento.</p>}
              <div className="space-y-2">
                {specs.map((s, i) => (
                  <div key={i} className="grid grid-cols-12 items-center gap-2">
                    <input value={s.label} disabled={!editable} onChange={(e) => setSpec(i, { label: e.target.value })} placeholder="Nombre del campo" className={`${inputCls} col-span-5`} />
                    <select value={s.type || 'text'} disabled={!editable} onChange={(e) => setSpec(i, { type: e.target.value as SpecField['type'] })} className={`${inputCls} col-span-3`}>
                      <option value="text">Texto</option>
                      <option value="textarea">Texto largo</option>
                      <option value="number">Número</option>
                      <option value="select">Opciones</option>
                    </select>
                    <label className="col-span-3 flex items-center gap-1 text-xs text-gray-600">
                      <input type="checkbox" checked={!!s.required} disabled={!editable} onChange={(e) => setSpec(i, { required: e.target.checked })} className="accent-blue-600" /> Obligatorio
                    </label>
                    {editable && <button type="button" onClick={() => set({ specFields: specs.filter((_, j) => j !== i) })} className="col-span-1 text-red-400 hover:text-red-600" aria-label="Quitar campo">✕</button>}
                    {s.type === 'select' && (
                      <input value={(s.options || []).join(', ')} disabled={!editable} onChange={(e) => setSpec(i, { options: e.target.value.split(',').map((o) => o.trimStart()) })}
                        placeholder="Opciones separadas por coma (Gris, Azul, Beige)" className={`${inputCls} col-span-11`} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {productId ? <BomEditor productId={productId} companyId={companyId} editable={editable} processes={processes} processId={form.productionProcessId} />
            : <p className="text-[11px] text-gray-500">La lista de materiales se arma después de crear el producto.</p>}
        </>
      )}
    </div>
  );
}

type BomRow = { materialId: string; name: string; sku: string; quantity: string; stageName: string; cost: number | null };

function BomEditor({ productId, companyId, editable, processes, processId }: { productId: string; companyId?: string; editable: boolean; processes: ProductionProcess[]; processId?: string }) {
  const [rows, setRows] = useState<BomRow[]>([]);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Array<{ id: string; name: string; sku: string; cost?: number | null }>>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const stages = processes.find((p) => p.id === processId)?.stages || [];

  useEffect(() => {
    const t = getToken();
    if (!t) return;
    api.production.materials(productId, t)
      .then((list) => setRows(list.map((m) => ({ materialId: m.materialId, name: m.material.name, sku: m.material.sku, quantity: String(m.quantity), stageName: m.stageName || '', cost: m.material.cost }))))
      .catch(() => setRows([]));
  }, [productId]);

  useEffect(() => {
    const t = getToken();
    if (!t || q.trim().length < 2) return;
    const h = setTimeout(() => {
      api.catalog.search({ search: q.trim(), pageSize: 8, companyId, type: 'ARTICULO' }, t)
        .then((r) => setResults(r.products.filter((p: { id: string }) => p.id !== productId))).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(h);
  }, [q, companyId, productId]);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api.production.setMaterials(productId, rows.map((r) => ({ materialId: r.materialId, quantity: Number(r.quantity), stageName: r.stageName || null })), getToken()!);
      setMsg({ ok: true, text: 'Lista de materiales guardada' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const unitCost = rows.reduce((s, r) => s + (Number(r.quantity) || 0) * Number(r.cost || 0), 0);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-xs font-medium text-gray-600">Lista de materiales (por unidad)</label>
        {unitCost > 0 && <span className="text-[11px] text-gray-500">Costo de materiales: ${Math.round(unitCost).toLocaleString('es-CL')}</span>}
      </div>
      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={r.materialId} className="grid grid-cols-12 items-center gap-2 text-sm">
            <span className="col-span-5 truncate" title={r.name}>{r.name} <span className="text-[11px] text-gray-400">{r.sku}</span></span>
            <input type="number" min="0.001" step="any" value={r.quantity} disabled={!editable}
              onChange={(e) => setRows((l) => l.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} className={`${inputCls} col-span-2`} aria-label="Cantidad" />
            <select value={r.stageName} disabled={!editable} onChange={(e) => setRows((l) => l.map((x, j) => (j === i ? { ...x, stageName: e.target.value } : x)))} className={`${inputCls} col-span-4`}>
              <option value="">Se usa al iniciar</option>
              {stages.map((s) => <option key={s.name} value={s.name}>En «{s.name}»</option>)}
            </select>
            {editable && <button type="button" onClick={() => setRows((l) => l.filter((_, j) => j !== i))} className="col-span-1 text-red-400 hover:text-red-600" aria-label="Quitar material">✕</button>}
          </div>
        ))}
      </div>
      {editable && (
        <div className="relative mt-2">
          <input value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value.trim().length < 2) setResults([]); }} placeholder="Agregar insumo: buscar por nombre o SKU…" className={inputCls} />
          {results.length > 0 && (
            <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
              {results.filter((r) => !rows.some((x) => x.materialId === r.id)).map((r) => (
                <button key={r.id} type="button" onClick={() => { setRows((l) => [...l, { materialId: r.id, name: r.name, sku: r.sku, quantity: '1', stageName: '', cost: r.cost != null ? Number(r.cost) : null }]); setQ(''); setResults([]); }}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50">{r.name} <span className="text-xs text-gray-400">{r.sku}</span></button>
              ))}
            </div>
          )}
        </div>
      )}
      {editable && (
        <div className="mt-2 flex items-center gap-3">
          <button type="button" onClick={save} disabled={busy} className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">{busy ? 'Guardando…' : 'Guardar lista de materiales'}</button>
          {msg && <span className={`text-xs ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</span>}
        </div>
      )}
    </div>
  );
}

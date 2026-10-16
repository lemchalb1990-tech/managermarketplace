'use client';

import { useEffect, useState } from 'react';
import { api, type ProductionKind, type ProductionOrderStatus, type ProductionProcess, type ProductionStageStatus, type SpecField } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { Modal, btnPrimary, btnSecondary, inputCls, labelCls, FormError } from '@/components/ui/Modal';

export const ORDER_STATUS_LABEL: Record<ProductionOrderStatus, string> = {
  PENDING: 'Por iniciar',
  IN_PROGRESS: 'En proceso',
  WAITING_APPROVAL: 'Esperando aprobación',
  ON_HOLD: 'En pausa',
  DONE: 'Terminada',
  CANCELLED: 'Anulada',
};

export const ORDER_STATUS_CLS: Record<ProductionOrderStatus, string> = {
  PENDING: 'bg-gray-100 text-gray-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  WAITING_APPROVAL: 'bg-amber-100 text-amber-800',
  ON_HOLD: 'bg-orange-100 text-orange-700',
  DONE: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-50 text-red-600',
};

export const STAGE_STATUS_LABEL: Record<ProductionStageStatus, string> = {
  PENDING: 'Pendiente',
  IN_PROGRESS: 'En curso',
  WAITING_APPROVAL: 'Esperando al cliente',
  DONE: 'Lista',
  SKIPPED: 'Omitida',
};

export const STAGE_STATUS_CLS: Record<ProductionStageStatus, string> = {
  PENDING: 'bg-gray-100 text-gray-600',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  WAITING_APPROVAL: 'bg-amber-100 text-amber-800',
  DONE: 'bg-green-100 text-green-700',
  SKIPPED: 'bg-gray-100 text-gray-400',
};

export const KIND_LABEL: Record<ProductionKind, string> = {
  MADE_TO_ORDER: 'A pedido',
  FOR_STOCK: 'Para stock',
  REPAIR: 'Reparación',
};

export const KIND_CLS: Record<ProductionKind, string> = {
  MADE_TO_ORDER: 'bg-indigo-50 text-indigo-700',
  FOR_STOCK: 'bg-teal-50 text-teal-700',
  REPAIR: 'bg-purple-50 text-purple-700',
};

export const PRIORITY_LABEL = ['Normal', 'Alta', 'Urgente'];

export const fmtCLP = (n: number | null | undefined) => `$${Math.round(Number(n || 0)).toLocaleString('es-CL')}`;
export const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' }) : '—');
export const fmtDateTime = (d: string | null | undefined) => (d ? new Date(d).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const ofNumber = (n: number) => `OF-${String(n).padStart(4, '0')}`;

export function Badge({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}

// Link público de seguimiento del cliente.
export const trackingUrl = (token: string) => (typeof window !== 'undefined' ? `${window.location.origin}/seguimiento/${token}` : `/seguimiento/${token}`);

// Teléfono chileno para wa.me: solo dígitos y con 56 adelante.
export function waPhone(phone?: string | null): string {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('56')) return d;
  if (d.length === 9) return `56${d}`;
  return d;
}

/** Campos de especificación (los mismos en el POS, al crear una orden y en el detalle). */
export function SpecInputs({ fields, value, onChange, compact }: { fields: SpecField[]; value: Record<string, string>; onChange: (v: Record<string, string>) => void; compact?: boolean }) {
  return (
    <div className={`grid grid-cols-1 gap-2 ${compact ? '' : 'sm:grid-cols-2'}`}>
      {fields.map((f) => {
        const set = (v: string) => onChange({ ...value, [f.key]: v });
        const label = <label className={labelCls}>{f.label}{f.required && <span className="text-red-500"> *</span>}</label>;
        if (f.type === 'select') {
          return (
            <div key={f.key}>
              {label}
              <select value={value[f.key] || ''} onChange={(e) => set(e.target.value)} className={inputCls}>
                <option value="">Elegir…</option>
                {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          );
        }
        if (f.type === 'textarea') {
          return (
            <div key={f.key} className={compact ? '' : 'sm:col-span-2'}>
              {label}
              <textarea value={value[f.key] || ''} onChange={(e) => set(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
            </div>
          );
        }
        return (
          <div key={f.key}>
            {label}
            <input type={f.type === 'number' ? 'number' : 'text'} value={value[f.key] || ''} onChange={(e) => set(e.target.value)} className={inputCls} />
          </div>
        );
      })}
    </div>
  );
}

export function missingRequiredSpecs(fields: SpecField[] | null | undefined, value: Record<string, string> | undefined): string[] {
  return (fields || []).filter((f) => f.required && !String(value?.[f.key] ?? '').trim()).map((f) => f.label);
}

const REPAIR_FIELDS: SpecField[] = [
  { key: 'equipo', label: 'Equipo', required: true },
  { key: 'marca', label: 'Marca' },
  { key: 'modelo', label: 'Modelo' },
  { key: 'serie', label: 'N° de serie' },
  { key: 'falla', label: 'Falla informada', type: 'textarea', required: true },
  { key: 'accesorios', label: 'Accesorios recibidos' },
  { key: 'estado', label: 'Estado al recibir', type: 'textarea' },
];
export { REPAIR_FIELDS };

type CatalogPick = { id: string; name: string; sku: string; type?: string; warehouseId?: string | null; productionProcessId?: string | null; specFields?: SpecField[] | null };

/** Crear una orden de fabricación a mano: para un cliente, lote para stock o reparación. */
export function NewOrderModal({ companyId, onClose, onCreated }: { companyId?: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [kind, setKind] = useState<ProductionKind>('MADE_TO_ORDER');
  const [processes, setProcesses] = useState<ProductionProcess[]>([]);
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);
  const [productQuery, setProductQuery] = useState('');
  const [products, setProducts] = useState<CatalogPick[]>([]);
  const [product, setProduct] = useState<CatalogPick | null>(null);
  const [form, setForm] = useState({ productName: '', quantity: '1', processId: '', customerName: '', customerPhone: '', customerEmail: '', dueDate: '', warehouseId: '', notes: '', priority: '0' });
  const [specs, setSpecs] = useState<Record<string, string>>({});
  const [repair, setRepair] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = getToken();
    if (!t) return;
    api.production.processes(t, companyId).then((p) => setProcesses(p.filter((x) => x.active))).catch(() => {});
    api.warehouses.list(t, companyId).then((w: Array<{ id: string; name: string; active?: boolean }>) => setWarehouses((w || []).filter((x) => x.active !== false))).catch(() => {});
  }, [companyId]);

  useEffect(() => {
    const t = getToken();
    if (!t || productQuery.trim().length < 2 || product) return;
    const h = setTimeout(() => {
      api.catalog.search({ search: productQuery.trim(), pageSize: 8, companyId, active: 'true', ...(kind === 'FOR_STOCK' ? { type: 'ARTICULO' } : {}) }, t)
        .then((r) => setProducts(r.products)).catch(() => setProducts([]));
    }, 300);
    return () => clearTimeout(h);
  }, [productQuery, product, companyId, kind]);

  function pick(p: CatalogPick) {
    setProduct(p);
    setProductQuery(p.name);
    setProducts([]);
    setForm((f) => ({ ...f, processId: p.productionProcessId || f.processId, warehouseId: p.warehouseId || f.warehouseId }));
  }

  const isRepair = kind === 'REPAIR' || !!processes.find((p) => p.id === form.processId)?.isRepair;
  const specFields: SpecField[] = product?.specFields || [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (kind === 'FOR_STOCK' && !product) { setError('Elige el producto del lote'); return; }
    if (!product && !form.productName.trim()) { setError('Indica qué se fabrica o repara'); return; }
    const miss = [...missingRequiredSpecs(specFields, specs), ...(isRepair ? missingRequiredSpecs(REPAIR_FIELDS, repair) : [])];
    if (miss.length) { setError(`Completa: ${miss.join(', ')}`); return; }
    setBusy(true);
    try {
      const r = await api.production.create({
        companyId, kind,
        productId: product?.id || null,
        productName: product ? undefined : form.productName.trim(),
        quantity: Number(form.quantity) || 1,
        processId: form.processId || null,
        customerName: form.customerName || null, customerPhone: form.customerPhone || null, customerEmail: form.customerEmail || null,
        dueDate: form.dueDate || null,
        warehouseId: form.warehouseId || null,
        notes: form.notes || null,
        priority: Number(form.priority) || 0,
        specs: Object.keys(specs).length ? specs : null,
        repairInfo: isRepair ? repair : null,
      }, getToken()!);
      onCreated(r.id);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Modal title="Nueva orden de fabricación" size="lg" busy={busy} onClose={onClose} onSubmit={submit}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className={btnSecondary}>Cancelar</button>
          <button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Creando…' : 'Crear orden'}</button>
        </>
      )}>
      <div className="space-y-4">
        <div role="radiogroup" className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1 text-xs font-semibold">
          {(Object.keys(KIND_LABEL) as ProductionKind[]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => { setKind(k); setProduct(null); setProductQuery(''); }}
              className={`rounded-md py-1.5 ${kind === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              {k === 'MADE_TO_ORDER' ? 'Para un cliente' : k === 'FOR_STOCK' ? 'Lote para stock' : 'Reparación'}
            </button>
          ))}
        </div>

        <div className="relative">
          <label className={labelCls}>{kind === 'FOR_STOCK' ? 'Producto a fabricar' : 'Producto del catálogo (opcional)'}</label>
          <input value={productQuery} onChange={(e) => { setProductQuery(e.target.value); setProduct(null); if (e.target.value.trim().length < 2) setProducts([]); }} placeholder="Buscar por nombre o SKU…" className={inputCls} />
          {products.length > 0 && (
            <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
              {products.map((p) => (
                <button key={p.id} type="button" onClick={() => pick(p)} className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50">
                  {p.name} <span className="text-xs text-gray-400">{p.sku}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {!product && kind !== 'FOR_STOCK' && (
          <div>
            <label className={labelCls}>{kind === 'REPAIR' ? 'Qué se repara' : 'Qué se fabrica'}</label>
            <input value={form.productName} onChange={set('productName')} placeholder={kind === 'REPAIR' ? 'Ej.: Sofá 3 cuerpos — retapizado' : 'Ej.: Mesa de comedor a medida'} className={inputCls} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className={labelCls}>Cantidad</label>
            <input type="number" min="1" value={form.quantity} onChange={set('quantity')} className={inputCls} />
          </div>
          <div className="col-span-1 sm:col-span-2">
            <label className={labelCls}>Proceso</label>
            <select value={form.processId} onChange={set('processId')} className={inputCls}>
              <option value="">Sin proceso (solo seguimiento)</option>
              {processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Prioridad</label>
            <select value={form.priority} onChange={set('priority')} className={inputCls}>
              {PRIORITY_LABEL.map((l, i) => <option key={l} value={i}>{l}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Fecha comprometida</label>
            <input type="date" value={form.dueDate} onChange={set('dueDate')} className={inputCls} />
            <p className="mt-0.5 text-[11px] text-gray-400">Vacía: se calcula con los días del proceso.</p>
          </div>
          {kind === 'FOR_STOCK' && (
            <div>
              <label className={labelCls}>Bodega de destino</label>
              <select value={form.warehouseId} onChange={set('warehouseId')} className={inputCls}>
                <option value="">Bodega del producto</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          )}
        </div>

        {kind !== 'FOR_STOCK' && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-gray-800">Cliente</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <input value={form.customerName} onChange={set('customerName')} placeholder="Nombre" className={inputCls} />
              <input value={form.customerPhone} onChange={set('customerPhone')} placeholder="Teléfono" className={inputCls} />
              <input value={form.customerEmail} onChange={set('customerEmail')} placeholder="Correo" type="email" className={inputCls} />
            </div>
          </section>
        )}

        {specFields.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-gray-800">Especificaciones</h3>
            <SpecInputs fields={specFields} value={specs} onChange={setSpecs} />
          </section>
        )}

        {isRepair && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-gray-800">Equipo recibido</h3>
            <SpecInputs fields={REPAIR_FIELDS} value={repair} onChange={setRepair} />
          </section>
        )}

        <div>
          <label className={labelCls}>Notas internas</label>
          <textarea value={form.notes} onChange={set('notes')} rows={2} className={`${inputCls} resize-none`} />
        </div>
        <FormError message={error} />
      </div>
    </Modal>
  );
}

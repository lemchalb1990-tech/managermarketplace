'use client';

import { useState, type FormEvent } from 'react';
import { Modal } from '@/components/ui/Modal';
import { getToken } from '@/lib/auth';
import { api, type CatalogFilters } from '@/lib/api';

type Field = 'warehouse' | 'criticalStock' | 'variablePrice';

// Editar en lote (solo Super Admin, para implementaciones): bodega asignada, stock crítico o
// activar el precio variable (con el módulo) de los productos marcados o de todos los que
// coinciden con los filtros del catálogo.
export default function BulkEditModal({
  companyId,
  ids,
  filters,
  count,
  warehouses,
  variablePriceEnabled,
  onClose,
  onDone,
}: {
  companyId: string;
  ids: string[];
  // Si viene, se editan todos los que coinciden con estos filtros (no solo los ids).
  filters: CatalogFilters | null;
  count: number;
  warehouses: { id: string; name: string }[];
  // La empresa tiene el módulo Precio variable (y el punto de venta).
  variablePriceEnabled?: boolean;
  onClose: () => void;
  onDone: (updated: number) => void;
}) {
  const [field, setField] = useState<Field>('warehouse');
  const [warehouseId, setWarehouseId] = useState('');
  const [critical, setCritical] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const valid = field === 'warehouse' ? !!warehouseId
    : field === 'criticalStock' ? critical.trim() !== '' && Number(critical) >= 0
    : true;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await api.catalog.bulkUpdateFields({
        companyId,
        ...(filters ? { filters } : { ids }),
        ...(field === 'warehouse' ? { warehouseId }
          : field === 'criticalStock' ? { criticalStock: Math.trunc(Number(critical)) }
          : { variablePrice: true }),
      }, getToken()!);
      onDone(res.updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo aplicar el cambio.');
      setSaving(false);
    }
  }

  const option = (key: Field, title: string, hint: string) => (
    <label className={`flex gap-3 items-start border rounded-xl p-3 cursor-pointer ${field === key ? 'border-[var(--brand)] ring-2 ring-[var(--brand-soft)]' : 'border-[var(--border)]'}`}>
      <input type="radio" name="bulk-field" className="mt-1" checked={field === key} onChange={() => setField(key)} />
      <span>
        <span className="block text-sm font-semibold text-[var(--text)]">{title}</span>
        <span className="block text-xs text-[var(--text-muted)]">{hint}</span>
      </span>
    </label>
  );

  return (
    <Modal
      title="Editar en lote"
      subtitle={`${count.toLocaleString('es-CL')} producto(s)${filters ? ' que coinciden con los filtros' : ' seleccionados'} · solo Super Admin`}
      onClose={onClose}
      onSubmit={submit}
      busy={saving}
      footer={<>
        <button type="button" onClick={onClose} disabled={saving} className="ui-btn-secondary">Cancelar</button>
        <button type="submit" disabled={!valid || saving} className="ui-btn-brand">
          {saving ? 'Aplicando...' : `Aplicar a ${count.toLocaleString('es-CL')} producto(s)`}
        </button>
      </>}
    >
      <div className="space-y-4">
        <div className={`grid grid-cols-1 gap-2 ${variablePriceEnabled ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
          {option('warehouse', 'Bodega asignada', 'Desde dónde se descuentan las ventas')}
          {option('criticalStock', 'Stock crítico', 'Mínimo antes del aviso')}
          {variablePriceEnabled && option('variablePrice', 'Precio variable', 'Activar en el punto de venta')}
        </div>
        {field === 'warehouse' ? (
          <div>
            <label className="block text-xs font-medium text-[var(--text-2)] mb-1">Nueva bodega asignada</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required
              className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm bg-white">
              <option value="">Elige una bodega</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <p className="text-xs text-[var(--text-muted)] mt-2">
              No mueve el stock que ya está repartido por bodega: desde ahora las ventas de marketplaces y órdenes de estos productos se descuentan de la bodega elegida.
            </p>
          </div>
        ) : field === 'variablePrice' ? (
          <p className="text-xs text-[var(--text-muted)]">
            Se marca «Precio variable en el punto de venta» en estos productos: al cobrar se pedirá el precio real. No cambia su precio de venta ni su precio mínimo, y los que ya lo tenían quedan igual.
          </p>
        ) : (
          <div>
            <label className="block text-xs font-medium text-[var(--text-2)] mb-1">Nuevo stock crítico (unidades)</label>
            <input type="number" min={0} step={1} inputMode="numeric" value={critical} onChange={(e) => setCritical(e.target.value)} required
              className="w-full sm:w-48 px-3 py-2 border border-[var(--border)] rounded-lg text-sm" />
          </div>
        )}
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      </div>
    </Modal>
  );
}

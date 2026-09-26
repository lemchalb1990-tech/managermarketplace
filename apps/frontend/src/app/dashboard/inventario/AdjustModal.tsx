'use client';

import { useState } from 'react';
import { getToken } from '@/lib/auth';
import { api, type InventoryRow } from '@/lib/api';
import { Modal, FormError, btnPrimary, btnSecondary, inputCls, labelCls } from '@/components/ui/Modal';
import { fmtQty, type WarehouseOption } from './shared';

const REASONS = ['Conteo físico', 'Producto dañado', 'Pérdida o robo', 'Corrección de error de ingreso', 'Muestra o uso interno'];

// Ajuste de stock de un producto en una bodega. Queda como movimiento "Ajuste" con motivo
// en el historial y se sincroniza el nuevo total con los marketplaces.
export function AdjustModal({ row, warehouses, defaultWarehouseId, companyId, onClose, onSaved }: {
  row: InventoryRow;
  warehouses: WarehouseOption[];
  defaultWarehouseId?: string;
  companyId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId || warehouses.find((w) => row.stock[w.id])?.id || warehouses[0]?.id || '');
  const [mode, setMode] = useState<'SET' | 'DELTA'>('SET');
  const current = row.stock[warehouseId]?.quantity ?? 0;
  const [quantity, setQuantity] = useState(String(current));
  const [reason, setReason] = useState(REASONS[0]);
  const [detail, setDetail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const qty = Number(quantity);
  const resulting = mode === 'SET' ? qty : current + qty;
  const delta = resulting - current;
  const invalid = quantity.trim() === '' || !Number.isInteger(qty) || resulting < 0 || delta === 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (invalid) return;
    setSaving(true);
    setError('');
    try {
      await api.inventory.adjust({
        companyId, productId: row.id, warehouseId, mode, quantity: qty,
        reason: detail.trim() ? `${reason}: ${detail.trim()}` : reason,
      }, getToken()!);
      onSaved();
    } catch (err: any) {
      setError(err.message || 'No se pudo ajustar el stock');
      setSaving(false);
    }
  }

  return (
    <Modal title="Ajustar stock" subtitle={<>{row.sku} · {row.name}</>} onClose={onClose} onSubmit={submit} busy={saving}
      footer={<>
        <button type="button" onClick={onClose} disabled={saving} className={btnSecondary}>Cancelar</button>
        <button type="submit" disabled={saving || invalid} className={btnPrimary}>{saving ? 'Guardando...' : 'Registrar ajuste'}</button>
      </>}>
      <div className="space-y-4">
        <div>
          <label className={labelCls}>Bodega *</label>
          <select value={warehouseId} required className={inputCls}
            onChange={(e) => { setWarehouseId(e.target.value); if (mode === 'SET') setQuantity(String(row.stock[e.target.value]?.quantity ?? 0)); }}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name} — {fmtQty(row.stock[w.id]?.quantity)} u.{w.active ? '' : ' (inactiva)'}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {([['SET', 'Dejar en una cantidad'], ['DELTA', 'Sumar o restar']] as const).map(([m, label]) => (
            <button key={m} type="button" onClick={() => { setMode(m); setQuantity(m === 'SET' ? String(current) : ''); }}
              className={`py-2 rounded-lg border-2 text-xs font-semibold ${mode === m ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'}`}>
              {label}
            </button>
          ))}
        </div>

        <div>
          <label className={labelCls}>{mode === 'SET' ? 'Cantidad contada *' : 'Cantidad a sumar (negativa para restar) *'}</label>
          <input type="number" step={1} min={mode === 'SET' ? 0 : undefined} value={quantity} required
            onChange={(e) => setQuantity(e.target.value)} className={inputCls} />
          <p className="mt-1 text-xs text-gray-500">
            Actual: <b>{fmtQty(current)}</b> → queda en <b className={resulting < 0 ? 'text-red-600' : ''}>{Number.isFinite(resulting) ? fmtQty(resulting) : '—'}</b>
            {Number.isFinite(delta) && delta !== 0 && <span className={delta > 0 ? 'text-emerald-700' : 'text-red-600'}> ({delta > 0 ? '+' : ''}{delta})</span>}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Motivo *</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls}>
              {REASONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Detalle</label>
            <input value={detail} maxLength={200} onChange={(e) => setDetail(e.target.value)} placeholder="Opcional" className={inputCls} />
          </div>
        </div>
        <FormError message={error} />
      </div>
    </Modal>
  );
}

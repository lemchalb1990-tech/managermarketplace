'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { getToken } from '@/lib/auth';
import { api, type ProductStockByWarehouse } from '@/lib/api';
import { Modal, FormError, btnPrimary, btnSecondary, inputCls, labelCls } from '@/components/ui/Modal';
import { SkeletonTable } from '@/components/Skeleton';

type Warehouse = ProductStockByWarehouse['warehouses'][number];

const REASONS = ['Conteo físico', 'Producto dañado', 'Pérdida o robo', 'Corrección de error de ingreso', 'Muestra o uso interno'];
const qty = (n: number) => n.toLocaleString('es-CL');

// Pestaña «Stock por bodega» de la ficha: una tarjeta por bodega (cantidad, reservado, en
// tránsito y último movimiento) con Ajustar y Traspasar, y los movimientos recientes.
export default function ProductStockTab({ productId, companyId, tz, canAdjust, canTransfer, onChanged }: {
  productId: string;
  // Super Admin: la empresa gestionada (ajustes y traspasos la necesitan).
  companyId?: string;
  tz: string;
  canAdjust: boolean;
  canTransfer: boolean;
  // Tras un ajuste o traspaso: refresca el total del producto en la ficha y el listado.
  onChanged: () => void;
}) {
  const [data, setData] = useState<ProductStockByWarehouse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adjusting, setAdjusting] = useState<Warehouse | null>(null);
  const [transferring, setTransferring] = useState<Warehouse | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.inventory.productStock(productId, getToken()!));
    } catch (err: any) {
      setError(err.message || 'No se pudo cargar el stock por bodega');
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => { load(); }, [load]);

  const fmtDate = (d: string) => new Date(d).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: tz });

  async function done(message: string) {
    setAdjusting(null);
    setTransferring(null);
    setNotice(message);
    setTimeout(() => setNotice(''), 4000);
    await load();
    onChanged();
  }

  if (loading && !data) return <SkeletonTable rows={4} cols={4} />;
  if (error) return <p className="text-sm text-red-600 py-6 text-center">{error}</p>;
  if (!data) return null;

  if (!data.product.managesStock) {
    return <p className="text-sm text-gray-500 py-8 text-center">Este producto no maneja stock propio (es un servicio o lo despacha un proveedor dropship).</p>;
  }

  const total = data.warehouses.reduce((s, w) => s + w.quantity, 0);
  const withStock = data.warehouses.filter((w) => w.quantity > 0).length;
  const activeWarehouses = data.warehouses.filter((w) => w.active);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-gray-600">
          <span className={`text-lg font-bold ${total === 0 ? 'text-red-600' : 'text-gray-900'}`}>{qty(total)}</span> unidades
          {' '}en {withStock} {withStock === 1 ? 'bodega' : 'bodegas'}
        </p>
        <div className="flex items-center gap-3 text-xs">
          {notice && <span className="text-green-700 font-medium">{notice}</span>}
          <button type="button" onClick={load} className="text-blue-600 hover:underline">Actualizar</button>
        </div>
      </div>

      {data.warehouses.length === 0 ? (
        <p className="text-sm text-gray-500">La empresa no tiene bodegas. Créalas en <a href="/dashboard/warehouses" className="text-blue-600 hover:underline">Bodegas</a>.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {data.warehouses.map((w) => (
            <div key={w.id} className={`rounded-xl border p-4 ${w.assigned ? 'border-blue-300 bg-blue-50/40' : 'border-gray-200 bg-white'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{w.name}</p>
                  <p className="text-[11px] text-gray-500">
                    {w.assigned ? 'Bodega asignada: aquí se descuentan las ventas de marketplaces' : !w.active ? 'Bodega inactiva' : 'Bodega'}
                  </p>
                </div>
                <p className={`text-2xl font-bold tabular-nums ${w.quantity === 0 ? 'text-gray-300' : 'text-gray-900'}`}>{qty(w.quantity)}</p>
              </div>
              {(w.reserved > 0 || w.inTransitIn > 0) && (
                <p className="mt-2 text-xs text-gray-600">
                  {w.reserved > 0 && <>Reservado {qty(w.reserved)}, disponible {qty(w.available)}</>}
                  {w.reserved > 0 && w.inTransitIn > 0 && '. '}
                  {w.inTransitIn > 0 && <>En camino desde otra bodega: {qty(w.inTransitIn)}</>}
                </p>
              )}
              <p className="mt-2 text-xs text-gray-500">
                {w.lastMovement
                  ? <>Último: {w.lastMovement.typeLabel} {w.lastMovement.quantity > 0 ? '+' : ''}{w.lastMovement.quantity}, {fmtDate(w.lastMovement.createdAt)}</>
                  : 'Sin movimientos'}
              </p>
              {(canAdjust || canTransfer) && w.active && (
                <div className="mt-3 flex gap-2">
                  {canAdjust && (
                    <button type="button" onClick={() => setAdjusting(w)}
                      className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50">
                      Ajustar
                    </button>
                  )}
                  {canTransfer && activeWarehouses.length > 1 && (
                    <button type="button" onClick={() => setTransferring(w)} disabled={w.available < 1}
                      title={w.available < 1 ? 'No hay unidades disponibles en esta bodega' : undefined}
                      className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                      Traspasar
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-gray-800">Últimos movimientos</p>
          <a href={`/dashboard/inventario?tab=historial&productId=${productId}`} className="text-xs text-blue-600 hover:underline">Ver historial completo</a>
        </div>
        {data.movements.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">Sin movimientos registrados para este producto.</p>
        ) : (
          <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
            {data.movements.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-3 py-2.5 bg-white">
                <span className={`text-sm font-bold w-12 text-right shrink-0 tabular-nums ${m.quantity > 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {m.quantity > 0 ? '+' : ''}{m.quantity}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 truncate">
                    {m.typeLabel}{m.documentNumber ? ` ${m.documentNumber}` : ''}
                    {m.warehouse && <span className="text-gray-500 font-normal">, {m.warehouse.name}</span>}
                  </p>
                  {(m.reason || m.user) && (
                    <p className="text-xs text-gray-400 truncate">{[m.reason, m.user ? `Por ${m.user.name}` : null].filter(Boolean).join('. ')}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-gray-400">{fmtDate(m.createdAt)}</p>
                  {m.balanceAfter != null && <p className="text-[11px] text-gray-400">Queda {qty(m.balanceAfter)}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {adjusting && (
        <AdjustDialog warehouse={adjusting} productId={productId} companyId={companyId}
          onClose={() => setAdjusting(null)}
          onSaved={() => done(`Ajuste registrado en ${adjusting.name}`)} />
      )}
      {transferring && (
        <TransferDialog from={transferring} destinations={activeWarehouses.filter((w) => w.id !== transferring.id)}
          productId={productId} companyId={companyId}
          onClose={() => setTransferring(null)}
          onSaved={(doc) => done(`Traspaso ${doc} despachado: entra al destino cuando se reciba`)} />
      )}
    </div>
  );
}

// Ajuste en UNA bodega: queda como movimiento «Ajuste» con motivo en el kardex.
function AdjustDialog({ warehouse, productId, companyId, onClose, onSaved }: {
  warehouse: Warehouse; productId: string; companyId?: string; onClose: () => void; onSaved: () => void;
}) {
  const [mode, setMode] = useState<'SET' | 'DELTA'>('SET');
  const [quantity, setQuantity] = useState(String(warehouse.quantity));
  const [reason, setReason] = useState(REASONS[0]);
  const [detail, setDetail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const n = Number(quantity);
  const resulting = mode === 'SET' ? n : warehouse.quantity + n;
  const delta = resulting - warehouse.quantity;
  const invalid = quantity.trim() === '' || !Number.isInteger(n) || resulting < 0 || delta === 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (invalid) return;
    setSaving(true);
    setError('');
    try {
      await api.inventory.adjust({
        companyId, productId, warehouseId: warehouse.id, mode, quantity: n,
        reason: detail.trim() ? `${reason}: ${detail.trim()}` : reason,
      }, getToken()!);
      onSaved();
    } catch (err: any) {
      setError(err.message || 'No se pudo registrar el ajuste');
      setSaving(false);
    }
  }

  return (
    <Modal title={`Ajustar stock en ${warehouse.name}`} subtitle={`Hoy tiene ${qty(warehouse.quantity)} unidades`} onClose={onClose} onSubmit={submit} busy={saving}
      footer={<>
        <button type="button" onClick={onClose} disabled={saving} className={btnSecondary}>Cancelar</button>
        <button type="submit" disabled={saving || invalid} className={btnPrimary}>{saving ? 'Guardando...' : 'Registrar ajuste'}</button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {([['SET', 'Dejar en una cantidad'], ['DELTA', 'Sumar o restar']] as const).map(([m, label]) => (
            <button key={m} type="button" onClick={() => { setMode(m); setQuantity(m === 'SET' ? String(warehouse.quantity) : ''); }}
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
            Queda en <b className={resulting < 0 ? 'text-red-600' : ''}>{Number.isFinite(resulting) ? qty(resulting) : '—'}</b>
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

// Traspaso de este producto desde una bodega: se crea y despacha (sale del origen al tiro y
// entra al destino cuando se recibe en Inventario → Traspasos).
function TransferDialog({ from, destinations, productId, companyId, onClose, onSaved }: {
  from: Warehouse; destinations: Warehouse[]; productId: string; companyId?: string; onClose: () => void; onSaved: (documentNumber: string) => void;
}) {
  const [toId, setToId] = useState(destinations[0]?.id || '');
  const [quantity, setQuantity] = useState('1');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const n = Number(quantity);
  const invalid = !toId || !Number.isInteger(n) || n < 1 || n > from.available;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (invalid) return;
    setSaving(true);
    setError('');
    try {
      const doc = await api.inventory.transfers.create({
        companyId, fromWarehouseId: from.id, toWarehouseId: toId, notes: notes.trim() || undefined,
        lines: [{ productId, quantity: n }], dispatch: true,
      }, getToken()!);
      onSaved(doc.documentNumber);
    } catch (err: any) {
      setError(err.message || 'No se pudo crear el traspaso');
      setSaving(false);
    }
  }

  return (
    <Modal title={`Traspasar desde ${from.name}`} subtitle={`Disponible: ${qty(from.available)} unidades`} onClose={onClose} onSubmit={submit} busy={saving}
      footer={<>
        <button type="button" onClick={onClose} disabled={saving} className={btnSecondary}>Cancelar</button>
        <button type="submit" disabled={saving || invalid} className={btnPrimary}>{saving ? 'Despachando...' : 'Crear y despachar'}</button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Bodega de destino *</label>
            <select value={toId} required onChange={(e) => setToId(e.target.value)} className={inputCls}>
              {destinations.map((w) => <option key={w.id} value={w.id}>{w.name} ({qty(w.quantity)} u.)</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Cantidad *</label>
            <input type="number" min={1} max={from.available} step={1} value={quantity} required
              onChange={(e) => setQuantity(e.target.value)} className={inputCls} />
            {n > from.available && <p className="mt-1 text-xs text-red-600">Supera lo disponible en {from.name}</p>}
          </div>
        </div>
        <div>
          <label className={labelCls}>Nota</label>
          <input value={notes} maxLength={200} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" className={inputCls} />
        </div>
        <p className="text-xs text-gray-500">
          Sale de {from.name} al despachar y entra al destino cuando se recibe en Inventario → Traspasos.
        </p>
        <FormError message={error} />
      </div>
    </Modal>
  );
}

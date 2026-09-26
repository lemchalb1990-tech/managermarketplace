'use client';

import { useEffect, useMemo, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api, type InventoryRow, type TransferDocument } from '@/lib/api';
import { useDashboardTimezone } from '@/lib/dashboardTimezone';
import { Modal, FormError, btnPrimary, btnSecondary, btnDanger, inputCls, labelCls } from '@/components/ui/Modal';
import { confirmDialog } from '../ConfirmDialog';
import { TRANSFER_STATUS, fmtDateTime, fmtQty, useDebounced, type InventoryContext } from './shared';

type Line = { productId: string; sku: string; name: string; quantity: string; stock?: InventoryRow['stock'] };

// ─── Crear / editar traspaso ──────────────────────────────────────────────────
export function TransferFormModal({ ctx, prefill, editing, onClose, onSaved }: {
  ctx: InventoryContext;
  prefill?: { productId?: string; sku?: string; name?: string; fromWarehouseId?: string };
  editing?: TransferDocument;
  onClose: () => void;
  onSaved: (doc: TransferDocument) => void;
}) {
  const active = ctx.warehouses.filter((w) => w.active);
  const [fromId, setFromId] = useState(editing?.fromWarehouse.id || prefill?.fromWarehouseId || active[0]?.id || '');
  const [toId, setToId] = useState(editing?.toWarehouse.id || active.find((w) => w.id !== (editing?.fromWarehouse.id || prefill?.fromWarehouseId || active[0]?.id))?.id || '');
  const [notes, setNotes] = useState(editing?.notes || '');
  const [lines, setLines] = useState<Line[]>(() => {
    if (editing) return editing.lines.map((l) => ({ productId: l.productId, sku: l.product.sku, name: l.product.name, quantity: String(l.quantity) }));
    if (prefill?.productId) return [{ productId: prefill.productId, sku: prefill.sku || '', name: prefill.name || '', quantity: '1' }];
    return [];
  });
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<InventoryRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState<'draft' | 'dispatch' | null>(null);
  const [error, setError] = useState('');
  const debounced = useDebounced(search, 300);

  // Stock por bodega de las líneas precargadas (edición o "Traspasar" desde el reporte).
  useEffect(() => {
    const missing = lines.filter((l) => !l.stock);
    if (!missing.length) return;
    const token = getToken()!;
    Promise.all(missing.map((l) => api.inventory.availability({ companyId: ctx.companyId, search: l.sku, pageSize: 10 }, token)
      .then((r) => r.rows.find((x) => x.id === l.productId)).catch(() => undefined)))
      .then((found) => setLines((prev) => prev.map((l) => {
        const row = found.find((f) => f?.id === l.productId);
        return row ? { ...l, stock: row.stock, sku: l.sku || row.sku, name: l.name || row.name } : l;
      })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!debounced.trim() || !fromId) { setResults([]); return; }
    setSearching(true);
    api.inventory.availability({ companyId: ctx.companyId, warehouseId: fromId, search: debounced.trim(), onlyStock: true, pageSize: 10 }, getToken()!)
      .then((r) => setResults(r.rows))
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }, [debounced, fromId, ctx.companyId]);

  const availableAt = (l: Line) => (l.stock ? l.stock[fromId]?.available ?? 0 : null);
  const over = lines.some((l) => { const a = availableAt(l); return a != null && Number(l.quantity) > a; });
  const validLines = lines.filter((l) => Number(l.quantity) >= 1 && Number.isInteger(Number(l.quantity)));
  const sameWarehouse = fromId && fromId === toId;
  const canSubmit = !!fromId && !!toId && !sameWarehouse && validLines.length === lines.length && lines.length > 0;

  function addProduct(r: InventoryRow) {
    setLines((prev) => prev.some((l) => l.productId === r.id) ? prev : [...prev, { productId: r.id, sku: r.sku, name: r.name, quantity: '1', stock: r.stock }]);
    setSearch('');
    setResults([]);
  }

  async function save(dispatch: boolean) {
    if (!canSubmit) return;
    if (dispatch && !(await confirmDialog(
      `Se descontarán ${validLines.reduce((s, l) => s + Number(l.quantity), 0)} unidad(es) de ${ctx.warehouses.find((w) => w.id === fromId)?.name} y quedarán en tránsito hasta que se reciban en destino. ¿Despachar?`,
    ))) return;
    setSaving(dispatch ? 'dispatch' : 'draft');
    setError('');
    const token = getToken()!;
    const payload = { fromWarehouseId: fromId, toWarehouseId: toId, notes: notes.trim() || undefined, lines: validLines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity) })) };
    try {
      let doc: TransferDocument;
      if (editing) {
        doc = await api.inventory.transfers.update(editing.id, { ...payload, notes: notes.trim() }, token);
        if (dispatch) doc = await api.inventory.transfers.dispatch(editing.id, token);
      } else {
        doc = await api.inventory.transfers.create({ ...payload, companyId: ctx.companyId, dispatch }, token);
      }
      onSaved(doc);
    } catch (err: any) {
      setError(err.message || 'No se pudo guardar el traspaso');
      setSaving(null);
    }
  }

  return (
    <Modal size="lg" title={editing ? `Editar traspaso ${editing.documentNumber}` : 'Nuevo traspaso'}
      subtitle="Al despachar sale de la bodega de origen; entra al destino cuando se recibe."
      onClose={onClose} busy={!!saving}
      onSubmit={(e) => { e.preventDefault(); save(false); }}
      footer={<>
        <button type="button" onClick={onClose} disabled={!!saving} className={btnSecondary}>Cancelar</button>
        <button type="submit" disabled={!!saving || !canSubmit} className={btnSecondary}>
          {saving === 'draft' ? 'Guardando...' : 'Guardar borrador'}
        </button>
        <button type="button" onClick={() => save(true)} disabled={!!saving || !canSubmit || over} className={btnPrimary}
          title={over ? 'Hay cantidades mayores a lo disponible en origen' : undefined}>
          {saving === 'dispatch' ? 'Despachando...' : editing ? 'Guardar y despachar' : 'Crear y despachar'}
        </button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Bodega de origen *</label>
            <select value={fromId} required onChange={(e) => setFromId(e.target.value)} className={inputCls}>
              <option value="">— Selecciona —</option>
              {active.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Bodega de destino *</label>
            <select value={toId} required onChange={(e) => setToId(e.target.value)} className={inputCls}>
              <option value="">— Selecciona —</option>
              {active.filter((w) => w.id !== fromId).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        </div>
        {active.length < 2 && <FormError message="Necesitas al menos dos bodegas activas para traspasar. Créalas en Bodegas." />}

        <div>
          <label className={labelCls}>Agregar productos</label>
          <div className="relative">
            <input value={search} onChange={(e) => setSearch(e.target.value)} disabled={!fromId}
              placeholder={fromId ? 'Busca por SKU o nombre (con stock en origen)' : 'Primero elige la bodega de origen'} className={inputCls} />
            {(results.length > 0 || searching) && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {searching && <p className="px-3 py-2 text-xs text-gray-400">Buscando...</p>}
                {results.map((r) => (
                  <button key={r.id} type="button" onClick={() => addProduct(r)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex justify-between gap-3">
                    <span className="min-w-0 truncate"><span className="text-gray-400 text-xs mr-1.5">{r.sku}</span>{r.name}</span>
                    <span className="shrink-0 text-xs text-gray-500">{fmtQty(r.stock[fromId]?.available)} disp.</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Producto</th>
                <th className="text-right px-3 py-2 font-medium">Disponible en origen</th>
                <th className="text-right px-3 py-2 font-medium w-28">Cantidad</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-xs text-gray-400">Agrega al menos un producto.</td></tr>
              ) : lines.map((l, i) => {
                const avail = availableAt(l);
                const exceeds = avail != null && Number(l.quantity) > avail;
                return (
                  <tr key={l.productId}>
                    <td className="px-3 py-2"><span className="text-gray-400 text-xs mr-1.5">{l.sku}</span>{l.name}</td>
                    <td className={`px-3 py-2 text-right font-mono tabular-nums ${exceeds ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>{avail == null ? '…' : fmtQty(avail)}</td>
                    <td className="px-3 py-2 text-right">
                      <input type="number" min={1} step={1} value={l.quantity} required
                        onChange={(e) => setLines((prev) => prev.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))}
                        className={`w-24 px-2 py-1 border rounded-lg text-sm text-right ${exceeds ? 'border-red-400' : 'border-gray-300'}`} />
                    </td>
                    <td className="px-2 text-center">
                      <button type="button" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))} aria-label="Quitar"
                        className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {over && <p className="text-xs text-red-600">Hay cantidades mayores a lo disponible en origen: puedes guardar el borrador, pero no despacharlo.</p>}

        <div>
          <label className={labelCls}>Observaciones</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500}
            placeholder="Motivo del traspaso, transporte, etc." className={inputCls} />
        </div>
        <FormError message={error} />
      </div>
    </Modal>
  );
}

// ─── Recibir ──────────────────────────────────────────────────────────────────
function ReceiveModal({ doc, onClose, onSaved }: { doc: TransferDocument; onClose: () => void; onSaved: (d: TransferDocument) => void }) {
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(doc.lines.map((l) => [l.id, String(l.quantity)])));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const invalid = doc.lines.some((l) => { const n = Number(qty[l.id]); return qty[l.id] === '' || !Number.isInteger(n) || n < 0 || n > l.quantity; });
  const diffs = doc.lines.filter((l) => Number(qty[l.id]) !== l.quantity);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (invalid) return;
    if (diffs.length && !notes.trim()) { setError('Hay diferencias: explica en la observación qué pasó con lo que no llegó.'); return; }
    setSaving(true);
    setError('');
    try {
      onSaved(await api.inventory.transfers.receive(doc.id, {
        lines: doc.lines.map((l) => ({ lineId: l.id, receivedQuantity: Number(qty[l.id]) })),
        notes: notes.trim() || undefined,
      }, getToken()!));
    } catch (err: any) {
      setError(err.message || 'No se pudo registrar la recepción');
      setSaving(false);
    }
  }

  return (
    <Modal size="lg" title={`Recibir ${doc.documentNumber}`} subtitle={<>En {doc.toWarehouse.name}, desde {doc.fromWarehouse.name}. Cuenta lo que llegó.</>}
      onClose={onClose} onSubmit={submit} busy={saving}
      footer={<>
        <button type="button" onClick={onClose} disabled={saving} className={btnSecondary}>Cancelar</button>
        <button type="submit" disabled={saving || invalid} className={btnPrimary}>{saving ? 'Registrando...' : diffs.length ? 'Recibir con diferencia' : 'Confirmar recepción'}</button>
      </>}>
      <div className="space-y-4">
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500 border-b border-gray-200">
            <tr>
              <th className="text-left py-2 font-medium">Producto</th>
              <th className="text-right py-2 font-medium">Despachado</th>
              <th className="text-right py-2 font-medium w-28">Recibido</th>
              <th className="text-right py-2 font-medium w-24">Diferencia</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {doc.lines.map((l) => {
              const n = Number(qty[l.id]);
              const d = Number.isFinite(n) ? n - l.quantity : 0;
              return (
                <tr key={l.id}>
                  <td className="py-2"><span className="text-gray-400 text-xs mr-1.5">{l.product.sku}</span>{l.product.name}</td>
                  <td className="py-2 text-right font-mono tabular-nums">{fmtQty(l.quantity)}</td>
                  <td className="py-2 text-right">
                    <input type="number" min={0} max={l.quantity} step={1} value={qty[l.id]} required
                      onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))}
                      className="w-24 px-2 py-1 border border-gray-300 rounded-lg text-sm text-right" />
                  </td>
                  <td className={`py-2 text-right font-mono tabular-nums ${d < 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>{d === 0 ? '—' : d}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div>
          <label className={labelCls}>Observación de recepción{diffs.length ? ' *' : ''}</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500}
            placeholder={diffs.length ? 'Ej: llegaron 2 cajas dañadas' : 'Opcional'} className={inputCls} />
        </div>
        {diffs.length > 0 && (
          <p className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
            Lo que no llegó ya salió de origen y no entra a destino: queda registrado como diferencia en el traspaso.
          </p>
        )}
        <FormError message={error} />
      </div>
    </Modal>
  );
}

// ─── Anular ───────────────────────────────────────────────────────────────────
function CancelModal({ doc, onClose, onSaved }: { doc: TransferDocument; onClose: () => void; onSaved: (d: TransferDocument) => void }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    setSaving(true);
    setError('');
    try {
      onSaved(await api.inventory.transfers.cancel(doc.id, reason.trim(), getToken()!));
    } catch (err: any) {
      setError(err.message || 'No se pudo anular');
      setSaving(false);
    }
  }
  return (
    <Modal title={`Anular ${doc.documentNumber}`} size="sm" onClose={onClose} onSubmit={submit} busy={saving}
      footer={<>
        <button type="button" onClick={onClose} disabled={saving} className={btnSecondary}>Volver</button>
        <button type="submit" disabled={saving || !reason.trim()} className={btnDanger}>{saving ? 'Anulando...' : 'Anular traspaso'}</button>
      </>}>
      <div className="space-y-3">
        {doc.status === 'IN_TRANSIT' && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Está en tránsito: la mercadería vuelve a {doc.fromWarehouse.name} y queda registrado en el historial.
          </p>
        )}
        <div>
          <label className={labelCls}>Motivo *</label>
          <input value={reason} required maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Ej: se despachó por error" className={inputCls} />
        </div>
        <FormError message={error} />
      </div>
    </Modal>
  );
}

// ─── Guía imprimible ──────────────────────────────────────────────────────────
function printGuide(doc: TransferDocument, tz: string) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const rows = doc.lines.map((l) => `<tr><td>${esc(l.product.sku)}</td><td>${esc(l.product.name)}</td><td class="n">${l.quantity}</td><td class="n">${l.receivedQuantity ?? ''}</td></tr>`).join('');
  const total = doc.lines.reduce((s, l) => s + l.quantity, 0);
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Guía de traspaso ${doc.documentNumber}</title>
  <style>body{font-family:system-ui,sans-serif;color:#111;margin:32px;font-size:13px}h1{font-size:20px;margin:0}
  .muted{color:#666}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0}.box{border:1px solid #ccc;border-radius:6px;padding:10px}
  table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border-bottom:1px solid #ddd;padding:7px 6px;text-align:left}th{background:#f5f5f5;font-size:12px}
  .n{text-align:right}.sign{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:70px}.sign div{border-top:1px solid #333;padding-top:6px;text-align:center}
  @media print{button{display:none}}</style></head><body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start"><div><h1>Guía de traspaso ${doc.documentNumber}</h1>
  <p class="muted">Estado: ${TRANSFER_STATUS[doc.status].label}</p></div><button onclick="window.print()">Imprimir</button></div>
  <div class="grid"><div class="box"><b>Origen</b><br>${esc(doc.fromWarehouse.name)}<br><span class="muted">Despachado: ${fmtDateTime(doc.dispatchedAt, tz)}${doc.dispatchedBy ? ' · ' + esc(doc.dispatchedBy.name) : ''}</span></div>
  <div class="box"><b>Destino</b><br>${esc(doc.toWarehouse.name)}<br><span class="muted">Recibido: ${fmtDateTime(doc.receivedAt, tz)}${doc.receivedBy ? ' · ' + esc(doc.receivedBy.name) : ''}</span></div></div>
  <table><thead><tr><th>SKU</th><th>Producto</th><th class="n">Despachado</th><th class="n">Recibido</th></tr></thead><tbody>${rows}</tbody>
  <tfoot><tr><th colspan="2">Total unidades</th><th class="n">${total}</th><th></th></tr></tfoot></table>
  ${doc.notes ? `<p style="margin-top:14px"><b>Observaciones:</b> ${esc(doc.notes).replace(/\n/g, '<br>')}</p>` : ''}
  <div class="sign"><div>Despacha (nombre y firma)</div><div>Recibe (nombre y firma)</div></div>
  <p class="muted" style="margin-top:30px">Emitida ${fmtDateTime(new Date().toISOString(), tz)}</p></body></html>`);
  w.document.close();
}

// ─── Detalle ──────────────────────────────────────────────────────────────────
export function TransferDetailModal({ ctx, id, onClose, onChanged }: {
  ctx: InventoryContext; id: string; onClose: () => void; onChanged: () => void;
}) {
  const tz = useDashboardTimezone();
  const [doc, setDoc] = useState<TransferDocument | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sub, setSub] = useState<'edit' | 'receive' | 'cancel' | null>(null);

  useEffect(() => {
    api.inventory.transfers.get(id, getToken()!).then(setDoc).catch((e) => setError(e.message || 'No se pudo cargar el traspaso'));
  }, [id]);

  function updated(d: TransferDocument) {
    setDoc(d);
    setSub(null);
    onChanged();
  }

  async function dispatch() {
    if (!doc) return;
    if (!(await confirmDialog(`Se descontarán las unidades de ${doc.fromWarehouse.name} y quedarán en tránsito hasta que se reciban en ${doc.toWarehouse.name}. ¿Despachar ${doc.documentNumber}?`))) return;
    setBusy(true);
    setError('');
    try { updated(await api.inventory.transfers.dispatch(doc.id, getToken()!)); }
    catch (err: any) { setError(err.message || 'No se pudo despachar'); }
    finally { setBusy(false); }
  }

  const totals = useMemo(() => doc ? {
    sent: doc.lines.reduce((s, l) => s + l.quantity, 0),
    received: doc.lines.reduce((s, l) => s + (l.receivedQuantity ?? 0), 0),
  } : null, [doc]);

  if (sub === 'edit' && doc) return <TransferFormModal ctx={ctx} editing={doc} onClose={() => setSub(null)} onSaved={updated} />;
  if (sub === 'receive' && doc) return <ReceiveModal doc={doc} onClose={() => setSub(null)} onSaved={updated} />;
  if (sub === 'cancel' && doc) return <CancelModal doc={doc} onClose={() => setSub(null)} onSaved={updated} />;

  const steps = doc ? [
    { label: 'Creado', at: doc.createdAt, by: doc.createdBy },
    { label: 'Despachado', at: doc.dispatchedAt, by: doc.dispatchedBy },
    { label: doc.status === 'RECEIVED_WITH_DIFF' ? 'Recibido con diferencia' : 'Recibido', at: doc.receivedAt, by: doc.receivedBy },
    ...(doc.status === 'CANCELLED' ? [{ label: 'Anulado', at: doc.cancelledAt, by: doc.cancelledBy }] : []),
  ] : [];
  const hasCost = doc?.lines.some((l) => l.unitCost != null);

  return (
    <Modal size="lg" onClose={onClose} busy={busy}
      title={doc ? <span className="flex items-center gap-2">Traspaso {doc.documentNumber}
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${TRANSFER_STATUS[doc.status].cls}`}>{TRANSFER_STATUS[doc.status].label}</span></span> : 'Traspaso'}
      subtitle={doc ? <>{doc.fromWarehouse.name} → {doc.toWarehouse.name}</> : undefined}
      footer={doc ? <>
        <button type="button" onClick={() => printGuide(doc, tz)} className={`${btnSecondary} mr-auto`}>Imprimir guía</button>
        {doc.status === 'DRAFT' && ctx.perms.transfer && <>
          <button type="button" onClick={() => setSub('cancel')} disabled={busy} className={btnSecondary}>Anular</button>
          <button type="button" onClick={() => setSub('edit')} disabled={busy} className={btnSecondary}>Editar</button>
          <button type="button" onClick={dispatch} disabled={busy} className={btnPrimary}>{busy ? 'Despachando...' : 'Despachar'}</button>
        </>}
        {doc.status === 'IN_TRANSIT' && <>
          {ctx.perms.transfer && <button type="button" onClick={() => setSub('cancel')} className={btnSecondary}>Anular</button>}
          {ctx.perms.receive && <button type="button" onClick={() => setSub('receive')} className={btnPrimary}>Recibir</button>}
        </>}
      </> : undefined}>
      {!doc ? (
        error ? <FormError message={error} /> : <p className="text-sm text-gray-400">Cargando...</p>
      ) : (
        <div className="space-y-5">
          <ol className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {steps.map((s) => (
              <li key={s.label} className={`rounded-lg border px-3 py-2 ${s.at ? 'border-gray-200 bg-white' : 'border-dashed border-gray-200 bg-gray-50'}`}>
                <p className={`text-xs font-semibold ${s.at ? 'text-gray-800' : 'text-gray-400'}`}>{s.label}</p>
                <p className="text-[11px] text-gray-500">{s.at ? fmtDateTime(s.at, tz) : 'Pendiente'}</p>
                {s.by && s.at && <p className="text-[11px] text-gray-400 truncate">{s.by.name}</p>}
              </li>
            ))}
          </ol>

          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 border-b border-gray-200">
              <tr>
                <th className="text-left py-2 font-medium">Producto</th>
                <th className="text-right py-2 font-medium">Despachado</th>
                <th className="text-right py-2 font-medium">Recibido</th>
                <th className="text-right py-2 font-medium">Diferencia</th>
                {hasCost && <th className="text-right py-2 font-medium">Costo unit.</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {doc.lines.map((l) => {
                const diff = l.receivedQuantity != null ? l.receivedQuantity - l.quantity : null;
                return (
                  <tr key={l.id}>
                    <td className="py-2">
                      <button type="button" onClick={() => ctx.goTo('historial', { productId: l.productId })} className="text-left hover:text-blue-600">
                        <span className="text-gray-400 text-xs mr-1.5">{l.product.sku}</span>{l.product.name}
                      </button>
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">{fmtQty(l.quantity)}</td>
                    <td className="py-2 text-right font-mono tabular-nums">{l.receivedQuantity != null ? fmtQty(l.receivedQuantity) : '—'}</td>
                    <td className={`py-2 text-right font-mono tabular-nums ${diff && diff < 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>{diff ? diff : '—'}</td>
                    {hasCost && <td className="py-2 text-right font-mono tabular-nums text-gray-500">{l.unitCost != null ? `$${Math.round(Number(l.unitCost)).toLocaleString('es-CL')}` : '—'}</td>}
                  </tr>
                );
              })}
            </tbody>
            {totals && (
              <tfoot className="text-xs font-semibold border-t border-gray-200">
                <tr>
                  <td className="py-2">Total</td>
                  <td className="py-2 text-right tabular-nums">{fmtQty(totals.sent)}</td>
                  <td className="py-2 text-right tabular-nums">{doc.receivedAt ? fmtQty(totals.received) : '—'}</td>
                  <td colSpan={hasCost ? 2 : 1}></td>
                </tr>
              </tfoot>
            )}
          </table>

          {(doc.notes || doc.cancelReason) && (
            <div className="text-xs text-gray-600 space-y-1">
              {doc.notes && <p className="whitespace-pre-line"><b>Observaciones:</b> {doc.notes}</p>}
              {doc.cancelReason && <p className="text-red-600"><b>Motivo de anulación:</b> {doc.cancelReason}</p>}
            </div>
          )}
          <FormError message={error} />
        </div>
      )}
    </Modal>
  );
}

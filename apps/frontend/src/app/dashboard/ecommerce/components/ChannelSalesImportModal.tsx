'use client';

import { Fragment, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { useDashboardTimezone, dateKeyInTz } from '@/lib/dashboardTimezone';

// Montos del desglose SIN IVA (ver backend ecommerce/platforms/sale-breakdown.ts).
type OrderItem = {
  title: string; quantity: number; unitPrice: number; resolved: boolean; productName: string | null;
  revenue?: number; discount?: number; commission?: number | null; commissionEstimated?: boolean;
  shipping?: number; net?: number; cost?: number | null; profit?: number | null; cancelled?: boolean;
};
type OrderCharges = { shippingCost: number; marketplaceFee: number | null; taxes: number | null; discount: number; netAmount: number };
type OrderPreview = {
  externalId: string; date: string; total: number; buyerName: string | null;
  importable: boolean; alreadyRegistered: boolean; items: OrderItem[];
  charges?: OrderCharges;
  breakdown?: { label: string; amount: number }[];
  chargeDetail?: ChargeDetail[];
  commissionEstimated?: boolean; cost?: number | null; profit?: number | null;
};
type ChargeDetail = { type: string; name: string; amount: number; tax: number };

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('es-CL')}`;
const profitClass = (n: number | null | undefined) => (n == null ? 'text-gray-400' : n < 0 ? 'text-red-600' : 'text-emerald-700');

const CHARGE_TYPE_LABELS: Record<string, string> = {
  PRODUCT: 'Precio producto',
  SHIPPING: 'Envío',
  DISCOUNT: 'Descuento',
  COMMISSION: 'Comisión',
  FEE: 'Cargo',
  TAX: 'IVA total (va al fisco)',
  REFUND: 'Reembolso/cancelación',
};

const PAGE_SIZE = 20;

function firstDayOfMonth(tz: string) {
  const key = dateKeyInTz(tz);
  return `${key.slice(0, 7)}-01`;
}
function today(tz: string) {
  return dateKeyInTz(tz);
}

// Genérico a propósito — mismo patrón que ML (ver ecommerce/mercadolibre/components/
// SalesImportModal.tsx) pero simplificado: el desglose de cargos solo aparece si la
// plataforma lo entrega (`charges`/`breakdown`) y no ofrece crear Orden de despacho. Trae ventas
// ya realizadas como historial — no descuenta stock ni genera movimientos de inventario.
export function ChannelSalesImportModal({
  connectionId,
  connectionName,
  platformLabel,
  onClose,
}: {
  connectionId: string;
  connectionName: string;
  platformLabel: string;
  onClose: () => void;
}) {
  const tz = useDashboardTimezone();
  const [from, setFrom] = useState(() => firstDayOfMonth(tz));
  const [to, setTo] = useState(() => today(tz));
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [orders, setOrders] = useState<OrderPreview[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [alreadyImportedCount, setAlreadyImportedCount] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpanded(externalId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(externalId)) next.delete(externalId); else next.add(externalId);
      return next;
    });
  }

  async function handleSearch() {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const token = getToken()!;
      const data = await api.connections.previewSalesImport(connectionId, from, to, token);
      setOrders(data.orders);
      setTruncated(data.truncated);
      setAlreadyImportedCount(data.alreadyImportedCount);
      setSelected(new Set(data.orders.filter((o) => o.importable).map((o) => o.externalId)));
      setPage(0);
      setSearched(true);
    } catch (err: any) {
      setError(err.message || `No se pudieron obtener las ventas de ${platformLabel}.`);
    } finally {
      setLoading(false);
    }
  }

  function toggle(externalId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(externalId)) next.delete(externalId); else next.add(externalId);
      return next;
    });
  }

  function toggleAll() {
    const importableIds = orders.filter((o) => o.importable).map((o) => o.externalId);
    const allSelected = importableIds.every((id) => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(importableIds));
  }

  async function handleConfirm() {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    setImporting(true);
    setError('');
    setImportProgress({ done: 0, total: ids.length });
    const combined = { imported: 0, skipped: 0, errors: [] as string[] };
    try {
      const token = getToken()!;
      for (const id of ids) {
        try {
          const res = await api.connections.confirmSalesImport(connectionId, [id], token);
          combined.imported += res.imported;
          combined.skipped += res.skipped;
          combined.errors.push(...res.errors);
        } catch (err: any) {
          combined.errors.push(err.message || `Orden ${id}: error al importar.`);
        }
        setImportProgress((p) => ({ ...p, done: p.done + 1 }));
      }
      setResult(combined);
    } catch (err: any) {
      setError(err.message || 'Error al importar las ventas.');
    } finally {
      setImporting(false);
    }
  }

  const importableCount = orders.filter((o) => o.importable).length;
  const unresolvedCount = orders.filter((o) => !o.importable && !o.alreadyRegistered).length;
  const pageCount = Math.max(1, Math.ceil(orders.length / PAGE_SIZE));
  const pagedOrders = orders.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const hasCharges = orders.some((o) => o.charges);
  const colCount = hasCharges ? 10 : 6;
  const withCharges = orders.filter((o) => o.charges);
  const periodNet = withCharges.reduce((s, o) => s + o.charges!.netAmount, 0);
  const periodProfit = withCharges.every((o) => o.profit != null) ? withCharges.reduce((s, o) => s + (o.profit ?? 0), 0) : null;
  const anyEstimated = orders.some((o) => o.commissionEstimated);
  const missingCommission = withCharges.some((o) => o.charges!.marketplaceFee == null);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-4xl max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-semibold text-gray-900">Importar ventas de "{connectionName}"</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Trae ventas ya realizadas en {platformLabel} como historial. No descuenta stock ni genera movimientos de inventario.
            </p>
          </div>
          {!importing && (
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          )}
        </div>

        {importing && (
          <div className="px-6 py-3 border-b border-gray-100 shrink-0 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-gray-600">
              <span className="flex items-center gap-1.5">
                <span className="w-3.5 h-3.5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
                Importando {importProgress.done} de {importProgress.total}...
              </span>
              <span className="font-semibold text-gray-700">
                {importProgress.total > 0 ? Math.round((importProgress.done / importProgress.total) * 100) : 0}%
              </span>
            </div>
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-200"
                style={{ width: `${importProgress.total > 0 ? (importProgress.done / importProgress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-end gap-3 shrink-0">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Desde</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Hasta</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <button onClick={handleSearch} disabled={loading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
            {loading ? 'Buscando...' : 'Buscar ventas'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="m-6 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          {!error && result && (
            <div className="p-6 space-y-3">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800">
                <p className="font-semibold mb-1">Importación completada</p>
                <p>{result.imported} venta(s) importada(s), {result.skipped} omitida(s) (ya existían).</p>
              </div>
              {result.errors.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-xs text-amber-800 space-y-1">
                  {result.errors.map((e, i) => <p key={i}>{e}</p>)}
                </div>
              )}
            </div>
          )}

          {!error && !result && searched && (
            orders.length === 0 ? (
              <div className="p-12 text-center text-gray-400 text-sm">
                No se encontraron ventas en el período seleccionado.
              </div>
            ) : (
              <>
                {truncated && (
                  <div className="mx-6 mt-4 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                    Se encontraron más ventas de las que se muestran aquí. Acota el rango de fechas para verlas todas.
                  </div>
                )}
                <div className="mx-6 mt-4 flex flex-wrap gap-4 text-xs text-gray-500">
                  <span>{importableCount} listas para importar</span>
                  {unresolvedCount > 0 && <span>{unresolvedCount} con productos no vinculados en el catálogo</span>}
                  {alreadyImportedCount > 0 && <span>{alreadyImportedCount} ya registradas en el sistema</span>}
                </div>
                {hasCharges && (
                  <div className="mx-6 mt-3 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600 flex flex-wrap gap-x-6 gap-y-1">
                    <span>Neto sin IVA de estas ventas: <b className="text-gray-900">{money(periodNet)}</b></span>
                    <span>Ganancia (neto − costo sin IVA): <b className={profitClass(periodProfit)}>{periodProfit != null ? money(periodProfit) : 'falta costo en algún producto'}</b></span>
                    {anyEstimated && <span className="text-amber-700">Comisión estimada con el % configurado en la conexión.</span>}
                    {missingCommission && (
                      <span className="text-amber-700">
                        {platformLabel} no informa la comisión por API: configura el "% comisión" en la conexión para que el neto la descuente.
                      </span>
                    )}
                  </div>
                )}
                <div className="overflow-x-auto">
                <table className="w-full text-sm mt-3">
                  <thead className="bg-gray-50 border-y border-gray-200 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left">
                        <input type="checkbox"
                          checked={importableCount > 0 && orders.filter(o => o.importable).every(o => selected.has(o.externalId))}
                          onChange={toggleAll} />
                      </th>
                      <th className="px-2 py-2 text-left text-gray-600 font-medium">Fecha</th>
                      <th className="px-2 py-2 text-left text-gray-600 font-medium">Comprador</th>
                      <th className="px-2 py-2 text-right text-gray-600 font-medium" title="Pagado por el comprador, con IVA">Total</th>
                      {hasCharges && (
                        <>
                          <th className="px-2 py-2 text-right text-gray-600 font-medium" title="Sin IVA">Descuentos</th>
                          <th className="px-2 py-2 text-right text-gray-600 font-medium" title="Envío a cargo del vendedor + comisión, sin IVA">Costos</th>
                          <th className="px-2 py-2 text-right text-gray-600 font-medium" title="Lo que queda de la venta, sin IVA">Neto s/IVA</th>
                          <th className="px-2 py-2 text-right text-gray-600 font-medium" title="Neto − costo de los productos (sin IVA)">Ganancia</th>
                        </>
                      )}
                      <th className="px-2 py-2 text-left text-gray-600 font-medium">Estado</th>
                      <th className="px-2 py-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pagedOrders.map((o) => {
                      const isOpen = expanded.has(o.externalId);
                      return (
                        <Fragment key={o.externalId}>
                          <tr
                            className={`cursor-pointer ${o.importable ? 'hover:bg-gray-50' : 'opacity-50'}`}
                            onClick={() => toggleExpanded(o.externalId)}>
                            <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" disabled={!o.importable}
                                checked={selected.has(o.externalId)} onChange={() => toggle(o.externalId)} />
                            </td>
                            <td className="px-2 py-2 text-gray-700 whitespace-nowrap">
                              {new Date(o.date).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: tz })}
                            </td>
                            <td className="px-2 py-2 text-gray-800 font-medium">{o.buyerName || '—'}</td>
                            <td className="px-2 py-2 text-right text-gray-700">{money(o.total)}</td>
                            {hasCharges && (
                              <>
                                <td className="px-2 py-2 text-right text-red-600">
                                  {o.charges ? (o.charges.discount ? `-${money(o.charges.discount)}` : money(0)) : '—'}
                                </td>
                                <td className="px-2 py-2 text-right text-red-600">
                                  {o.charges ? (() => {
                                    const costs = Math.max(0, o.charges.shippingCost) + (o.charges.marketplaceFee ?? 0);
                                    return costs ? `-${money(costs)}` : money(0);
                                  })() : '—'}
                                </td>
                                <td className="px-2 py-2 text-right text-gray-900 font-medium">
                                  {o.charges ? money(o.charges.netAmount) : '—'}
                                </td>
                                <td className={`px-2 py-2 text-right font-medium ${profitClass(o.profit)}`}
                                  title={o.profit == null ? 'Falta el costo de algún producto en el catálogo' : undefined}>
                                  {o.profit != null ? money(o.profit) : '—'}
                                </td>
                              </>
                            )}
                            <td className="px-2 py-2">
                              {o.importable ? (
                                <span className="text-xs text-green-600">Lista</span>
                              ) : o.alreadyRegistered ? (
                                <span className="text-xs text-gray-400">Ya registrada</span>
                              ) : (
                                <span className="text-xs text-red-500">No importable</span>
                              )}
                            </td>
                            <td className="px-2 py-2 text-gray-400 text-xs">{isOpen ? '▲' : '▼'}</td>
                          </tr>
                          {isOpen && (
                            <tr>
                              <td colSpan={colCount} className="bg-gray-50 px-6 py-3">
                                <p className="text-xs font-semibold text-gray-600 mb-1.5">
                                  Productos{o.items.some((it) => it.net != null) && ' — montos sin IVA'}
                                </p>
                                {o.items.some((it) => it.net != null) ? (
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-xs text-gray-700">
                                      <thead>
                                        <tr className="text-gray-400">
                                          <th className="text-left font-normal py-0.5 pr-2">Producto</th>
                                          <th className="text-right font-normal py-0.5 px-1">Venta</th>
                                          <th className="text-right font-normal py-0.5 px-1">Desc.</th>
                                          <th className="text-right font-normal py-0.5 px-1">Comisión</th>
                                          <th className="text-right font-normal py-0.5 px-1">Envío</th>
                                          <th className="text-right font-normal py-0.5 px-1">Neto</th>
                                          <th className="text-right font-normal py-0.5 px-1">Costo</th>
                                          <th className="text-right font-normal py-0.5 pl-1">Ganancia</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {o.items.map((it, i) => (
                                          <tr key={i} className={it.cancelled ? 'text-gray-400 line-through' : ''}>
                                            <td className="py-0.5 pr-2">
                                              {it.quantity}× {it.productName || it.title}
                                              {!it.resolved && <span className="text-red-500 ml-1 no-underline">(sin vincular)</span>}
                                              {it.cancelled && <span className="ml-1">(cancelado/devuelto)</span>}
                                            </td>
                                            <td className="py-0.5 px-1 text-right">{money(it.revenue ?? 0)}</td>
                                            <td className="py-0.5 px-1 text-right text-red-600">{it.discount ? money(-it.discount) : '—'}</td>
                                            <td className="py-0.5 px-1 text-right text-red-600" title={it.commissionEstimated ? 'Estimada con el % de la conexión' : undefined}>
                                              {it.commission != null ? `${money(-it.commission)}${it.commissionEstimated ? '*' : ''}` : '?'}
                                            </td>
                                            <td className={`py-0.5 px-1 text-right ${(it.shipping ?? 0) < 0 ? 'text-red-600' : ''}`}>{it.shipping ? money(it.shipping) : '—'}</td>
                                            <td className="py-0.5 px-1 text-right font-semibold text-gray-900">{money(it.net ?? 0)}</td>
                                            <td className="py-0.5 px-1 text-right text-gray-500" title={it.cost == null ? 'Sin costo en el catálogo' : 'Costo del producto sin IVA'}>
                                              {it.cost != null ? money(-it.cost) : '—'}
                                            </td>
                                            <td className={`py-0.5 pl-1 text-right font-semibold ${profitClass(it.profit)}`}>{it.profit != null ? money(it.profit) : '—'}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                    {o.items.some((it) => it.commissionEstimated) && (
                                      <p className="text-[11px] text-gray-400 mt-1">* Comisión estimada con el % configurado en la conexión ({platformLabel} no la informa por API).</p>
                                    )}
                                  </div>
                                ) : (
                                  <div className="space-y-1">
                                    {o.items.map((it, i) => (
                                      <div key={i} className="text-xs text-gray-700 flex justify-between">
                                        <span>
                                          {it.quantity}× {it.productName || it.title}
                                          {!it.resolved && <span className="text-red-500 ml-1">(sin vincular)</span>}
                                        </span>
                                        <span className="text-gray-500">{money(it.unitPrice)} c/u</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {o.charges && (
                                  <div className="mt-3 pt-2 border-t border-gray-200 space-y-0.5 text-xs text-gray-600 max-w-sm ml-auto">
                                    <p className="font-semibold text-gray-600 mb-1">Desglose</p>
                                    <div className="flex justify-between text-gray-400">
                                      <span>Total pagado por el comprador{o.charges.taxes != null && ` (incluye IVA ${money(o.charges.taxes)})`}</span>
                                      <span>{money(o.total)}</span>
                                    </div>
                                    {(o.breakdown || []).map((b, i) => (
                                      <div key={i} className={`flex justify-between${i === 0 ? ' pt-1' : ''}`}>
                                        <span>{b.label}</span>
                                        <span className={b.amount < 0 ? 'text-red-600' : ''}>{money(b.amount)}</span>
                                      </div>
                                    ))}
                                    <div className="flex justify-between font-semibold text-gray-800 pt-1 border-t border-gray-200">
                                      <span>Neto sin IVA</span><span>{money(o.charges.netAmount)}</span>
                                    </div>
                                    <div className="flex justify-between text-gray-500">
                                      <span>Costo de los productos sin IVA</span>
                                      <span>{o.cost != null ? money(-o.cost) : 'falta costo en el catálogo'}</span>
                                    </div>
                                    <div className={`flex justify-between font-semibold pt-1 border-t border-gray-200 ${profitClass(o.profit)}`}>
                                      <span>Ganancia</span><span>{o.profit != null ? money(o.profit) : '—'}</span>
                                    </div>
                                  </div>
                                )}
                                {o.chargeDetail && o.chargeDetail.length > 0 && (
                                  <div className="mt-3 pt-2 border-t border-gray-200 text-xs text-gray-600">
                                    <p className="font-semibold text-gray-600 mb-1">Detalle de cargos y descuentos ({platformLabel})</p>
                                    <table className="w-full">
                                      <thead>
                                        <tr className="text-gray-400">
                                          <th className="text-left font-normal py-0.5">Concepto</th>
                                          <th className="text-left font-normal py-0.5">Código</th>
                                          <th className="text-right font-normal py-0.5">Monto</th>
                                          <th className="text-right font-normal py-0.5">IVA</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {o.chargeDetail.map((c, i) => (
                                          <tr key={i} className={c.name === 'SHIP_DISC' ? 'text-gray-400' : ''}>
                                            <td className="py-0.5">
                                              {CHARGE_TYPE_LABELS[c.type] || c.type}
                                              {c.name === 'SHIP_DISC' && ' (bonificación envío al comprador)'}
                                            </td>
                                            <td className="py-0.5 text-gray-400">{c.name || '—'}</td>
                                            <td className="py-0.5 text-right">{money(c.amount)}</td>
                                            <td className="py-0.5 text-right text-gray-400">{c.tax ? money(c.tax) : '—'}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
                </div>
                {pageCount > 1 && (
                  <div className="flex items-center justify-center gap-3 py-3 border-t border-gray-100">
                    <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                      className="px-3 py-1 border border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                      ← Anterior
                    </button>
                    <span className="text-xs text-gray-500">Página {page + 1} de {pageCount}</span>
                    <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}
                      className="px-3 py-1 border border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                      Siguiente →
                    </button>
                  </div>
                )}
              </>
            )
          )}

          {!error && !result && !searched && !loading && (
            <div className="p-12 text-center text-gray-400 text-sm">
              Elige un rango de fechas y haz clic en "Buscar ventas".
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between shrink-0">
          {result ? (
            <>
              <span />
              <button onClick={onClose} className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold">
                Cerrar
              </button>
            </>
          ) : (
            <>
              <span className="text-xs text-gray-500">{selected.size} seleccionada(s)</span>
              <div className="flex gap-2">
                {!importing && (
                  <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                    Cancelar
                  </button>
                )}
                <button
                  onClick={handleConfirm}
                  disabled={importing || selected.size === 0}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
                >
                  {importing ? `Importando... ${Math.round((importProgress.done / Math.max(importProgress.total, 1)) * 100)}%` : `Importar ${selected.size > 0 ? `(${selected.size})` : ''}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

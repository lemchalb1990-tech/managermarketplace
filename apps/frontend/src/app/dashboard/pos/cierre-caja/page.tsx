'use client';

import { useCallback, useEffect, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { PageHeader, SectionCard, StatRow, StatTile, BrandButton, Toast } from '@/components/ui';
import { useAdminCompany } from '../../AdminCompanyContext';
import { useDashboardTimezone } from '@/lib/dashboardTimezone';
import { confirmDialog } from '../../ConfirmDialog';
import { SkeletonCards } from '@/components/Skeleton';

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Efectivo', CARD: 'Tarjeta', TRANSFER: 'Transferencia', OTHER: 'Otro', FLOW: 'Flow', MERCADO_PAGO: 'Mercado Pago', SIN_ESPECIFICAR: 'Sin especificar',
};
const MANAGER_ROLES = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'];
const fmt = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString('es-CL')}`;

// Cierre de caja formal del punto de venta (solo venta directa): resumen del turno del cajero
// (desde su cierre anterior), conteo del efectivo y diferencia con lo esperado.
export default function CashClosurePage() {
  const { selectedCompanyId } = useAdminCompany();
  const tz = useDashboardTimezone();
  const [user, setUser] = useState<any>(null);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const isManager = MANAGER_ROLES.includes(user?.role);
  const companyId = isSuperAdmin ? selectedCompanyId || undefined : undefined;

  const [cashiers, setCashiers] = useState<{ id: string; name: string }[]>([]);
  const [cashierId, setCashierId] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [openingCash, setOpeningCash] = useState('');
  const [countedCash, setCountedCash] = useState('');
  const [notes, setNotes] = useState('');
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [history, setHistory] = useState<{ closures: any[]; page: number; pages: number } | null>(null);
  const [historyPage, setHistoryPage] = useState(1);

  useEffect(() => { setUser(getUser()); }, []);

  useEffect(() => {
    const token = getToken();
    if (!token || !user || (isSuperAdmin && !companyId)) return;
    api.pos.cashClosures.cashiers(token, companyId).then((list) => {
      setCashiers(list);
      setCashierId((prev) => (prev && list.some((c) => c.id === prev) ? prev : list.find((c) => c.id === user.id)?.id || list[0]?.id || ''));
    }).catch(() => setCashiers([]));
  }, [user, isSuperAdmin, companyId]);

  const loadPreview = useCallback(() => {
    const token = getToken();
    if (!token || !user || !cashierId || (isSuperAdmin && !companyId)) return;
    setLoading(true);
    api.pos.cashClosures.preview(token, { companyId, cashierId })
      .then(setPreview)
      .catch((e) => setError(e.message || 'No se pudo cargar el turno'))
      .finally(() => setLoading(false));
  }, [user, cashierId, isSuperAdmin, companyId]);
  useEffect(() => { loadPreview(); }, [loadPreview]);

  const loadHistory = useCallback(() => {
    const token = getToken();
    if (!token || !user || (isSuperAdmin && !companyId)) return;
    api.pos.cashClosures.list(token, { companyId, page: historyPage }).then(setHistory).catch(() => setHistory(null));
  }, [user, isSuperAdmin, companyId, historyPage]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const summary = preview?.summary;
  const opening = Number(openingCash) || 0;
  const expected = opening + (summary?.cashTotal || 0);
  const counted = countedCash === '' ? null : Number(countedCash) || 0;
  const difference = counted == null ? null : counted - expected;
  const dt = (v: string | Date) => new Date(v).toLocaleString('es-CL', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' });

  async function closeCash() {
    if (counted == null) { setError('Ingresa el efectivo contado en la caja'); return; }
    const diffText = difference === 0 ? 'sin diferencia' : `${difference! > 0 ? 'sobrante' : 'faltante'} de ${fmt(Math.abs(difference!))}`;
    const ok = await confirmDialog(
      `Se cerrará la caja de ${preview.cashier.name} con ${summary.salesCount} venta(s) por ${fmt(summary.total)} y ${diffText} en efectivo. Las próximas ventas quedarán en un turno nuevo.`,
      { title: 'Cerrar caja', confirmLabel: 'Cerrar caja' },
    );
    if (!ok) return;
    setClosing(true);
    setError('');
    try {
      const closure = await api.pos.cashClosures.close({
        companyId, cashierId, openingCash: opening || undefined, countedCash: counted, notes: notes.trim() || undefined,
      }, getToken()!);
      setOpeningCash(''); setCountedCash(''); setNotes('');
      setToast(`Cierre N° ${closure.number} registrado`);
      setTimeout(() => setToast(null), 3000);
      window.open(`/imprimir/cierre-caja/${closure.id}`, '_blank');
      loadPreview();
      setHistoryPage(1);
      loadHistory();
    } catch (e: any) {
      setError(e.message || 'No se pudo cerrar la caja');
    } finally {
      setClosing(false);
    }
  }

  if (isSuperAdmin && !companyId) {
    return (
      <div>
        <PageHeader title="Cierre de caja" crumbs={[{ label: 'Inicio', href: '/dashboard' }, { label: 'Punto de venta' }, { label: 'Cierre de caja' }]} />
        <SectionCard><p className="text-sm text-[var(--text-muted)] text-center py-6">Selecciona una empresa en la barra superior.</p></SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cierre de caja"
        crumbs={[{ label: 'Inicio', href: '/dashboard' }, { label: 'Punto de venta', href: '/dashboard/pos' }, { label: 'Cierre de caja' }]}
        titleActions={isManager && cashiers.length > 0 ? (
          <label className="flex items-center gap-2 text-sm text-[var(--text-2)]">
            Cajero
            <select value={cashierId} onChange={(e) => setCashierId(e.target.value)}
              className="border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm bg-white">
              {cashiers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        ) : undefined}
      />

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      {loading || !summary ? (
        <SkeletonCards count={4} />
      ) : (
        <>
          <p className="text-sm text-[var(--text-2)]">
            Turno de <strong>{preview.cashier.name}</strong> desde {dt(preview.periodFrom)} · solo ventas del punto de venta
          </p>

          <StatRow>
            <StatTile label="Total vendido" value={fmt(summary.total)} tone="brand" />
            <StatTile label="Ventas" value={summary.salesCount} hint={summary.salesCount ? `Ticket promedio ${fmt(summary.total / summary.salesCount)}` : undefined} />
            <StatTile label="Productos vendidos" value={summary.itemsCount} hint="unidades" />
            <StatTile label="Órdenes" value={summary.orders.pickup + summary.orders.delivery}
              hint={`${summary.orders.pickup} retiro · ${summary.orders.delivery} despacho${summary.orders.none ? ` · ${summary.orders.none} sin despacho` : ''}`} />
          </StatRow>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SectionCard title="Montos por medio de pago">
              {summary.payments.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] text-center py-4">Sin ventas en este turno</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-[var(--text-muted)]">
                      <th className="text-left font-medium pb-2">Medio</th>
                      <th className="text-right font-medium pb-2 px-2">Pagos</th>
                      <th className="text-right font-medium pb-2">Monto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-soft)]">
                    {summary.payments.map((p: any) => (
                      <tr key={p.method}>
                        <td className="py-2 text-[var(--text-2)]">{PAYMENT_LABELS[p.method] || p.method}</td>
                        <td className="py-2 px-2 text-right text-[var(--text-2)]">{p.count}</td>
                        <td className="py-2 text-right font-semibold text-[var(--text)]">{fmt(p.total)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td className="pt-2 font-semibold text-[var(--text)]">Total</td>
                      <td />
                      <td className="pt-2 text-right font-bold text-[var(--text)]">{fmt(summary.total)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </SectionCard>

            <SectionCard title="Arqueo de efectivo">
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="block text-xs text-[var(--text-muted)] font-medium mb-1">Fondo inicial (opcional)</span>
                    <input type="number" min="0" step="1" inputMode="numeric" value={openingCash}
                      onChange={(e) => setOpeningCash(e.target.value)} placeholder="0"
                      className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm bg-white" />
                  </label>
                  <label className="block">
                    <span className="block text-xs text-[var(--text-muted)] font-medium mb-1">Efectivo contado</span>
                    <input type="number" min="0" step="1" inputMode="numeric" value={countedCash}
                      onChange={(e) => setCountedCash(e.target.value)} placeholder="Monto en la caja"
                      className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm bg-white" />
                  </label>
                </div>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between text-[var(--text-2)]"><span>Ventas en efectivo</span><span>{fmt(summary.cashTotal)}</span></div>
                  <div className="flex justify-between font-semibold text-[var(--text)]"><span>Efectivo esperado</span><span>{fmt(expected)}</span></div>
                  {difference != null && (
                    <div className={`flex justify-between font-semibold ${difference === 0 ? 'text-[var(--ok)]' : 'text-[var(--danger)]'}`}>
                      <span>{difference === 0 ? 'Cuadra' : difference > 0 ? 'Sobrante' : 'Faltante'}</span>
                      <span>{fmt(Math.abs(difference))}</span>
                    </div>
                  )}
                </div>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observaciones (opcional)"
                  className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm bg-white" />
                {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
                <BrandButton onClick={closeCash} disabled={closing || countedCash === ''} className="w-full">
                  {closing ? 'Cerrando…' : 'Cerrar caja'}
                </BrandButton>
              </div>
            </SectionCard>
          </div>

          <SectionCard title={`Productos vendidos (${summary.itemsCount} unidades)`}>
            {summary.products.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] text-center py-4">Sin productos vendidos en este turno</p>
            ) : (
              <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[var(--surface)]">
                    <tr className="text-xs text-[var(--text-muted)]">
                      <th className="text-left font-medium pb-2 pr-2">SKU</th>
                      <th className="text-left font-medium pb-2 px-2">Producto</th>
                      <th className="text-right font-medium pb-2 px-2">Cantidad</th>
                      <th className="text-right font-medium pb-2">Monto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-soft)]">
                    {summary.products.map((p: any) => (
                      <tr key={p.productId || p.name}>
                        <td className="py-2 pr-2 font-mono text-xs text-[var(--text-muted)]">{p.sku || '—'}</td>
                        <td className="py-2 px-2 text-[var(--text-2)]">{p.name}</td>
                        <td className="py-2 px-2 text-right font-semibold text-[var(--text)]">{p.quantity}</td>
                        <td className="py-2 text-right text-[var(--text)]">{fmt(p.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      )}

      <SectionCard title="Cierres anteriores">
        {!history || history.closures.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] text-center py-4">Todavía no hay cierres de caja</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-[var(--text-muted)]">
                    <th className="text-left font-medium pb-2 pr-2">N°</th>
                    <th className="text-left font-medium pb-2 px-2">Cierre</th>
                    <th className="text-left font-medium pb-2 px-2">Cajero</th>
                    <th className="text-right font-medium pb-2 px-2">Ventas</th>
                    <th className="text-right font-medium pb-2 px-2">Total</th>
                    <th className="text-right font-medium pb-2 px-2">Diferencia</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-soft)]">
                  {history.closures.map((c) => {
                    const diff = Number(c.difference);
                    return (
                      <tr key={c.id}>
                        <td className="py-2 pr-2 font-mono text-xs">{String(c.number).padStart(4, '0')}</td>
                        <td className="py-2 px-2 text-[var(--text-2)] whitespace-nowrap">{dt(c.periodTo)}</td>
                        <td className="py-2 px-2 text-[var(--text-2)]">{c.cashier?.name || '—'}</td>
                        <td className="py-2 px-2 text-right">{c.salesCount}</td>
                        <td className="py-2 px-2 text-right font-semibold">{fmt(Number(c.total))}</td>
                        <td className={`py-2 px-2 text-right font-semibold ${diff === 0 ? 'text-[var(--ok)]' : 'text-[var(--danger)]'}`}>
                          {diff === 0 ? 'Cuadra' : `${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff))}`}
                        </td>
                        <td className="py-2 text-right">
                          <a href={`/imprimir/cierre-caja/${c.id}`} target="_blank" rel="noopener noreferrer"
                            className="text-xs font-medium text-[var(--brand-ink)] hover:underline">Imprimir</a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {history.pages > 1 && (
              <div className="flex justify-end items-center gap-2 mt-3 text-xs">
                <button disabled={history.page <= 1} onClick={() => setHistoryPage((p) => p - 1)}
                  className="px-2.5 py-1 rounded border border-[var(--border)] disabled:opacity-40">Anterior</button>
                <span className="text-[var(--text-muted)]">{history.page} / {history.pages}</span>
                <button disabled={history.page >= history.pages} onClick={() => setHistoryPage((p) => p + 1)}
                  className="px-2.5 py-1 rounded border border-[var(--border)] disabled:opacity-40">Siguiente</button>
              </div>
            )}
          </>
        )}
      </SectionCard>
    </div>
  );
}

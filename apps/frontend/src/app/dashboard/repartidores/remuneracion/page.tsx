'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { PageHeader, SectionCard, Badge, BrandButton } from '@/components/ui';

const money = (n: any) => `$${Number(n || 0).toLocaleString('es-CL')}`;

export default function RemuneracionPage() {
  const [summary, setSummary] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  async function load() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      const [s, b] = await Promise.all([
        api.drivers.paymentsSummary(token),
        api.drivers.listPaymentBatches(token),
      ]);
      setSummary(s);
      setBatches(b);
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function createBatch(row: any) {
    if (row.stopIds.length === 0) return;
    if (!confirm(`Generar lote de pago para ${row.name}: ${row.pendingPackages} paquete(s) · ${money(row.pendingAmount)}?`)) return;
    setBusy(row.driverId);
    try {
      await api.drivers.createPaymentBatch({ driverId: row.driverId, stopIds: row.stopIds }, getToken()!);
      await load();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(''); }
  }

  async function markPaid(id: string) {
    setBusy(id);
    try { await api.drivers.markPaid(id, getToken()!); await load(); }
    catch (err: any) { setError(err.message); }
    finally { setBusy(''); }
  }

  return (
    <div>
      <PageHeader
        title="Remuneración de repartos"
        crumbs={[{ label: 'Inicio', href: '/dashboard' }, { label: 'Repartidores' }, { label: 'Remuneración' }]}
      />
      {error && <div className="mb-4 px-4 py-3 rounded-lg text-sm text-[var(--danger)] bg-[var(--danger-bg)]">{error}</div>}

      {loading ? <p className="text-sm text-[var(--text-muted)] py-8 text-center">Cargando…</p> : (
        <div className="space-y-5">
          <SectionCard title="Pendiente por repartidor">
            <div className="overflow-x-auto -m-5">
              <table className="w-full text-sm">
                <thead className="bg-[var(--surface-soft)] border-b border-[var(--border-soft)]">
                  <tr>
                    <th className="text-left px-5 py-2.5 font-medium text-[var(--text-2)]">Repartidor</th>
                    <th className="text-left px-5 py-2.5 font-medium text-[var(--text-2)]">Modelo</th>
                    <th className="text-right px-5 py-2.5 font-medium text-[var(--text-2)]">Paquetes</th>
                    <th className="text-right px-5 py-2.5 font-medium text-[var(--text-2)]">Monto</th>
                    <th className="px-5 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-soft)]">
                  {summary.map((r) => (
                    <tr key={r.driverId}>
                      <td className="px-5 py-2.5 font-medium text-[var(--text)]">{r.name}</td>
                      <td className="px-5 py-2.5 text-xs text-[var(--text-muted)]">
                        {r.payModel === 'PER_PACKAGE' ? `${money(r.rate)}/paq` : `${money(r.rate)} plano`}
                      </td>
                      <td className="px-5 py-2.5 text-right text-[var(--text-2)]">{r.pendingPackages}</td>
                      <td className="px-5 py-2.5 text-right font-medium text-[var(--brand-ink)]">{money(r.pendingAmount)}</td>
                      <td className="px-5 py-2.5 text-right">
                        <button disabled={r.pendingPackages === 0 || busy === r.driverId}
                          onClick={() => createBatch(r)}
                          className="text-xs font-medium text-[var(--info)] hover:underline disabled:text-[var(--text-muted)] disabled:no-underline">
                          Generar lote
                        </button>
                      </td>
                    </tr>
                  ))}
                  {summary.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-[var(--text-muted)]">Sin repartidores</td></tr>}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard title="Historial de lotes">
            <div className="overflow-x-auto -m-5">
              <table className="w-full text-sm">
                <thead className="bg-[var(--surface-soft)] border-b border-[var(--border-soft)]">
                  <tr>
                    <th className="text-left px-5 py-2.5 font-medium text-[var(--text-2)]">Repartidor</th>
                    <th className="text-left px-5 py-2.5 font-medium text-[var(--text-2)]">Período</th>
                    <th className="text-right px-5 py-2.5 font-medium text-[var(--text-2)]">Paquetes</th>
                    <th className="text-right px-5 py-2.5 font-medium text-[var(--text-2)]">Monto</th>
                    <th className="px-5 py-2.5">Estado</th>
                    <th className="px-5 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-soft)]">
                  {batches.map((b) => (
                    <tr key={b.id}>
                      <td className="px-5 py-2.5 text-[var(--text)]">{b.driver?.name}</td>
                      <td className="px-5 py-2.5 text-xs text-[var(--text-muted)]">
                        {new Date(b.periodFrom).toLocaleDateString('es-CL')} – {new Date(b.periodTo).toLocaleDateString('es-CL')}
                      </td>
                      <td className="px-5 py-2.5 text-right text-[var(--text-2)]">{b.packages}</td>
                      <td className="px-5 py-2.5 text-right text-[var(--text-2)]">{money(b.amount)}</td>
                      <td className="px-5 py-2.5"><Badge tone={b.status === 'PAID' ? 'ok' : 'warn'}>{b.status === 'PAID' ? 'Pagado' : 'Pendiente'}</Badge></td>
                      <td className="px-5 py-2.5 text-right">
                        {b.status !== 'PAID' && (
                          <button disabled={busy === b.id} onClick={() => markPaid(b.id)}
                            className="text-xs font-medium text-[var(--info)] hover:underline">Marcar pagado</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {batches.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-[var(--text-muted)]">Sin lotes</td></tr>}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  );
}

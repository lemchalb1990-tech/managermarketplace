'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { PageHeader, SectionCard, Badge, BrandButton } from '@/components/ui';

const SCOPES = [
  { key: 'today', label: 'Por despachar hoy' },
  { key: 'upcoming', label: 'Próximos días' },
  { key: 'transit', label: 'En tránsito' },
  { key: 'done', label: 'Finalizadas' },
];

const money = (n: any) => (n == null ? '' : `$${Number(n).toLocaleString('es-CL')}`);
const shortId = (id: string) => id.slice(-8).toUpperCase();

export default function EnviosPage() {
  const [scope, setScope] = useState('today');
  const [q, setQ] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dispatching, setDispatching] = useState(false);
  const [courier, setCourier] = useState('');
  const [tracking, setTracking] = useState('');
  const [updatedAt, setUpdatedAt] = useState(new Date());

  async function load() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      const d = await api.shipping.board(token, { scope, q: q.trim() || undefined });
      setData(d);
      setUpdatedAt(new Date());
      setSel(new Set());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [scope]);

  const allOrders = useMemo(
    () => (data?.groups || []).flatMap((g: any) => g.orders),
    [data],
  );

  function toggle(id: string) {
    setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleGroup(g: any) {
    const ids = g.orders.map((o: any) => o.id);
    const allOn = ids.every((i: string) => sel.has(i));
    setSel((s) => {
      const n = new Set(s);
      ids.forEach((i: string) => (allOn ? n.delete(i) : n.add(i)));
      return n;
    });
  }

  async function doDispatch() {
    if (sel.size === 0) return;
    setDispatching(true); setError('');
    try {
      const res = await api.shipping.dispatch(
        { orderIds: [...sel], courier: courier.trim() || undefined, trackingCode: tracking.trim() || undefined },
        getToken()!,
      );
      if (res.skipped.length) {
        setError(`${res.dispatched} despachadas · ${res.skipped.length} omitidas (${res.skipped[0].reason})`);
      }
      setCourier(''); setTracking('');
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDispatching(false);
    }
  }

  async function slip() {
    if (sel.size === 0) return;
    try { await api.shipping.openSlip([...sel], getToken()!); }
    catch (err: any) { setError(err.message); }
  }

  return (
    <div>
      <PageHeader
        title="Órdenes y envíos"
        crumbs={[{ label: 'Inicio', href: '/dashboard' }, { label: 'Ventas' }, { label: 'Órdenes y envíos' }]}
        updatedAt={updatedAt}
      />

      <div className="flex flex-wrap gap-2 mb-4">
        {SCOPES.map((s) => (
          <button key={s.key} onClick={() => setScope(s.key)}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              scope === s.key ? 'bg-[var(--brand-light)] text-[var(--brand-ink)]' : 'text-[var(--text-2)] hover:bg-[var(--surface-soft)]'
            }`}>
            {s.label}{data && scope === s.key ? ` · ${data.total}` : ''}
          </button>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); load(); }} className="mb-4 flex gap-2 max-w-md">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente, nº de orden, seguimiento…"
          className="flex-1 px-3 py-2 border border-[var(--border)] rounded-lg text-sm bg-white" />
        <button className="px-3 py-2 border border-[var(--border)] rounded-lg text-sm text-[var(--text-2)] hover:bg-[var(--surface-soft)]">Buscar</button>
      </form>

      {error && <div className="mb-4 px-4 py-3 rounded-lg text-sm text-[var(--danger)] bg-[var(--danger-bg)]">{error}</div>}

      {sel.size > 0 && (
        <div className="ui-card p-3 mb-4 flex flex-wrap items-center gap-2 sticky top-2 z-10">
          <span className="text-sm font-medium text-[var(--text)]">{sel.size} seleccionada(s)</span>
          <input value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="Transportista (opc.)"
            className="px-2.5 py-1.5 border border-[var(--border)] rounded-lg text-sm w-40" />
          <input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="N° seguimiento (1 orden)"
            className="px-2.5 py-1.5 border border-[var(--border)] rounded-lg text-sm w-44" />
          <BrandButton onClick={doDispatch} disabled={dispatching}>
            {dispatching ? 'Marcando…' : 'Marcar despachado'}
          </BrandButton>
          <button onClick={slip} className="px-3 py-2 border border-[var(--border)] rounded-lg text-sm text-[var(--text-2)] hover:bg-[var(--surface-soft)]">
            Generar guía
          </button>
          <button onClick={() => setSel(new Set())} className="text-sm text-[var(--text-muted)] hover:underline ml-auto">Limpiar</button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[var(--text-muted)] py-8 text-center">Cargando…</p>
      ) : allOrders.length === 0 ? (
        <SectionCard><p className="text-sm text-[var(--text-muted)] text-center py-6">Sin órdenes en esta vista</p></SectionCard>
      ) : (
        <div className="space-y-4">
          {(data.groups || []).map((g: any) => (
            <SectionCard key={g.key}
              title={`${g.label} · ${g.total}`}
              actions={
                <div className="flex items-center gap-2">
                  {scope === 'today' && (
                    <Badge tone={g.overdue ? 'danger' : 'neutral'}>
                      {g.overdue ? 'VENCIDA' : 'límite'} {g.cutoff}
                    </Badge>
                  )}
                  <button onClick={() => toggleGroup(g)} className="text-xs text-[var(--info)] hover:underline">
                    Seleccionar grupo
                  </button>
                </div>
              }>
              <div className="overflow-x-auto -m-5">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-[var(--border-soft)]">
                    {g.orders.map((o: any) => (
                      <tr key={o.id} className="hover:bg-[var(--surface-soft)]">
                        <td className="pl-5 pr-2 py-2.5 w-8">
                          <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} className="rounded" />
                        </td>
                        <td className="px-2 py-2.5 font-mono text-xs text-[var(--text-2)]">
                          <Link href={`/dashboard/orders/${o.id}`} className="hover:underline text-[var(--info)]">#{shortId(o.id)}</Link>
                          {o.externalId ? <span className="text-[var(--text-muted)]"> · {o.externalId}</span> : ''}
                        </td>
                        <td className="px-2 py-2.5 text-[var(--text)]">{o.customerName || '—'}</td>
                        <td className="px-2 py-2.5 text-xs text-[var(--text-muted)]">{[o.commune, o.city].filter(Boolean).join(', ')}</td>
                        <td className="px-2 py-2.5 text-xs">
                          <Badge tone={o.prepStage === 'PACKED' || o.status === 'READY' ? 'ok' : o.itemsOos > 0 ? 'danger' : 'warn'}>
                            {o.status === 'IN_TRANSIT' ? 'En tránsito' : o.status === 'DELIVERED' ? 'Entregado' : o.status === 'READY' ? 'Listo' : 'En prep.'}
                          </Badge>
                        </td>
                        <td className="px-2 py-2.5 text-xs text-[var(--text-muted)]">{o.trackingCode || ''}</td>
                        <td className="pr-5 pl-2 py-2.5 text-right text-[var(--text-2)]">{money(o.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          ))}
        </div>
      )}
    </div>
  );
}

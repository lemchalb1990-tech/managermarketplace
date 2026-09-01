'use client';

import { useEffect, useRef, useState, FormEvent } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { PageHeader, SectionCard, StatRow, StatTile, Badge, BrandButton } from '@/components/ui';

const CONDITIONS = [
  { key: 'GOOD', label: 'Buen estado' },
  { key: 'DAMAGED', label: 'Dañado' },
  { key: 'OPENED', label: 'Abierto / manipulado' },
  { key: 'MISSING_CONTENT', label: 'Contenido faltante' },
];
const condLabel = (k: string) => CONDITIONS.find((c) => c.key === k)?.label || k;

export default function DevolucionesPage() {
  const [tab, setTab] = useState<'pending' | 'received'>('pending');
  const [q, setQ] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [scan, setScan] = useState('');
  const [flash, setFlash] = useState<{ msg: string; ok: boolean } | null>(null);
  const [receiving, setReceiving] = useState<any>(null);
  const [rcond, setRcond] = useState('GOOD');
  const [rnotes, setRnotes] = useState('');
  const [rrestock, setRrestock] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      setData(await api.returns.list(token, { status: tab, q: q.trim() || undefined }));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab]);

  async function onScan(e: FormEvent) {
    e.preventDefault();
    const code = scan.trim();
    if (!code) return;
    setScan('');
    try {
      const res = await api.returns.scan(code, getToken()!);
      if (res.kind === 'return') { openReceive(res.return); setFlash({ msg: 'Devolución encontrada', ok: true }); }
      else setFlash({ msg: res.message, ok: false });
    } catch (err: any) {
      setFlash({ msg: err.message, ok: false });
    }
    inputRef.current?.focus();
    setTimeout(() => setFlash(null), 2500);
  }

  function openReceive(ret: any) {
    setReceiving(ret);
    setRcond('GOOD');
    setRnotes('');
    setRrestock(new Set(ret.items.filter((i: any) => i.productId).map((i: any) => i.id)));
  }

  async function confirmReceive() {
    setBusy(true);
    try {
      await api.returns.receive(
        receiving.id,
        { condition: rcond, notes: rnotes.trim() || undefined, restockItemIds: rcond === 'GOOD' ? [...rrestock] : [] },
        getToken()!,
      );
      setReceiving(null);
      await load();
      setFlash({ msg: 'Devolución recepcionada', ok: true });
      setTimeout(() => setFlash(null), 2000);
    } catch (err: any) {
      setFlash({ msg: err.message, ok: false });
      setTimeout(() => setFlash(null), 3000);
    } finally {
      setBusy(false);
    }
  }

  async function undo(id: string) {
    if (!confirm('¿Deshacer la recepción? Se revertirá el stock repuesto.')) return;
    try { await api.returns.undo(id, getToken()!); await load(); }
    catch (err: any) { setFlash({ msg: err.message, ok: false }); setTimeout(() => setFlash(null), 3000); }
  }

  return (
    <div>
      <PageHeader
        title="Devoluciones"
        crumbs={[{ label: 'Inicio', href: '/dashboard' }, { label: 'Ventas' }, { label: 'Devoluciones' }]}
      />

      {data && (
        <StatRow>
          <StatTile label="Por recepcionar" value={data.counts.pending} tone={data.counts.pending > 0 ? 'warn' : undefined} />
          <StatTile label="Recibidas (60 días)" value={data.counts.received} tone="ok" />
        </StatRow>
      )}

      <div className="flex gap-2 my-4">
        {(['pending', 'received'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium ${tab === t ? 'bg-[var(--brand-light)] text-[var(--brand-ink)]' : 'text-[var(--text-2)] hover:bg-[var(--surface-soft)]'}`}>
            {t === 'pending' ? 'Por recepcionar' : 'Recibidas'}
          </button>
        ))}
      </div>

      {tab === 'pending' && (
        <form onSubmit={onScan} className="mb-2 flex gap-2">
          <input ref={inputRef} autoFocus value={scan} onChange={(e) => setScan(e.target.value)}
            placeholder="Escanea la etiqueta / nº de devolución…"
            className="flex-1 px-3.5 py-2.5 border border-[var(--border)] rounded-lg text-sm font-mono bg-white" />
          <BrandButton type="submit">Buscar</BrandButton>
        </form>
      )}
      <form onSubmit={(e) => { e.preventDefault(); load(); }} className="mb-4 flex gap-2 max-w-md">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nº, cliente, SKU…"
          className="flex-1 px-3 py-2 border border-[var(--border)] rounded-lg text-sm bg-white" />
        <button className="px-3 py-2 border border-[var(--border)] rounded-lg text-sm text-[var(--text-2)] hover:bg-[var(--surface-soft)]">Buscar</button>
      </form>

      {flash && (
        <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${flash.ok ? 'text-[var(--ok)] bg-[var(--ok-bg)]' : 'text-[var(--danger)] bg-[var(--danger-bg)]'}`}>{flash.msg}</div>
      )}

      {loading ? (
        <p className="text-sm text-[var(--text-muted)] py-8 text-center">Cargando…</p>
      ) : (data?.returns || []).length === 0 ? (
        <SectionCard><p className="text-sm text-[var(--text-muted)] text-center py-6">
          {tab === 'pending' ? 'Nada por recepcionar' : 'Sin devoluciones recibidas'}
        </p></SectionCard>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data.returns.map((r: any) => (
            <SectionCard key={r.id}
              title={`#${r.id.slice(-6).toUpperCase()}${r.externalId ? ` · ${r.externalId}` : ''}`}
              actions={
                r.status === 'RECEIVED'
                  ? <Badge tone="ok">{condLabel(r.condition)}</Badge>
                  : <Badge tone="warn">Pendiente</Badge>
              }>
              <p className="text-xs text-[var(--text-muted)] -mt-2 mb-2">
                {r.channel || 'Interno'}{r.order?.customerName ? ` · ${r.order.customerName}` : ''}
                {r.reason ? ` · ${r.reason}` : ''}
              </p>
              <ul className="space-y-1 mb-3">
                {r.items.map((it: any) => (
                  <li key={it.id} className="text-sm flex justify-between">
                    <span className="text-[var(--text-2)]">{it.productName} {it.restocked && <Badge tone="ok">repuesto</Badge>}</span>
                    <span className="text-xs text-[var(--text-muted)] font-mono">{it.productSku} ×{it.quantity}</span>
                  </li>
                ))}
              </ul>
              {r.status === 'PENDING' ? (
                <BrandButton onClick={() => openReceive(r)} className="w-full">Recepcionar</BrandButton>
              ) : (
                <button onClick={() => undo(r.id)} className="w-full px-4 py-2 border border-[var(--border)] text-[var(--text-2)] rounded-lg text-sm hover:bg-[var(--surface-soft)]">
                  Deshacer recepción
                </button>
              )}
            </SectionCard>
          ))}
        </div>
      )}

      {receiving && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="ui-card w-full max-w-md">
            <div className="px-6 py-4 border-b border-[var(--border-soft)]">
              <h2 className="font-semibold text-[var(--text)]">Recepcionar devolución</h2>
              <p className="text-xs text-[var(--text-muted)]">#{receiving.id.slice(-6).toUpperCase()}</p>
            </div>
            <div className="px-6 py-4 flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-2)] mb-1">Estado del producto</label>
                <select value={rcond} onChange={(e) => setRcond(e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm bg-white">
                  {CONDITIONS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
              {rcond === 'GOOD' && (
                <div>
                  <label className="block text-xs font-medium text-[var(--text-2)] mb-1">Reponer al stock</label>
                  <div className="space-y-1 border border-[var(--border)] rounded-lg p-2">
                    {receiving.items.map((it: any) => (
                      <label key={it.id} className={`flex items-center gap-2 text-sm ${it.productId ? 'cursor-pointer' : 'opacity-50'}`}>
                        <input type="checkbox" disabled={!it.productId}
                          checked={rrestock.has(it.id)}
                          onChange={() => setRrestock((s) => { const n = new Set(s); n.has(it.id) ? n.delete(it.id) : n.add(it.id); return n; })}
                          className="rounded" />
                        {it.productName} ×{it.quantity}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-[var(--text-2)] mb-1">Notas (opcional)</label>
                <textarea value={rnotes} onChange={(e) => setRnotes(e.target.value)} rows={2}
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm" />
              </div>
              <div className="flex gap-2">
                <BrandButton onClick={confirmReceive} disabled={busy} className="flex-1">
                  {busy ? 'Guardando…' : 'Confirmar recepción'}
                </BrandButton>
                <button onClick={() => setReceiving(null)}
                  className="flex-1 px-4 py-2 border border-[var(--border)] text-[var(--text-2)] rounded-lg text-sm hover:bg-[var(--surface-soft)]">
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

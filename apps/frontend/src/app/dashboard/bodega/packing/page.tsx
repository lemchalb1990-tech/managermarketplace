'use client';

import { useEffect, useRef, useState, FormEvent } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { PageHeader, SectionCard, Badge, BrandButton } from '@/components/ui';

export default function PackingPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [scan, setScan] = useState('');
  const [flash, setFlash] = useState<{ msg: string; ok: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const token = getToken();
    if (!token) return;
    try {
      setOrders(await api.warehouse.packingList(token));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  function drop(id: string) { setOrders((p) => p.filter((x) => x.id !== id)); }

  async function onScan(e: FormEvent) {
    e.preventDefault();
    const code = scan.trim();
    if (!code) return;
    setScan('');
    try {
      const res = await api.warehouse.packingScan({ code }, getToken()!);
      if (res.kind === 'packed') { drop(res.order.id); setFlash({ msg: res.message, ok: true }); }
      else setFlash({ msg: res.message || 'Revisa el pedido', ok: false });
    } catch (err: any) {
      setFlash({ msg: err.message, ok: false });
    }
    inputRef.current?.focus();
    setTimeout(() => setFlash(null), 2500);
  }

  async function confirm(id: string) {
    try {
      const res = await api.warehouse.confirmPacked(id, getToken()!);
      drop(id);
      setFlash({ msg: res.message || 'Empacado', ok: true });
      setTimeout(() => setFlash(null), 2000);
    } catch (err: any) {
      setFlash({ msg: err.message, ok: false });
      setTimeout(() => setFlash(null), 3000);
    }
  }

  return (
    <div>
      <PageHeader
        title="Packing"
        crumbs={[{ label: 'Inicio', href: '/dashboard' }, { label: 'Bodega' }, { label: 'Packing' }]}
      />

      <form onSubmit={onScan} className="mb-2 flex gap-2">
        <input ref={inputRef} autoFocus value={scan} onChange={(e) => setScan(e.target.value)}
          placeholder="Escanea el nº de pedido / seguimiento…"
          className="flex-1 px-3.5 py-2.5 border border-[var(--border)] rounded-lg text-sm font-mono bg-white" />
        <BrandButton type="submit">Escanear</BrandButton>
      </form>
      {flash && (
        <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${flash.ok ? 'text-[var(--ok)] bg-[var(--ok-bg)]' : 'text-[var(--danger)] bg-[var(--danger-bg)]'}`}>
          {flash.msg}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[var(--text-muted)] py-8 text-center">Cargando…</p>
      ) : orders.length === 0 ? (
        <SectionCard><p className="text-sm text-[var(--text-muted)] text-center py-6">Sin pedidos por empacar</p></SectionCard>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {orders.map((o) => {
            const oosCount = o.itemChecks.filter((i: any) => i.outOfStock).length;
            return (
              <SectionCard key={o.id}
                title={`#${o.id.slice(-6).toUpperCase()}${o.sale?.externalId ? ` · ${o.sale.externalId}` : ''}`}
                actions={oosCount > 0 ? <Badge tone="danger">{oosCount} sin stock</Badge> : <Badge tone="ok">pickeado</Badge>}>
                <p className="text-xs text-[var(--text-muted)] -mt-2 mb-3">
                  {o.customerName || 'Cliente'} · pickeó {o.pickedBy?.name || '—'} · {o.warehouse?.name || 'Sin bodega'}
                </p>
                <ul className="space-y-1 mb-3">
                  {o.itemChecks.map((it: any) => (
                    <li key={it.id} className="text-sm flex justify-between">
                      <span className={it.outOfStock ? 'text-[var(--danger)] line-through' : 'text-[var(--text-2)]'}>{it.productName}</span>
                      <span className="text-xs text-[var(--text-muted)] font-mono">×{it.checkedQty ?? it.expectedQty}</span>
                    </li>
                  ))}
                </ul>
                <BrandButton onClick={() => confirm(o.id)} className="w-full">Confirmar empacado → Listo</BrandButton>
              </SectionCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

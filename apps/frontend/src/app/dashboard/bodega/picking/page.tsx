'use client';

import { useEffect, useRef, useState, FormEvent } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { PageHeader, SectionCard, Badge, BrandButton } from '@/components/ui';

const MANAGER = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CATALOG_MANAGER'];

export default function PickingPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [scan, setScan] = useState('');
  const [flash, setFlash] = useState<{ msg: string; ok: boolean } | null>(null);
  const [mine, setMine] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const isManager = MANAGER.includes(getUser()?.role);

  async function load() {
    const token = getToken();
    if (!token) return;
    try {
      const list = await api.warehouse.pickingList(token, { mine: isManager ? mine : true });
      setOrders(list);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [mine]);

  function upsertOrder(o: any) {
    setOrders((prev) => {
      const i = prev.findIndex((x) => x.id === o.id);
      if (o.prepStage === 'PICKED') return prev.filter((x) => x.id !== o.id);
      if (i === -1) return [...prev, o];
      const copy = [...prev]; copy[i] = o; return copy;
    });
  }

  async function onScan(e: FormEvent) {
    e.preventDefault();
    const code = scan.trim();
    if (!code) return;
    setScan('');
    try {
      const res = await api.warehouse.pickingScan({ code }, getToken()!);
      if (res.kind === 'unmatched') {
        setFlash({ msg: res.message, ok: false });
      } else {
        if (res.order) upsertOrder(res.order);
        setFlash({ msg: res.message || 'Pedido abierto', ok: true });
      }
    } catch (err: any) {
      setFlash({ msg: err.message, ok: false });
    }
    inputRef.current?.focus();
    setTimeout(() => setFlash(null), 2500);
  }

  async function pick(orderId: string, itemId: string, qty: number) {
    try {
      const o = await api.warehouse.pickItem(orderId, itemId, { pickedQty: qty }, getToken()!);
      upsertOrder(o);
    } catch (err: any) { setFlash({ msg: err.message, ok: false }); }
  }
  async function oos(orderId: string, itemId: string, val: boolean) {
    try {
      const o = await api.warehouse.outOfStock(orderId, itemId, { outOfStock: val }, getToken()!);
      upsertOrder(o);
    } catch (err: any) { setFlash({ msg: err.message, ok: false }); }
  }
  async function complete(orderId: string) {
    try {
      const o = await api.warehouse.completePicking(orderId, getToken()!);
      upsertOrder(o);
      setFlash({ msg: 'Picking completado', ok: true });
      setTimeout(() => setFlash(null), 2000);
    } catch (err: any) { setFlash({ msg: err.message, ok: false }); setTimeout(() => setFlash(null), 3000); }
  }

  return (
    <div>
      <PageHeader
        title="Picking"
        crumbs={[{ label: 'Inicio', href: '/dashboard' }, { label: 'Bodega' }, { label: 'Picking' }]}
        actions={isManager ? (
          <label className="flex items-center gap-2 text-sm text-[var(--text-2)]">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="rounded" />
            Solo míos
          </label>
        ) : undefined}
      />

      <form onSubmit={onScan} className="mb-2 flex gap-2">
        <input
          ref={inputRef} autoFocus value={scan} onChange={(e) => setScan(e.target.value)}
          placeholder="Escanea SKU o nº de pedido…"
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
        <SectionCard><p className="text-sm text-[var(--text-muted)] text-center py-6">Sin pedidos por pickear</p></SectionCard>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {orders.map((o) => {
            const done = o.itemChecks.filter((i: any) => i.checked || i.outOfStock).length;
            const total = o.itemChecks.length;
            const ready = done === total;
            return (
              <SectionCard key={o.id}
                title={`#${o.id.slice(-6).toUpperCase()}${o.sale?.externalId ? ` · ${o.sale.externalId}` : ''}`}
                actions={<Badge tone={ready ? 'ok' : 'warn'}>{done}/{total} ítems</Badge>}>
                <p className="text-xs text-[var(--text-muted)] -mt-2 mb-3">
                  {o.customerName || 'Cliente'} · {o.assignedTo?.name || 'Sin asignar'} · {o.warehouse?.name || 'Sin bodega'}
                </p>
                <div className="space-y-2">
                  {o.itemChecks.map((it: any) => (
                    <div key={it.id} className={`flex items-center gap-2 text-sm p-2 rounded-lg ${it.checked ? 'bg-[var(--ok-bg)]' : it.outOfStock ? 'bg-[var(--danger-bg)]' : 'bg-[var(--surface-soft)]'}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-[var(--text)] truncate">{it.productName}</p>
                        <p className="text-xs text-[var(--text-muted)] font-mono">{it.productSku} · {it.checkedQty ?? 0}/{it.expectedQty}</p>
                      </div>
                      {!it.outOfStock && (
                        <div className="flex items-center gap-1">
                          <button onClick={() => pick(o.id, it.id, Math.max(0, (it.checkedQty ?? 0) - 1))}
                            className="w-7 h-7 rounded border border-[var(--border)] text-[var(--text-2)]">−</button>
                          <button onClick={() => pick(o.id, it.id, Math.min(it.expectedQty, (it.checkedQty ?? 0) + 1))}
                            className="w-7 h-7 rounded border border-[var(--border)] text-[var(--text-2)]">+</button>
                        </div>
                      )}
                      <button onClick={() => oos(o.id, it.id, !it.outOfStock)}
                        className={`text-xs px-2 py-1 rounded ${it.outOfStock ? 'bg-[var(--danger)] text-white' : 'border border-[var(--border)] text-[var(--text-muted)]'}`}>
                        Sin stock
                      </button>
                    </div>
                  ))}
                </div>
                <BrandButton onClick={() => complete(o.id)} disabled={!ready} className="w-full mt-3">
                  Completar picking
                </BrandButton>
              </SectionCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

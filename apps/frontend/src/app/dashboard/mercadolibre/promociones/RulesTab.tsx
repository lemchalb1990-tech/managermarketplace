'use client';

import { useCallback, useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api, type MlPromoRule, type MlPromoRuleConfig, type MlPromoType } from '@/lib/api';
import { Modal, btnPrimary, btnSecondary, inputCls, labelCls, FormError } from '@/components/ui/Modal';
import { confirmDialog } from '../../ConfirmDialog';
import { TYPE_INFO, pct } from './shared';

// Tipos de invitación que una regla puede sugerir (relámpago queda fuera: hay que decidir el stock).
const INVITATION_TYPES: MlPromoType[] = ['MARKETPLACE_CAMPAIGN', 'SMART', 'PRICE_MATCHING', 'PRE_NEGOTIATED', 'UNHEALTHY_STOCK', 'DEAL', 'DOD'];

const TEMPLATES: Array<{ kind: MlPromoRule['kind']; icon: string; title: string; text: string; name: string; config: MlPromoRuleConfig }> = [
  {
    kind: 'INVITATIONS', icon: '🤝', title: 'Invitaciones convenientes', name: 'Invitaciones convenientes',
    text: 'Sugiere sumarte a las invitaciones de ML que dejan buen margen (prioriza las co-fondeadas).',
    config: { types: ['MARKETPLACE_CAMPAIGN', 'SMART', 'PRICE_MATCHING', 'PRE_NEGOTIATED'], minMarginPct: 12, maxDiscountPct: 30, priceMode: 'SUGGESTED' },
  },
  {
    kind: 'DISCOUNT', icon: '📦', title: 'Liquidar productos sin ventas', name: 'Liquidar productos sin ventas',
    text: 'Sugiere un descuento individual para productos con stock que no se venden hace tiempo.',
    config: { discountPct: 15, durationDays: 14, minStock: 5, noSalesDays: 45, minMarginPct: 5 },
  },
];

export function RulesTab({ companyId, connections, onChanged }: { companyId?: string; connections: Array<{ id: string; name: string }>; onChanged: () => void }) {
  const [rules, setRules] = useState<MlPromoRule[] | null>(null);
  const [editing, setEditing] = useState<MlPromoRule | (typeof TEMPLATES)[number] | null>(null);

  const load = useCallback(() => {
    api.marketplace.promotions.rules(getToken()!, companyId).then(setRules).catch(() => setRules([]));
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  async function toggle(r: MlPromoRule) {
    await api.marketplace.promotions.updateRule(r.id, { active: !r.active }, getToken()!).catch(() => null);
    load();
    onChanged();
  }
  async function remove(r: MlPromoRule) {
    if (!(await confirmDialog(`¿Eliminar la regla "${r.name}" y sus sugerencias pendientes?`, { danger: true }))) return;
    await api.marketplace.promotions.deleteRule(r.id, getToken()!).catch(() => null);
    load();
    onChanged();
  }

  const describe = (r: MlPromoRule) => {
    const c = r.config;
    const conn = r.connectionId ? connections.find((x) => x.id === r.connectionId)?.name || 'una cuenta' : 'todas las cuentas';
    if (r.kind === 'INVITATIONS') {
      return `${(c.types || []).map((t) => TYPE_INFO[t]?.short || t).join(', ')} · margen ≥ ${pct(c.minMarginPct)} · descuento ≤ ${pct(c.maxDiscountPct)}${c.minMeliPct ? ` · ML aporta ≥ ${pct(c.minMeliPct)}` : ''} · ${conn}`;
    }
    return `−${pct(c.discountPct)} por ${c.durationDays} días · stock ≥ ${c.minStock}${c.noSalesDays ? ` · sin ventas en ${c.noSalesDays} días` : ''} · margen ≥ ${pct(c.minMarginPct)} · ${conn}`;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-sm text-blue-900">
        Las reglas <strong>solo sugieren</strong>: revisan cada 30 minutos y dejan las promociones convenientes en la pestaña Sugerencias para que las apruebes.
        Nunca sugieren productos sin costo cargado ni que dejen pérdida.
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {TEMPLATES.map((t) => (
          <button key={t.kind} type="button" onClick={() => setEditing(t)}
            className="flex items-start gap-3 rounded-xl border border-dashed border-gray-300 bg-white p-4 text-left hover:border-[var(--brand)]">
            <span className="text-2xl">{t.icon}</span>
            <span>
              <span className="block text-sm font-semibold text-gray-900">+ {t.title}</span>
              <span className="block text-xs text-gray-500">{t.text}</span>
            </span>
          </button>
        ))}
      </div>
      {rules === null ? <p className="text-sm text-gray-400">Cargando…</p> : rules.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {rules.map((r) => (
            <div key={r.id} className={`ui-card p-4 ${r.active ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{r.kind === 'INVITATIONS' ? '🤝' : '📦'} {r.name}</p>
                  <p className="mt-1 text-xs text-gray-500">{describe(r)}</p>
                </div>
                <button type="button" onClick={() => toggle(r)}
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${r.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {r.active ? 'Activa' : 'Pausada'}
                </button>
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] text-gray-400">
                <span>
                  {r.pending} pendiente(s) · {r.applied} aprobada(s)
                  {r.lastRunAt ? ` · revisada ${new Date(r.lastRunAt).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
                </span>
                <span className="flex gap-3 font-medium">
                  <button type="button" onClick={() => setEditing(r)} className="text-[var(--brand)] hover:underline">Editar</button>
                  <button type="button" onClick={() => remove(r)} className="text-red-500 hover:underline">Eliminar</button>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <RuleForm initial={editing} companyId={companyId} connections={connections}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); onChanged(); }} />
      )}
    </div>
  );
}

function RuleForm({ initial, companyId, connections, onClose, onSaved }: {
  initial: MlPromoRule | (typeof TEMPLATES)[number]; companyId?: string; connections: Array<{ id: string; name: string }>;
  onClose: () => void; onSaved: () => void;
}) {
  const existing = 'id' in initial ? initial : null;
  const kind = initial.kind;
  const [name, setName] = useState(initial.name);
  const [connectionId, setConnectionId] = useState(existing?.connectionId || '');
  const [cfg, setCfg] = useState<MlPromoRuleConfig>({ ...initial.config });
  const [categories, setCategories] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof MlPromoRuleConfig>(k: K, v: MlPromoRuleConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const numIn = (v: string) => (v === '' ? undefined : Number(v));

  useEffect(() => {
    api.catalog.categories(getToken()!, companyId).then(setCategories).catch(() => setCategories([]));
  }, [companyId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const data = { name, kind, connectionId: connectionId || null, config: cfg };
    try {
      if (existing) await api.marketplace.promotions.updateRule(existing.id, data, getToken()!);
      else await api.marketplace.promotions.createRule({ ...data, companyId }, getToken()!);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const field = (label: string, value: number | undefined | null, onChange: (v: string) => void, suffix: string, hint?: string) => (
    <div>
      <label className={labelCls} title={hint}>{label}</label>
      <span className="flex items-center gap-2">
        <input type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={`${inputCls} w-24`} />
        <span className="text-sm text-gray-500">{suffix}</span>
      </span>
    </div>
  );

  return (
    <Modal title={existing ? 'Editar regla' : kind === 'INVITATIONS' ? 'Regla: invitaciones convenientes' : 'Regla: liquidar productos sin ventas'}
      subtitle="Solo crea sugerencias para que las apruebes." size="lg" busy={busy} onClose={onClose} onSubmit={save}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className={btnSecondary}>Cancelar</button>
          <button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Guardando…' : 'Guardar y revisar ahora'}</button>
        </>
      )}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
          <div><label className={labelCls}>Nombre</label><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></div>
          <div>
            <label className={labelCls}>Cuenta</label>
            <select value={connectionId} onChange={(e) => setConnectionId(e.target.value)} className={inputCls}>
              <option value="">Todas las cuentas</option>
              {connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        {kind === 'INVITATIONS' ? (
          <>
            <div>
              <p className={labelCls}>Tipos de invitación</p>
              <div className="flex flex-wrap gap-1.5">
                {INVITATION_TYPES.map((t) => {
                  const on = (cfg.types || []).includes(t);
                  return (
                    <button key={t} type="button" onClick={() => set('types', on ? (cfg.types || []).filter((x) => x !== t) : [...(cfg.types || []), t])}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${on ? 'border-[var(--navy)] bg-[var(--navy)] text-white' : 'border-gray-200 bg-white text-gray-600'}`}>
                      {TYPE_INFO[t].label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              {field('Margen mínimo', cfg.minMarginPct, (v) => set('minMarginPct', numIn(v)), '%', 'Ganancia sobre el ingreso sin IVA, después de la comisión y el costo')}
              {field('Descuento máximo', cfg.maxDiscountPct, (v) => set('maxDiscountPct', numIn(v)), '%')}
              {field('ML aporta al menos', cfg.minMeliPct ?? undefined, (v) => set('minMeliPct', numIn(v) ?? null), '%', 'Solo para co-fondeadas: deja vacío para no exigirlo')}
            </div>
            <div>
              <p className={labelCls}>Precio en campañas donde lo eliges tú (tradicional, del día)</p>
              <div className="flex flex-wrap gap-1.5">
                {([['SUGGESTED', 'El sugerido por ML'], ['BEST_MARGIN', 'El mayor descuento que respeta mi margen']] as const).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => set('priceMode', k)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${cfg.priceMode === k ? 'border-[var(--navy)] bg-[var(--navy)] text-white' : 'border-gray-200 bg-white text-gray-600'}`}>{l}</button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap gap-4">
            {field('Descuento', cfg.discountPct, (v) => set('discountPct', numIn(v)), '%')}
            <div>
              <label className={labelCls}>Duración</label>
              <select value={cfg.durationDays ?? 7} onChange={(e) => set('durationDays', Number(e.target.value))} className={inputCls}>
                {Array.from({ length: 14 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d} día(s)</option>)}
              </select>
            </div>
            {field('Stock desde', cfg.minStock, (v) => set('minStock', numIn(v)), 'unid.')}
            {field('Sin ventas en', cfg.noSalesDays, (v) => set('noSalesDays', numIn(v)), 'días')}
            {field('Margen mínimo', cfg.minMarginPct, (v) => set('minMarginPct', numIn(v)), '%')}
          </div>
        )}

        <div>
          <p className={labelCls}>Solo estas categorías del catálogo (opcional)</p>
          <div className="mb-1.5 flex flex-wrap gap-1">
            {(cfg.categories || []).map((c) => (
              <span key={c} className="flex items-center gap-1 rounded-full bg-[var(--brand-light)] px-2 py-0.5 text-[11px] font-medium text-[var(--brand-ink)]">
                {c}<button type="button" onClick={() => set('categories', (cfg.categories || []).filter((x) => x !== c))} className="opacity-60 hover:opacity-100" aria-label="Quitar">×</button>
              </span>
            ))}
          </div>
          <select value="" onChange={(e) => e.target.value && set('categories', [...(cfg.categories || []), e.target.value])} className={inputCls}>
            <option value="">+ Agregar categoría…</option>
            {categories.filter((c) => !(cfg.categories || []).includes(c)).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <ExcludeProducts companyId={companyId} ids={cfg.excludeProductIds || []} labels={cfg.excludeLabels || {}}
          onChange={(ids, labels) => setCfg((c) => ({ ...c, excludeProductIds: ids, excludeLabels: labels }))} />

        <p className="text-[11px] text-gray-400">Siempre se omiten: productos sin costo cargado, publicaciones pausadas, las que ya están en la promoción y las que quedarían con pérdida.</p>
        <FormError message={error} />
      </div>
    </Modal>
  );
}

function ExcludeProducts({ companyId, ids, labels, onChange }: {
  companyId?: string; ids: string[]; labels: Record<string, string>; onChange: (ids: string[], labels: Record<string, string>) => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Array<{ id: string; name: string; sku: string }>>([]);
  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => {
      api.catalog.search({ search: q.trim(), pageSize: 8, companyId }, getToken()!)
        .then((r) => setResults((r.products || []).map((p: { id: string; name: string; sku: string }) => ({ id: p.id, name: p.name, sku: p.sku }))))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, companyId]);

  return (
    <div className="relative">
      <p className={labelCls}>Nunca promocionar estos productos</p>
      <div className="mb-1.5 flex flex-wrap gap-1">
        {ids.map((id) => (
          <span key={id} className="flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
            {labels[id] || 'Producto'}
            <button type="button" onClick={() => { const l = { ...labels }; delete l[id]; onChange(ids.filter((x) => x !== id), l); }} className="opacity-60 hover:opacity-100" aria-label="Quitar">×</button>
          </span>
        ))}
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto por nombre o SKU…" className={inputCls} />
      {q.trim().length >= 2 && results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {results.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => { if (!ids.includes(p.id)) onChange([...ids, p.id], { ...labels, [p.id]: p.name }); setQ(''); setResults([]); }}
                className="block w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50">
                <span className="font-medium">{p.name}</span> <span className="text-gray-400">· {p.sku}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

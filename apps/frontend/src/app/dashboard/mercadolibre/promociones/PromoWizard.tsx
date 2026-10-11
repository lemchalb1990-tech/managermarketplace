'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getToken } from '@/lib/auth';
import {
  api, type MlPromoCampaign, type MlPromoItemsPage, type MlPromoJob, type MlPromoPreview, type MlPromoPriceMode, type MlPromoType,
} from '@/lib/api';
import { FilterBar, FilterCount, FilterField, filterInputCls, filterSelectCls } from '@/components/FilterBar';
import { btnPrimary, btnSecondary, inputCls, labelCls, FormError } from '@/components/ui/Modal';
import { confirmDialog } from '../../ConfirmDialog';
import {
  AccountDot, MARGIN_NOTE, MarginCell, PriceChange, ProductCell, StatusBadge, TYPE_INFO, TypeBadge, clp, day, daysLeft, pct, todayYmd,
  type Account,
} from './shared';

// Una misma campaña de ML existe por separado en cada cuenta: se agrupan por tipo y nombre.
export type CampaignGroup = { key: string; type: MlPromoType; name: string; members: MlPromoCampaign[] };

export function groupCampaigns(list: MlPromoCampaign[]): CampaignGroup[] {
  const map = new Map<string, CampaignGroup>();
  for (const c of list) {
    const name = c.name || TYPE_INFO[c.type]?.label || c.type;
    // Las propias (campaña del vendedor, por cantidad) no se agrupan entre cuentas.
    const key = c.origin === 'OWN' ? c.id : `${c.type}|${name.trim().toLowerCase()}`;
    const g = map.get(key) || { key, type: c.type, name, members: [] };
    g.members.push(c);
    map.set(key, g);
  }
  return Array.from(map.values()).sort((a, b) => {
    const da = Math.min(...a.members.map((m) => (m.deadlineDate ? new Date(m.deadlineDate).getTime() : Infinity)));
    const db = Math.min(...b.members.map((m) => (m.deadlineDate ? new Date(m.deadlineDate).getTime() : Infinity)));
    return da - db;
  });
}

export type WizardStart = { type?: MlPromoType; group?: CampaignGroup; productIds?: string[] };
type Choice = { type: MlPromoType; group: CampaignGroup | null };

const STEPS = ['Qué quieres hacer', 'Elige productos', 'Define el descuento', 'Resultado'];

export function PromoWizard({ accounts, selectedAccounts, companyId, start, onClose, onFinished }: {
  accounts: Account[]; selectedAccounts: string[]; companyId?: string; start: WizardStart; onClose: () => void; onFinished: () => void;
}) {
  const initial: Choice | null = start.group ? { type: start.group.type, group: start.group }
    : start.type && start.type !== 'SELLER_CAMPAIGN' && start.type !== 'VOLUME' ? { type: start.type, group: null } : null;
  const [step, setStep] = useState(initial ? 2 : 1);
  const [choice, setChoice] = useState<Choice | null>(initial);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allAccounts, setAllAccounts] = useState(false);
  const [jobs, setJobs] = useState<MlPromoJob[]>([]);
  // Cuentas en que se trabaja: las elegidas arriba (todas si no hay filtro).
  const scope = selectedAccounts.length ? accounts.filter((a) => selectedAccounts.includes(a.id)) : accounts;

  return (
    <div className="ui-card p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <ol className="flex flex-wrap items-center gap-2 text-xs font-medium">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold ${step === i + 1 ? 'bg-[var(--brand)] text-white' : step > i + 1 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                {step > i + 1 ? '✓' : i + 1}
              </span>
              <span className={step === i + 1 ? 'text-gray-900' : 'text-gray-400'}>{s}</span>
              {i < STEPS.length - 1 && <span className="hidden text-gray-300 sm:inline">›</span>}
            </li>
          ))}
        </ol>
        {step < 4 && <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-800">Cancelar</button>}
      </div>

      {choice && step > 1 && step < 4 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-[var(--page-bg)] px-3 py-2 text-sm">
          <TypeBadge type={choice.type} />
          <span className="font-medium text-gray-800">{choice.group?.name || TYPE_INFO[choice.type].label}</span>
          <span className="flex flex-wrap gap-2">
            {(choice.group ? choice.group.members.map((m) => m.connection) : scope).map((a) => <AccountDot key={a.id} accounts={accounts} id={a.id} name={a.name} />)}
          </span>
          <span className="basis-full text-xs text-gray-500">{TYPE_INFO[choice.type].hint}</span>
        </div>
      )}

      {step === 1 && (
        <StepChoose accounts={accounts} scope={scope} onChoose={(c) => { setChoice(c); setSelected(new Set()); setStep(2); }} />
      )}
      {step === 2 && choice && (
        <StepProducts accounts={accounts} scope={scope} companyId={companyId} choice={choice} selected={selected} setSelected={setSelected}
          preselectProducts={start.productIds || null} allAccounts={allAccounts} setAllAccounts={setAllAccounts}
          onBack={() => setStep(1)} onNext={() => setStep(3)} />
      )}
      {step === 3 && choice && (
        <StepDiscount accounts={accounts} choice={choice} keys={Array.from(selected)} allAccounts={allAccounts}
          onBack={() => setStep(2)} onStarted={(j) => { setJobs(j); setStep(4); }} />
      )}
      {step === 4 && <JobsResult jobs={jobs} onClose={() => { onFinished(); onClose(); }} />}
    </div>
  );
}

// ── Paso 1 ────────────────────────────────────────────────────────────────

function ChoiceCard({ icon, title, text, onClick, badge }: { icon: string; title: string; text: string; onClick: () => void; badge?: string }) {
  return (
    <button type="button" onClick={onClick}
      className="group flex h-full flex-col items-start gap-1.5 rounded-xl border border-gray-200 bg-white p-4 text-left transition hover:border-[var(--brand)] hover:shadow-sm">
      <span className="flex w-full items-center justify-between">
        <span className="text-2xl">{icon}</span>
        {badge && <span className="ui-badge ui-badge--info">{badge}</span>}
      </span>
      <span className="text-sm font-semibold text-gray-900 group-hover:text-[var(--brand-ink)]">{title}</span>
      <span className="text-xs leading-relaxed text-gray-500">{text}</span>
    </button>
  );
}

function StepChoose({ accounts, scope, onChoose }: { accounts: Account[]; scope: Account[]; onChoose: (c: Choice) => void }) {
  const [campaigns, setCampaigns] = useState<MlPromoCampaign[] | null>(null);
  const [creating, setCreating] = useState<'SELLER_CAMPAIGN' | 'VOLUME' | null>(null);

  useEffect(() => {
    api.marketplace.promotions.campaigns(getToken()!).then(setCampaigns).catch(() => setCampaigns([]));
  }, []);

  const inScope = (campaigns || []).filter((c) => scope.some((a) => a.id === c.connection.id));
  const invitations = groupCampaigns(inScope.filter((c) => c.origin === 'INVITATION' && (daysLeft(c.deadlineDate) ?? 1) >= 0));
  const own = groupCampaigns(inScope.filter((c) => c.origin === 'OWN'));

  if (creating) {
    return <CreateCampaign accounts={accounts} scope={scope} type={creating} onCancel={() => setCreating(null)}
      onCreated={(c) => onChoose({ type: c.type, group: { key: c.id, type: c.type, name: c.name || TYPE_INFO[c.type].label, members: [c] } })} />;
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ChoiceCard icon="🏷️" title="Bajar el precio unos días" text="Descuento individual en los productos que elijas, en una o varias cuentas. Entre 5% y 80%, hasta 14 días."
          onClick={() => onChoose({ type: 'PRICE_DISCOUNT', group: null })} />
        <ChoiceCard icon="🤝" title="Sumarme a una campaña de ML" text="Invitaciones de Mercado Libre, muchas con parte del descuento pagado por ML."
          badge={invitations.length ? `${invitations.length} vigente(s)` : undefined}
          onClick={() => document.getElementById('promo-invitations')?.scrollIntoView({ behavior: 'smooth' })} />
        <ChoiceCard icon="📣" title="Crear mi campaña" text="Una campaña con nombre propio (ej. “Cyber”) en una cuenta, hasta 14 días."
          onClick={() => setCreating('SELLER_CAMPAIGN')} />
        <ChoiceCard icon="🛍️" title="2x1 / 3x2 / 2da unidad" text="Descuento por cantidad: el comprador lleva más y paga menos."
          onClick={() => setCreating('VOLUME')} />
      </div>

      <div id="promo-invitations">
        <p className="ui-subsection-title mb-2">Invitaciones de Mercado Libre</p>
        {campaigns === null ? <p className="text-sm text-gray-400">Cargando…</p>
          : invitations.length === 0 ? <p className="text-sm text-gray-400">No hay invitaciones vigentes en las cuentas elegidas. Usa “Actualizar desde ML” para revisar de nuevo.</p>
            : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {invitations.map((g) => <CampaignGroupCard key={g.key} g={g} accounts={accounts} onClick={() => onChoose({ type: g.type, group: g })} cta="Elegir productos" />)}
              </div>
            )}
      </div>

      {own.length > 0 && (
        <div>
          <p className="ui-subsection-title mb-2">Mis campañas</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {own.map((g) => <CampaignGroupCard key={g.key} g={g} accounts={accounts} onClick={() => onChoose({ type: g.type, group: g })} cta="Agregar productos" />)}
          </div>
        </div>
      )}
    </div>
  );
}

// Tarjeta de campaña agrupada: una línea por cuenta con sus invitados y participantes.
export function CampaignGroupCard({ g, accounts, onClick, cta, extra }: {
  g: CampaignGroup; accounts: Account[]; onClick: () => void; cta: string; extra?: (c: MlPromoCampaign) => React.ReactNode;
}) {
  const first = g.members[0];
  const deadlines = g.members.map((m) => daysLeft(m.deadlineDate)).filter((x): x is number => x != null);
  const left = deadlines.length ? Math.min(...deadlines) : null;
  const meli = Number(first.benefits?.meli_percent ?? 0);
  const seller = Number(first.benefits?.seller_percent ?? 0);
  const volume = g.type === 'VOLUME' ? (first.benefits?.name || (first.benefits?.buy_quantity ? `Lleva ${first.benefits.buy_quantity}${first.benefits.pay_quantity ? `, paga ${first.benefits.pay_quantity}` : ''}` : null)) : null;
  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-1 flex items-start justify-between gap-2">
        <TypeBadge type={g.type} />
        {left != null && left <= 3 && left >= 0 && <span className="ui-badge ui-badge--warn">Vence {left === 0 ? 'hoy' : `en ${left} día(s)`}</span>}
      </div>
      <p className="text-sm font-semibold text-gray-900">{g.name}</p>
      <p className="mb-2 text-xs text-gray-500">
        {day(first.startDate)} → {day(first.finishDate)}
        {first.deadlineDate ? ` · sumarse hasta ${day(first.deadlineDate)}` : ''}
      </p>
      {(meli > 0 || seller > 0 || volume) && (
        <div className="mb-2 flex flex-wrap gap-1.5 text-[11px]">
          {meli > 0 && <span className="rounded-full bg-green-50 px-2 py-0.5 font-semibold text-green-700">ML aporta {pct(meli)}</span>}
          {seller > 0 && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">tú {pct(seller)}</span>}
          {volume && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{volume}</span>}
        </div>
      )}
      <ul className="mb-3 space-y-1 border-t border-[var(--border-soft)] pt-2">
        {g.members.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-2 text-xs">
            <AccountDot accounts={accounts} id={m.connection.id} name={m.connection.name} />
            <span className="flex shrink-0 items-center gap-2 text-gray-500">
              <span>{m.candidates} invitado(s)</span>
              {m.active > 0 && <span className="text-blue-700">{m.active} participando</span>}
              {extra?.(m)}
            </span>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onClick} className="mt-auto self-start text-sm font-semibold text-[var(--brand)] hover:underline">{cta} →</button>
    </div>
  );
}

function CreateCampaign({ accounts, scope, type, onCancel, onCreated }: {
  accounts: Account[]; scope: Account[]; type: 'SELLER_CAMPAIGN' | 'VOLUME'; onCancel: () => void; onCreated: (c: MlPromoCampaign) => void;
}) {
  const [form, setForm] = useState({
    connectionId: scope[0]?.id || accounts[0]?.id || '', name: '', startDate: todayYmd(), days: '7',
    subType: 'BNGM', buyQuantity: '2', payQuantity: '1', discountPercentage: '50', allowCombination: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  async function create() {
    setBusy(true);
    setError('');
    try {
      const p = await api.marketplace.promotions.createCampaign({
        connectionId: form.connectionId, type, name: form.name, startDate: form.startDate, days: Number(form.days),
        ...(type === 'VOLUME' ? {
          subType: form.subType, buyQuantity: Number(form.buyQuantity), payQuantity: Number(form.payQuantity),
          discountPercentage: Number(form.discountPercentage), allowCombination: form.allowCombination,
        } : {}),
      }, getToken()!);
      // La campaña recién creada se elige con sus productos candidatos.
      const list = await api.marketplace.promotions.campaigns(getToken()!, { connectionId: form.connectionId });
      const c = list.find((x) => x.mlId === p.mlId);
      if (!c) throw new Error('La campaña se creó, pero aún no aparece. Actualiza desde ML en unos minutos.');
      onCreated(c);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <p className="text-sm font-semibold text-gray-900">{type === 'VOLUME' ? 'Nueva promoción por cantidad' : 'Nueva campaña del vendedor'}</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
        <div>
          <label className={labelCls}>Cuenta</label>
          <select value={form.connectionId} onChange={(e) => set('connectionId', e.target.value)} className={inputCls}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Nombre</label>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={type === 'VOLUME' ? 'Lleva 2 y ahorra' : 'Cyber octubre'} className={inputCls} />
        </div>
      </div>
      <p className="text-[11px] text-gray-400">Mercado Libre crea estas campañas por cuenta. Para otra cuenta, créala de nuevo eligiendo esa cuenta.</p>
      {type === 'VOLUME' && (
        <div className="space-y-3 rounded-xl border border-gray-200 p-3">
          <div className="flex flex-wrap gap-1.5">
            {([['BNGM', 'Lleva X, paga Y'], ['SPONTH', 'X unidad con % de descuento'], ['BNSP', 'Llevando X, % en todas']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => set('subType', k)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${form.subType === k ? 'border-[var(--navy)] bg-[var(--navy)] text-white' : 'border-gray-200 bg-white text-gray-600'}`}>{l}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <div><label className={labelCls}>{form.subType === 'SPONTH' ? 'En la unidad n°' : 'Lleva'}</label><input type="number" min={2} value={form.buyQuantity} onChange={(e) => set('buyQuantity', e.target.value)} className={`${inputCls} w-24`} /></div>
            {form.subType === 'BNGM'
              ? <div><label className={labelCls}>Paga</label><input type="number" min={1} value={form.payQuantity} onChange={(e) => set('payQuantity', e.target.value)} className={`${inputCls} w-24`} /></div>
              : <div><label className={labelCls}>Descuento %</label><input type="number" min={1} max={70} value={form.discountPercentage} onChange={(e) => set('discountPercentage', e.target.value)} className={`${inputCls} w-24`} /></div>}
            <label className="flex items-center gap-2 pb-2 text-xs text-gray-600">
              <input type="checkbox" checked={form.allowCombination} onChange={(e) => set('allowCombination', e.target.checked)} />
              Se pueden combinar productos distintos
            </label>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <div><label className={labelCls}>Desde</label><input type="date" min={todayYmd()} value={form.startDate} onChange={(e) => set('startDate', e.target.value)} className={inputCls} /></div>
        <div>
          <label className={labelCls}>Duración (días)</label>
          <input type="number" min={1} max={type === 'SELLER_CAMPAIGN' ? 14 : 60} value={form.days} onChange={(e) => set('days', e.target.value)} className={`${inputCls} w-28`} />
        </div>
      </div>
      <FormError message={error} />
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className={btnSecondary}>Volver</button>
        <button type="button" onClick={create} disabled={busy || !form.name.trim() || !form.connectionId} className={btnPrimary}>{busy ? 'Creando en Mercado Libre…' : 'Crear y elegir productos'}</button>
      </div>
    </div>
  );
}

// ── Paso 2 ────────────────────────────────────────────────────────────────

const PROMO_FILTERS: Array<[string, string]> = [['', 'Todas'], ['none', 'Sin promoción'], ['active', 'Ya en promoción'], ['invited', 'Invitadas por ML'], ['nocost', 'Sin costo cargado']];
const emptyFilters = (campaign: boolean) => ({ search: '', account: '', category: '', minStock: '', minMargin: '', noSalesDays: '', promo: '', status: campaign ? 'candidate' : '' });

function StepProducts({ accounts, scope, companyId, choice, selected, setSelected, preselectProducts, allAccounts, setAllAccounts, onBack, onNext }: {
  accounts: Account[]; scope: Account[]; companyId?: string; choice: Choice; selected: Set<string>; setSelected: (s: Set<string>) => void;
  preselectProducts: string[] | null; allAccounts: boolean; setAllAccounts: (v: boolean) => void; onBack: () => void; onNext: () => void;
}) {
  const isCampaign = !!choice.group;
  const accountsHere = isCampaign ? choice.group!.members.map((m) => m.connection) : scope;
  const [filters, setFilters] = useState(emptyFilters(isCampaign));
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MlPromoItemsPage | null>(null);
  const [loading, setLoading] = useState(false);
  const preselected = useRef(false);
  const target = useMemo(() => (isCampaign
    ? { targets: choice.group!.members.map((m) => `${m.connection.id}:${m.mlId}`).join(',') }
    : { connectionIds: scope.map((a) => a.id).join(','), companyId }), [isCampaign, choice.group, scope, companyId]);

  const load = useCallback(() => {
    setLoading(true);
    const first = preselectProducts && !preselected.current;
    api.marketplace.promotions.items(getToken()!, {
      ...target, page, pageSize: 50, ...applied, ...(first ? { productIds: preselectProducts!.join(',') } : {}),
    }).then((d) => {
      // Desde el catálogo: los productos elegidos llegan seleccionados (en todas sus cuentas).
      if (first) {
        preselected.current = true;
        setSelected(new Set(d.allIds));
        setApplied((a) => ({ ...a }));
        return;
      }
      setData(d);
    }).catch(() => setData(null)).finally(() => setLoading(false));
  }, [target, page, applied, preselectProducts, setSelected]);
  useEffect(() => {
    const id = setTimeout(load, 0);
    return () => clearTimeout(id);
  }, [load]);

  const advanced = [applied.category, applied.minStock, applied.minMargin, applied.noSalesDays, applied.promo].filter(Boolean).length;
  const rows = data?.rows || [];
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.key));
  const toggle = (k: string) => { const n = new Set(selected); if (n.has(k)) n.delete(k); else n.add(k); setSelected(n); };
  const togglePage = () => { const n = new Set(selected); rows.forEach((r) => (allOnPage ? n.delete(r.key) : n.add(r.key))); setSelected(n); };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const accountsSelected = new Set(Array.from(selected).map((k) => k.split('|')[0])).size;

  return (
    <div>
      <FilterBar
        sticky={false}
        search={{ label: 'Buscar', value: filters.search, onChange: (v) => setFilters((f) => ({ ...f, search: v })), placeholder: 'Nombre, SKU o código ML…' }}
        primary={(
          <>
            {accountsHere.length > 1 && (
              <FilterField label="Cuenta">
                <select value={filters.account} onChange={(e) => { const f = { ...filters, account: e.target.value }; setFilters(f); setApplied(f); setPage(1); }} className={filterSelectCls}>
                  <option value="">Todas</option>
                  {accountsHere.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </FilterField>
            )}
            {isCampaign && (
              <FilterField label="Estado">
                <select value={filters.status} onChange={(e) => { const f = { ...filters, status: e.target.value }; setFilters(f); setApplied(f); setPage(1); }} className={filterSelectCls}>
                  <option value="candidate">Invitados (para sumar)</option>
                  <option value="started">Participando</option>
                  <option value="pending">Programados</option>
                  <option value="">Todos</option>
                </select>
              </FilterField>
            )}
          </>
        )}
        activeCount={advanced}
        onApply={() => { setApplied(filters); setPage(1); }}
        onClear={() => { const f = emptyFilters(isCampaign); setFilters(f); setApplied(f); setPage(1); }}
        summary={data ? <FilterCount n={data.total} label="publicaciones" /> : null}
      >
        <FilterField label="Categoría">
          <select value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))} className={filterSelectCls}>
            <option value="">Todas</option>
            {(data?.categories || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </FilterField>
        <FilterField label="Stock desde">
          <input type="number" min={0} value={filters.minStock} onChange={(e) => setFilters((f) => ({ ...f, minStock: e.target.value }))} className={`${filterInputCls} w-24`} />
        </FilterField>
        <FilterField label={isCampaign ? 'Margen en la promo desde %' : 'Margen actual desde %'}>
          <input type="number" value={filters.minMargin} onChange={(e) => setFilters((f) => ({ ...f, minMargin: e.target.value }))} className={`${filterInputCls} w-24`} />
        </FilterField>
        <FilterField label="Sin ventas en">
          <select value={filters.noSalesDays} onChange={(e) => setFilters((f) => ({ ...f, noSalesDays: e.target.value }))} className={filterSelectCls}>
            <option value="">Cualquiera</option>
            <option value="15">15 días</option><option value="30">30 días</option><option value="60">60 días</option><option value="90">90 días</option>
          </select>
        </FilterField>
        <FilterField label="Promoción actual">
          <select value={filters.promo} onChange={(e) => setFilters((f) => ({ ...f, promo: e.target.value }))} className={filterSelectCls}>
            {PROMO_FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </FilterField>
      </FilterBar>

      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
        <span className="font-semibold text-gray-800">{selected.size} seleccionada(s){accountsSelected > 1 ? ` en ${accountsSelected} cuentas` : ''}</span>
        {data && data.total > 0 && (
          <button type="button" onClick={() => setSelected(new Set([...selected, ...data.allIds]))} className="font-medium text-[var(--brand)] hover:underline">
            Seleccionar las {data.total} del filtro
          </button>
        )}
        {selected.size > 0 && <button type="button" onClick={() => setSelected(new Set())} className="text-gray-500 hover:underline">Quitar selección</button>}
        {choice.type === 'PRICE_DISCOUNT' && accounts.length > 1 && (
          <label className="ml-auto flex items-center gap-2 text-gray-700">
            <input type="checkbox" checked={allAccounts} onChange={(e) => setAllAccounts(e.target.checked)} />
            Aplicar también en las otras cuentas donde está publicado
          </label>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="w-10 px-3 py-2"><input type="checkbox" checked={allOnPage} onChange={togglePage} aria-label="Seleccionar página" /></th>
              <th className="px-3 py-2">Producto</th>
              <th className="px-3 py-2">Cuenta</th>
              <th className="px-3 py-2 text-right">Stock</th>
              <th className="px-3 py-2 text-right">Precio actual</th>
              {isCampaign && <th className="px-3 py-2 text-right">{TYPE_INFO[choice.type].pricing === 'ML' ? 'Precio en la promo' : 'Sugerido por ML'}</th>}
              <th className="px-3 py-2 text-right" title={MARGIN_NOTE}>{isCampaign ? 'Margen en la promo' : 'Margen actual'}</th>
              <th className="px-3 py-2">Promociones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && !rows.length && <tr><td colSpan={8} className="p-6 text-center text-gray-400">Cargando publicaciones…</td></tr>}
            {!loading && !rows.length && (
              <tr><td colSpan={8} className="p-6 text-center text-gray-400">
                {isCampaign ? 'No hay publicaciones con estos filtros en la campaña.' : 'No hay publicaciones activas con estos filtros.'}
              </td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.key} className={`cursor-pointer hover:bg-gray-50 ${selected.has(r.key) ? 'bg-[var(--brand-light)]' : ''}`} onClick={() => toggle(r.key)}>
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(r.key)} onChange={() => toggle(r.key)} /></td>
                <td className="max-w-[320px] px-3 py-2"><ProductCell title={r.title} thumbnail={r.thumbnail} product={r.product} itemId={r.itemId} permalink={r.permalink} /></td>
                <td className="max-w-[140px] px-3 py-2"><AccountDot accounts={accounts} id={r.connection.id} name={r.connection.name} /></td>
                <td className="px-3 py-2 text-right tabular-nums">{r.stock ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{clp(r.originalPrice)}</td>
                {isCampaign && (
                  <td className="px-3 py-2 text-right tabular-nums">
                    <PriceChange from={null} to={r.promo?.price ?? r.promo?.suggestedPrice ?? null} discount={r.promo?.discountPct} />
                    {r.promo?.meliPct ? <span className="block text-[11px] text-green-700">ML aporta {pct(r.promo.meliPct)}</span> : null}
                  </td>
                )}
                <td className="px-3 py-2 text-right"><MarginCell e={isCampaign ? r.promoEstimate : r.currentEstimate} /></td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {r.activePromos.map((a) => <span key={a.promoKey} className="ui-badge ui-badge--ok whitespace-nowrap" title={a.typeLabel}>{TYPE_INFO[a.type]?.short || a.typeLabel} {a.discountPct ? `−${pct(a.discountPct)}` : ''}</span>)}
                    {isCampaign && r.promo && r.promo.status !== 'candidate' && <StatusBadge status={r.promo.status} />}
                    {!isCampaign && r.invitations > 0 && <span className="ui-badge ui-badge--neutral">{r.invitations} invitación(es)</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-2 flex items-center justify-end gap-2 text-xs">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className={btnSecondary}>Anterior</button>
          <span className="text-gray-500">Página {page} de {pages}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className={btnSecondary}>Siguiente</button>
        </div>
      )}

      <div className="sticky bottom-0 -mx-4 mt-4 flex items-center justify-between gap-2 border-t border-gray-100 bg-white px-4 py-3 sm:-mx-5 sm:px-5">
        <button type="button" onClick={onBack} className={btnSecondary}>← Volver</button>
        <button type="button" onClick={onNext} disabled={!selected.size} className={btnPrimary}>
          Continuar con {selected.size} publicación(es) →
        </button>
      </div>
    </div>
  );
}

// ── Paso 3 ────────────────────────────────────────────────────────────────

function StepDiscount({ accounts, choice, keys, allAccounts, onBack, onStarted }: {
  accounts: Account[]; choice: Choice; keys: string[]; allAccounts: boolean; onBack: () => void; onStarted: (j: MlPromoJob[]) => void;
}) {
  const info = TYPE_INFO[choice.type];
  const sellerPriced = info.pricing === 'SELLER';
  const hasSuggestion = !!choice.group && sellerPriced;
  const [mode, setMode] = useState<MlPromoPriceMode>(hasSuggestion ? 'SUGGESTED' : 'PERCENT');
  const [percent, setPercent] = useState('15');
  const [minMargin, setMinMargin] = useState('');
  const [bestMargin, setBestMargin] = useState('15');
  const [loyalty, setLoyalty] = useState('');
  const [startDate, setStartDate] = useState(todayYmd());
  const [days, setDays] = useState('7');
  const [stock, setStock] = useState('');
  const [manual, setManual] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<MlPromoPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [includeWarn, setIncludeWarn] = useState(true);
  const [busy, setBusy] = useState(false);

  // Publicaciones elegidas agrupadas por cuenta, con la campaña de esa cuenta.
  const targets = useMemo(() => {
    const byConn = new Map<string, string[]>();
    for (const k of keys) {
      const [connectionId, itemId] = k.split('|');
      byConn.set(connectionId, [...(byConn.get(connectionId) || []), itemId]);
    }
    return Array.from(byConn.entries()).map(([connectionId, itemIds]) => ({
      connectionId, itemIds, promotionId: choice.group?.members.find((m) => m.connection.id === connectionId)?.mlId || null,
    }));
  }, [keys, choice.group]);

  const params = useMemo(() => ({
    type: choice.type, targets, allAccounts, mode, percent: Number(percent) || undefined,
    minMarginPct: mode === 'BEST_MARGIN' ? Number(bestMargin) || 0 : minMargin !== '' ? Number(minMargin) : undefined,
    loyaltyExtraPts: loyalty ? Number(loyalty) : undefined, stock: stock ? Number(stock) : undefined, manualPrices: manual,
  }), [choice.type, targets, allAccounts, mode, percent, minMargin, bestMargin, loyalty, stock, manual]);

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      setError('');
      api.marketplace.promotions.preview(params, getToken()!)
        .then(setPreview).catch((e) => setError((e as Error).message)).finally(() => setLoading(false));
    }, 400);
    return () => clearTimeout(t);
  }, [params]);

  const toApply = (preview?.rows || []).filter((r) => r.status === 'ok' || (includeWarn && r.status === 'warn'));
  const accountsToApply = new Set(toApply.map((r) => r.connection.id)).size;

  async function apply() {
    const finish = new Date(`${startDate}T12:00:00`);
    finish.setDate(finish.getDate() + Number(days) - 1);
    const what = choice.type === 'PRICE_DISCOUNT' ? `del ${day(startDate)} al ${day(finish.toISOString())}` : choice.group?.name ? `en "${choice.group.name}"` : '';
    const locked = choice.type === 'LIGHTNING' || choice.type === 'DOD';
    const where = accountsToApply > 1 ? ` en ${accountsToApply} cuentas` : '';
    if (!(await confirmDialog(`¿Aplicar ${info.label.toLowerCase()} a ${toApply.length} publicación(es)${where} ${what}?${locked ? ' Una vez activa, Mercado Libre no permite quitarla.' : ''}`))) return;
    setBusy(true);
    setError('');
    const byTarget = new Map<string, { connectionId: string; promotionId: string | null; items: Array<Record<string, unknown>> }>();
    for (const r of toApply) {
      const k = `${r.connection.id}|${r.promotionId || ''}`;
      const t = byTarget.get(k) || { connectionId: r.connection.id, promotionId: r.promotionId, items: [] };
      t.items.push({ itemId: r.itemId, price: r.price, topPrice: r.topPrice, stock: r.stock, offerId: r.offerId });
      byTarget.set(k, t);
    }
    try {
      const res = await api.marketplace.promotions.apply({ type: choice.type, startDate, days: Number(days), targets: Array.from(byTarget.values()) }, getToken()!);
      onStarted(res.jobs);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const modeCard = (k: MlPromoPriceMode, title: string, text: string, input?: React.ReactNode) => (
    <label className={`flex cursor-pointer flex-col gap-1.5 rounded-xl border p-3 ${mode === k ? 'border-[var(--brand)] bg-[var(--brand-light)]' : 'border-gray-200 bg-white'}`}>
      <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <input type="radio" checked={mode === k} onChange={() => setMode(k)} /> {title}
      </span>
      <span className="text-xs text-gray-500">{text}</span>
      {mode === k && input}
    </label>
  );
  const meli = Number(choice.group?.members[0]?.benefits?.meli_percent ?? 0);

  return (
    <div className="space-y-4">
      {sellerPriced ? (
        <div className="grid gap-3 md:grid-cols-3">
          {modeCard('PERCENT', 'Mismo % a todos', 'Un descuento parejo. Si queda fuera del rango que acepta ML, se ajusta solo.',
            <span className="flex items-center gap-2"><input type="number" min={1} max={80} value={percent} onChange={(e) => setPercent(e.target.value)} className={`${inputCls} w-24`} /><span className="text-sm text-gray-600">% de descuento</span></span>)}
          {hasSuggestion ? modeCard('SUGGESTED', 'Precio sugerido por ML', 'El precio que Mercado Libre recomienda para cada publicación de la campaña.') : null}
          {modeCard('BEST_MARGIN', 'El mayor descuento cuidando mi margen', 'Calcula para cada producto el precio más bajo que todavía deja el margen que pidas.',
            <span className="flex items-center gap-2"><input type="number" min={0} max={90} value={bestMargin} onChange={(e) => setBestMargin(e.target.value)} className={`${inputCls} w-24`} /><span className="text-sm text-gray-600">% de margen mínimo</span></span>)}
        </div>
      ) : (
        <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-900">
          En esta promoción <strong>el descuento lo define Mercado Libre</strong>{meli ? ` y ML pone ${pct(meli)}` : ''}. Solo eliges qué productos se suman; abajo ves cuánto ganas en cada uno.
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-gray-200 p-3">
        {choice.type === 'PRICE_DISCOUNT' && (
          <>
            <div><label className={labelCls}>Desde</label><input type="date" min={todayYmd()} value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} /></div>
            <div>
              <label className={labelCls}>Duración</label>
              <select value={days} onChange={(e) => setDays(e.target.value)} className={inputCls}>
                {Array.from({ length: 14 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d} día(s)</option>)}
              </select>
            </div>
          </>
        )}
        {mode !== 'BEST_MARGIN' && (
          <div>
            <label className={labelCls} title="Las publicaciones que queden bajo este margen se marcan con error y no se aplican">Bloquear si el margen baja de</label>
            <span className="flex items-center gap-2"><input type="number" value={minMargin} onChange={(e) => setMinMargin(e.target.value)} placeholder="Opcional" className={`${inputCls} w-24`} /><span className="text-sm text-gray-500">%</span></span>
          </div>
        )}
        {info.top && (
          <div>
            <label className={labelCls} title="Precio menor para compradores con Mercado Puntos nivel 3 a 6. ML exige al menos 5 puntos más (10 si el descuento supera 35%).">Extra para compradores leales</label>
            <span className="flex items-center gap-2"><input type="number" min={0} value={loyalty} onChange={(e) => setLoyalty(e.target.value)} placeholder="No" className={`${inputCls} w-24`} /><span className="text-sm text-gray-500">puntos % más</span></span>
          </div>
        )}
        {info.stock && (
          <div>
            <label className={labelCls}>Unidades reservadas por producto</label>
            <input type="number" min={1} value={stock} onChange={(e) => setStock(e.target.value)} placeholder="Mínimo de ML" className={`${inputCls} w-32`} />
          </div>
        )}
        <p className="basis-full text-[11px] text-gray-400">{MARGIN_NOTE}{allAccounts ? ' · Incluye el mismo producto en las demás cuentas donde está publicado.' : ''}</p>
      </div>

      {preview && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="ui-stat"><div className="ui-stat-value text-[var(--ok)]">{preview.totals.ok}</div><div className="ui-stat-label">Listas para aplicar</div></div>
          <div className="ui-stat"><div className="ui-stat-value text-[var(--warn)]">{preview.totals.warn}</div><div className="ui-stat-label">Con aviso</div></div>
          <div className="ui-stat"><div className="ui-stat-value text-[var(--danger)]">{preview.totals.error}</div><div className="ui-stat-label">No se aplicarán</div></div>
          <div className="ui-stat"><div className="ui-stat-value">{pct(preview.totals.avgDiscount)} <span className="text-sm font-normal text-gray-400">/ {pct(preview.totals.avgMargin)}</span></div><div className="ui-stat-label">Descuento / margen promedio</div></div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="w-8 px-3 py-2"></th>
              <th className="px-3 py-2">Producto</th>
              <th className="px-3 py-2">Cuenta</th>
              <th className="px-3 py-2 text-right">Precio actual</th>
              <th className="px-3 py-2 text-right">Precio promoción</th>
              <th className="px-3 py-2 text-right" title={MARGIN_NOTE}>Margen</th>
              <th className="px-3 py-2">Detalle</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && !preview && <tr><td colSpan={7} className="p-6 text-center text-gray-400">Calculando precios y márgenes…</td></tr>}
            {(preview?.rows || []).map((r) => (
              <tr key={r.key} className={r.status === 'error' ? 'bg-red-50/40' : ''}>
                <td className="px-3 py-2 text-center text-base">{r.status === 'ok' ? '✅' : r.status === 'warn' ? '⚠️' : '⛔'}</td>
                <td className="max-w-[280px] px-3 py-2"><ProductCell title={r.title} thumbnail={r.thumbnail} product={r.product} itemId={r.itemId} /></td>
                <td className="max-w-[140px] px-3 py-2"><AccountDot accounts={accounts} id={r.connection.id} name={r.connection.name} /></td>
                <td className="px-3 py-2 text-right tabular-nums">{clp(r.originalPrice)}</td>
                <td className="px-3 py-2 text-right">
                  {sellerPriced ? (
                    <span className="inline-flex flex-col items-end gap-0.5">
                      <input type="number" value={manual[r.key] ?? r.price ?? ''} min={1}
                        onChange={(e) => { const v = e.target.value; setManual((m) => { const n = { ...m }; if (v) n[r.key] = Number(v); else delete n[r.key]; return n; }); }}
                        className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <span className="text-[11px] text-green-700">{r.discountPct ? `−${pct(r.discountPct)}` : ''}{r.topPrice ? ` · leales ${clp(r.topPrice)}` : ''}</span>
                    </span>
                  ) : <PriceChange from={null} to={r.price} discount={r.discountPct} />}
                  {r.minPrice != null && r.maxPrice != null && <span className="block text-[10px] text-gray-400">ML acepta {clp(Math.min(r.minPrice, r.maxPrice))}–{clp(Math.max(r.minPrice, r.maxPrice))}</span>}
                </td>
                <td className="px-3 py-2 text-right"><MarginCell e={r.estimate} /></td>
                <td className="px-3 py-2 text-xs text-gray-600">
                  {r.messages.length ? <ul className="space-y-0.5">{r.messages.map((m, i) => <li key={i}>{m}</li>)}</ul> : <span className="text-gray-300">—</span>}
                  {r.stock != null && <span className="block text-gray-500">{r.stock} unidad(es) reservadas</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <FormError message={error} />
      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 bg-white px-4 py-3 sm:-mx-5 sm:px-5">
        <button type="button" onClick={onBack} disabled={busy} className={btnSecondary}>← Cambiar productos</button>
        <div className="flex flex-wrap items-center gap-3">
          {!!preview?.totals.warn && (
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={includeWarn} onChange={(e) => setIncludeWarn(e.target.checked)} /> Incluir las que tienen aviso
            </label>
          )}
          <button type="button" onClick={apply} disabled={busy || loading || !toApply.length} className={btnPrimary}>
            {busy ? 'Enviando…' : `Aplicar a ${toApply.length} publicación(es)${accountsToApply > 1 ? ` en ${accountsToApply} cuentas` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Paso 4 ────────────────────────────────────────────────────────────────

// Avance de una o varias aplicaciones (una por cuenta).
export function JobsResult({ jobs, onClose }: { jobs: MlPromoJob[]; onClose: () => void }) {
  return (
    <div className="space-y-4">
      {jobs.map((j) => <JobProgress key={j.id} job={j} />)}
      <p className="text-xs text-gray-500">
        Sigue en segundo plano aunque cierres esta pantalla. Mercado Libre puede tardar unos minutos en mostrar el descuento; mientras dure la promoción, el sistema no envía el precio a esas publicaciones.
      </p>
      <button type="button" onClick={onClose} className={btnPrimary}>Volver a promociones</button>
    </div>
  );
}

function JobProgress({ job: initial }: { job: MlPromoJob }) {
  const [job, setJob] = useState(initial);
  useEffect(() => {
    if (job.status !== 'RUNNING') return;
    const t = setInterval(() => {
      api.marketplace.promotions.job(job.id, getToken()!).then(setJob).catch(() => {});
    }, 2000);
    return () => clearInterval(t);
  }, [job.id, job.status]);
  const progress = job.total ? Math.round((job.done / job.total) * 100) : 0;
  const failed = (job.results || []).filter((r) => !r.ok);
  return (
    <div className="rounded-xl border border-gray-200 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900">{job.title}</p>
        <span className="flex gap-3 text-xs">
          <span className="text-gray-500">{job.done} de {job.total}</span>
          <span className="text-green-700">✅ {job.ok}</span>
          {job.failed > 0 && <span className="text-red-600">⛔ {job.failed}</span>}
          {job.status === 'RUNNING' && <span className="ui-badge ui-badge--info">Aplicando…</span>}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-[var(--brand)] transition-all" style={{ width: `${progress}%` }} />
      </div>
      {failed.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-gray-700">
          {failed.map((r) => <li key={r.itemId}><strong>{r.title || r.itemId}</strong>: <span className="text-red-600">{r.error}</span></li>)}
        </ul>
      )}
    </div>
  );
}

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
  MARGIN_NOTE, MarginCell, PriceChange, ProductCell, StatusBadge, TYPE_INFO, TypeBadge, clp, day, daysLeft, pct, todayYmd,
} from './shared';

export type WizardStart = { type?: MlPromoType; campaign?: MlPromoCampaign; productIds?: string[] };

type Choice = { type: MlPromoType; campaign: MlPromoCampaign | null };

const STEPS = ['Qué quieres hacer', 'Elige productos', 'Define el descuento', 'Resultado'];

export function PromoWizard({ connectionId, start, onClose, onFinished }: {
  connectionId: string; start: WizardStart; onClose: () => void; onFinished: () => void;
}) {
  const initialChoice: Choice | null = start.campaign ? { type: start.campaign.type, campaign: start.campaign }
    : start.type && start.type !== 'SELLER_CAMPAIGN' && start.type !== 'VOLUME' ? { type: start.type, campaign: null } : null;
  const [step, setStep] = useState(initialChoice ? 2 : 1);
  const [choice, setChoice] = useState<Choice | null>(initialChoice);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [job, setJob] = useState<MlPromoJob | null>(null);
  const [preselectProducts] = useState(start.productIds || null);

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
          <span className="font-medium text-gray-800">{choice.campaign?.name || TYPE_INFO[choice.type].label}</span>
          <span className="text-xs text-gray-500">{TYPE_INFO[choice.type].hint}</span>
        </div>
      )}

      {step === 1 && (
        <StepChoose connectionId={connectionId} onChoose={(c) => { setChoice(c); setSelected(new Set()); setStep(2); }} />
      )}
      {step === 2 && choice && (
        <StepProducts connectionId={connectionId} choice={choice} selected={selected} setSelected={setSelected} preselectProducts={preselectProducts}
          onBack={() => setStep(1)} onNext={() => setStep(3)} />
      )}
      {step === 3 && choice && (
        <StepDiscount connectionId={connectionId} choice={choice} itemIds={Array.from(selected)}
          onBack={() => setStep(2)} onStarted={(j) => { setJob(j); setStep(4); }} />
      )}
      {step === 4 && job && <StepResult job={job} onClose={() => { onFinished(); onClose(); }} />}
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

function StepChoose({ connectionId, onChoose }: { connectionId: string; onChoose: (c: Choice) => void }) {
  const [campaigns, setCampaigns] = useState<MlPromoCampaign[] | null>(null);
  const [creating, setCreating] = useState<'SELLER_CAMPAIGN' | 'VOLUME' | null>(null);

  useEffect(() => {
    api.marketplace.promotions.campaigns(getToken()!, { connectionId }).then(setCampaigns).catch(() => setCampaigns([]));
  }, [connectionId]);

  const invitations = (campaigns || []).filter((c) => c.origin === 'INVITATION' && (daysLeft(c.deadlineDate) ?? 1) >= 0);
  const own = (campaigns || []).filter((c) => c.origin === 'OWN');

  if (creating) {
    return <CreateCampaign connectionId={connectionId} type={creating} onCancel={() => setCreating(null)}
      onCreated={(c) => onChoose({ type: c.type, campaign: c })} />;
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ChoiceCard icon="🏷️" title="Bajar el precio unos días" text="Descuento individual en los productos que elijas. Entre 5% y 80%, hasta 14 días."
          onClick={() => onChoose({ type: 'PRICE_DISCOUNT', campaign: null })} />
        <ChoiceCard icon="🤝" title="Sumarme a una campaña de ML" text="Invitaciones de Mercado Libre, muchas con parte del descuento pagado por ML."
          badge={invitations.length ? `${invitations.length} vigente(s)` : undefined}
          onClick={() => document.getElementById('promo-invitations')?.scrollIntoView({ behavior: 'smooth' })} />
        <ChoiceCard icon="📣" title="Crear mi campaña" text="Una campaña con nombre propio (ej. “Cyber”) para agrupar descuentos, hasta 14 días."
          onClick={() => setCreating('SELLER_CAMPAIGN')} />
        <ChoiceCard icon="🛍️" title="2x1 / 3x2 / 2da unidad" text="Descuento por cantidad: el comprador lleva más y paga menos."
          onClick={() => setCreating('VOLUME')} />
      </div>

      <div id="promo-invitations">
        <p className="ui-subsection-title mb-2">Invitaciones de Mercado Libre</p>
        {campaigns === null ? <p className="text-sm text-gray-400">Cargando…</p>
          : invitations.length === 0 ? <p className="text-sm text-gray-400">No hay invitaciones vigentes en esta cuenta. Usa “Actualizar desde ML” para revisar de nuevo.</p>
            : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {invitations.map((c) => <CampaignCard key={c.id} c={c} onClick={() => onChoose({ type: c.type, campaign: c })} cta="Elegir productos" />)}
              </div>
            )}
      </div>

      {own.length > 0 && (
        <div>
          <p className="ui-subsection-title mb-2">Mis campañas</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {own.map((c) => <CampaignCard key={c.id} c={c} onClick={() => onChoose({ type: c.type, campaign: c })} cta="Agregar productos" />)}
          </div>
        </div>
      )}
    </div>
  );
}

export function CampaignCard({ c, onClick, cta, extra }: { c: MlPromoCampaign; onClick: () => void; cta: string; extra?: React.ReactNode }) {
  const left = daysLeft(c.deadlineDate);
  const meli = Number(c.benefits?.meli_percent ?? 0);
  const seller = Number(c.benefits?.seller_percent ?? 0);
  const volume = c.type === 'VOLUME' ? (c.benefits?.name || (c.benefits?.buy_quantity ? `Lleva ${c.benefits.buy_quantity}${c.benefits.pay_quantity ? `, paga ${c.benefits.pay_quantity}` : ''}` : null)) : null;
  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-1 flex items-start justify-between gap-2">
        <TypeBadge type={c.type} />
        {left != null && left <= 3 && left >= 0 && <span className="ui-badge ui-badge--warn">Vence {left === 0 ? 'hoy' : `en ${left} día(s)`}</span>}
      </div>
      <p className="text-sm font-semibold text-gray-900">{c.name || TYPE_INFO[c.type]?.label}</p>
      <p className="mb-2 text-xs text-gray-500">
        {day(c.startDate)} → {day(c.finishDate)}
        {c.deadlineDate ? ` · sumarse hasta ${day(c.deadlineDate)}` : ''}
      </p>
      <div className="mb-3 flex flex-wrap gap-1.5 text-[11px]">
        {meli > 0 && <span className="rounded-full bg-green-50 px-2 py-0.5 font-semibold text-green-700">ML aporta {pct(meli)}</span>}
        {seller > 0 && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">tú {pct(seller)}</span>}
        {volume && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{volume}</span>}
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{c.candidates} invitado(s)</span>
        {c.active > 0 && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">{c.active} participando</span>}
      </div>
      <div className="mt-auto flex items-center justify-between gap-2">
        <button type="button" onClick={onClick} className="text-sm font-semibold text-[var(--brand)] hover:underline">{cta} →</button>
        {extra}
      </div>
    </div>
  );
}

function CreateCampaign({ connectionId, type, onCancel, onCreated }: {
  connectionId: string; type: 'SELLER_CAMPAIGN' | 'VOLUME'; onCancel: () => void; onCreated: (c: MlPromoCampaign) => void;
}) {
  const [form, setForm] = useState({ name: '', startDate: todayYmd(), days: '7', subType: 'BNGM', buyQuantity: '2', payQuantity: '1', discountPercentage: '50', allowCombination: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  async function create() {
    setBusy(true);
    setError('');
    try {
      const p = await api.marketplace.promotions.createCampaign({
        connectionId, type, name: form.name, startDate: form.startDate, days: Number(form.days),
        ...(type === 'VOLUME' ? {
          subType: form.subType, buyQuantity: Number(form.buyQuantity), payQuantity: Number(form.payQuantity),
          discountPercentage: Number(form.discountPercentage), allowCombination: form.allowCombination,
        } : {}),
      }, getToken()!);
      // La campaña recién creada se elige con sus productos candidatos.
      const list = await api.marketplace.promotions.campaigns(getToken()!, { connectionId });
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
      <div>
        <label className={labelCls}>Nombre</label>
        <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={type === 'VOLUME' ? 'Lleva 2 y ahorra' : 'Cyber octubre'} className={inputCls} />
      </div>
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
        <button type="button" onClick={create} disabled={busy || !form.name.trim()} className={btnPrimary}>{busy ? 'Creando en Mercado Libre…' : 'Crear y elegir productos'}</button>
      </div>
    </div>
  );
}

// ── Paso 2 ────────────────────────────────────────────────────────────────

const PROMO_FILTERS: Array<[string, string]> = [['', 'Todas'], ['none', 'Sin promoción'], ['active', 'Ya en promoción'], ['invited', 'Invitadas por ML'], ['nocost', 'Sin costo cargado']];

function StepProducts({ connectionId, choice, selected, setSelected, preselectProducts, onBack, onNext }: {
  connectionId: string; choice: Choice; selected: Set<string>; setSelected: (s: Set<string>) => void; preselectProducts: string[] | null;
  onBack: () => void; onNext: () => void;
}) {
  const isCampaign = !!choice.campaign;
  const [filters, setFilters] = useState({ search: '', category: '', minStock: '', minMargin: '', noSalesDays: '', promo: '', status: isCampaign ? 'candidate' : '' });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MlPromoItemsPage | null>(null);
  const [loading, setLoading] = useState(false);
  const preselected = useRef(false);

  const load = useCallback(() => {
    setLoading(true);
    api.marketplace.promotions.items(getToken()!, {
      connectionId, promoKey: choice.campaign?.mlId, page, pageSize: 50, ...applied,
      ...(preselectProducts && !preselected.current ? { productIds: preselectProducts.join(',') } : {}),
    }).then((d) => {
      // Desde el catálogo: los productos elegidos llegan seleccionados.
      if (preselectProducts && !preselected.current) {
        preselected.current = true;
        setSelected(new Set(d.allIds));
        setApplied((a) => ({ ...a }));
        return;
      }
      setData(d);
    }).catch(() => setData(null)).finally(() => setLoading(false));
  }, [connectionId, choice.campaign?.mlId, page, applied, preselectProducts, setSelected]);
  useEffect(() => {
    const id = setTimeout(load, 0);
    return () => clearTimeout(id);
  }, [load]);

  const advanced = [applied.category, applied.minStock, applied.minMargin, applied.noSalesDays, applied.promo].filter(Boolean).length;
  const rows = data?.rows || [];
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.itemId));
  const toggle = (id: string) => { const n = new Set(selected); if (n.has(id)) n.delete(id); else n.add(id); setSelected(n); };
  const togglePage = () => { const n = new Set(selected); rows.forEach((r) => (allOnPage ? n.delete(r.itemId) : n.add(r.itemId))); setSelected(n); };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <FilterBar
        sticky={false}
        search={{ label: 'Buscar', value: filters.search, onChange: (v) => setFilters((f) => ({ ...f, search: v })), placeholder: 'Nombre, SKU o código ML…' }}
        primary={isCampaign ? (
          <FilterField label="Estado">
            <select value={filters.status} onChange={(e) => { const f = { ...filters, status: e.target.value }; setFilters(f); setApplied(f); setPage(1); }} className={filterSelectCls}>
              <option value="candidate">Invitados (para sumar)</option>
              <option value="started">Participando</option>
              <option value="pending">Programados</option>
              <option value="">Todos</option>
            </select>
          </FilterField>
        ) : undefined}
        activeCount={advanced}
        onApply={() => { setApplied(filters); setPage(1); }}
        onClear={() => { const f = { search: '', category: '', minStock: '', minMargin: '', noSalesDays: '', promo: '', status: isCampaign ? 'candidate' : '' }; setFilters(f); setApplied(f); setPage(1); }}
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
        <span className="font-semibold text-gray-800">{selected.size} seleccionada(s)</span>
        {data && data.total > 0 && (
          <button type="button" onClick={() => setSelected(new Set([...selected, ...data.allIds]))} className="font-medium text-[var(--brand)] hover:underline">
            Seleccionar las {data.total} del filtro
          </button>
        )}
        {selected.size > 0 && <button type="button" onClick={() => setSelected(new Set())} className="text-gray-500 hover:underline">Quitar selección</button>}
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="w-10 px-3 py-2"><input type="checkbox" checked={allOnPage} onChange={togglePage} aria-label="Seleccionar página" /></th>
              <th className="px-3 py-2">Producto</th>
              <th className="px-3 py-2 text-right">Stock</th>
              <th className="px-3 py-2 text-right">Precio actual</th>
              {isCampaign && <th className="px-3 py-2 text-right">{choice.campaign?.pricing === 'ML' ? 'Precio en la promo' : 'Sugerido por ML'}</th>}
              <th className="px-3 py-2 text-right" title={MARGIN_NOTE}>{isCampaign ? 'Margen en la promo' : 'Margen actual'}</th>
              <th className="px-3 py-2">Promociones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && !rows.length && <tr><td colSpan={7} className="p-6 text-center text-gray-400">Cargando publicaciones…</td></tr>}
            {!loading && !rows.length && (
              <tr><td colSpan={7} className="p-6 text-center text-gray-400">
                {isCampaign ? 'No hay publicaciones con estos filtros en la campaña.' : 'No hay publicaciones activas con estos filtros.'}
              </td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.itemId} className={`cursor-pointer hover:bg-gray-50 ${selected.has(r.itemId) ? 'bg-[var(--brand-light)]' : ''}`} onClick={() => toggle(r.itemId)}>
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(r.itemId)} onChange={() => toggle(r.itemId)} /></td>
                <td className="max-w-[340px] px-3 py-2"><ProductCell title={r.title} thumbnail={r.thumbnail} product={r.product} itemId={r.itemId} permalink={r.permalink} /></td>
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

function StepDiscount({ connectionId, choice, itemIds, onBack, onStarted }: {
  connectionId: string; choice: Choice; itemIds: string[]; onBack: () => void; onStarted: (j: MlPromoJob) => void;
}) {
  const info = TYPE_INFO[choice.type];
  const sellerPriced = info.pricing === 'SELLER';
  const hasSuggestion = !!choice.campaign && sellerPriced;
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

  const params = useMemo(() => ({
    connectionId, type: choice.type, promotionId: choice.campaign?.mlId, itemIds,
    mode, percent: Number(percent) || undefined,
    minMarginPct: mode === 'BEST_MARGIN' ? Number(bestMargin) || 0 : minMargin !== '' ? Number(minMargin) : undefined,
    loyaltyExtraPts: loyalty ? Number(loyalty) : undefined, stock: stock ? Number(stock) : undefined, manualPrices: manual,
  }), [connectionId, choice, itemIds, mode, percent, minMargin, bestMargin, loyalty, stock, manual]);

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

  async function apply() {
    const finish = new Date(`${startDate}T12:00:00`);
    finish.setDate(finish.getDate() + Number(days) - 1);
    const what = choice.type === 'PRICE_DISCOUNT'
      ? `del ${day(startDate)} al ${day(finish.toISOString())}`
      : choice.campaign?.name ? `en "${choice.campaign.name}"` : '';
    const locked = choice.type === 'LIGHTNING' || choice.type === 'DOD';
    if (!(await confirmDialog(`¿Aplicar ${info.label.toLowerCase()} a ${toApply.length} publicación(es) ${what}?${locked ? ' Una vez activa, Mercado Libre no permite quitarla.' : ''}`))) return;
    setBusy(true);
    setError('');
    try {
      const job = await api.marketplace.promotions.apply({
        connectionId, type: choice.type, promotionId: choice.campaign?.mlId, startDate, days: Number(days),
        items: toApply.map((r) => ({ itemId: r.itemId, price: r.price, topPrice: r.topPrice, stock: r.stock, offerId: r.offerId })),
      }, getToken()!);
      onStarted(job);
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

  return (
    <div className="space-y-4">
      {sellerPriced ? (
        <div className="grid gap-3 md:grid-cols-3">
          {modeCard('PERCENT', 'Mismo % a todos', 'Un descuento parejo. Si queda fuera del rango que acepta ML, se ajusta solo.',
            <span className="flex items-center gap-2"><input type="number" min={1} max={80} value={percent} onChange={(e) => setPercent(e.target.value)} className={`${inputCls} w-24`} /><span className="text-sm text-gray-600">% de descuento</span></span>)}
          {hasSuggestion
            ? modeCard('SUGGESTED', 'Precio sugerido por ML', 'El precio que Mercado Libre recomienda para cada publicación de la campaña.')
            : null}
          {modeCard('BEST_MARGIN', 'El mayor descuento cuidando mi margen', 'Calcula para cada producto el precio más bajo que todavía deja el margen que pidas.',
            <span className="flex items-center gap-2"><input type="number" min={0} max={90} value={bestMargin} onChange={(e) => setBestMargin(e.target.value)} className={`${inputCls} w-24`} /><span className="text-sm text-gray-600">% de margen mínimo</span></span>)}
        </div>
      ) : (
        <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-900">
          En esta promoción <strong>el descuento lo define Mercado Libre</strong>{choice.campaign?.benefits?.meli_percent ? ` y ML pone ${pct(Number(choice.campaign.benefits.meli_percent))}` : ''}. Solo eliges qué productos se suman; abajo ves cuánto ganas en cada uno.
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
        <p className="basis-full text-[11px] text-gray-400">{MARGIN_NOTE}</p>
      </div>

      {preview && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="ui-stat"><div className="ui-stat-value text-[var(--ok)]">{preview.totals.ok}</div><div className="ui-stat-label">Listas para aplicar</div></div>
          <div className="ui-stat"><div className="ui-stat-value text-[var(--warn)]">{preview.totals.warn}</div><div className="ui-stat-label">Con aviso</div></div>
          <div className="ui-stat"><div className="ui-stat-value text-[var(--danger)]">{preview.totals.error}</div><div className="ui-stat-label">No se aplicarán</div></div>
          <div className="ui-stat"><div className="ui-stat-value">{pct(preview.totals.avgDiscount)} <span className="text-sm font-normal text-gray-400">/ {pct(preview.totals.avgMargin)}</span></div><div className="ui-stat-label">Descuento / margen promedio</div></div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="w-8 px-3 py-2"></th>
              <th className="px-3 py-2">Producto</th>
              <th className="px-3 py-2 text-right">Precio actual</th>
              <th className="px-3 py-2 text-right">Precio promoción</th>
              <th className="px-3 py-2 text-right" title={MARGIN_NOTE}>Margen</th>
              <th className="px-3 py-2">Detalle</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && !preview && <tr><td colSpan={6} className="p-6 text-center text-gray-400">Calculando precios y márgenes…</td></tr>}
            {(preview?.rows || []).map((r) => (
              <tr key={r.itemId} className={r.status === 'error' ? 'bg-red-50/40' : ''}>
                <td className="px-3 py-2 text-center text-base">{r.status === 'ok' ? '✅' : r.status === 'warn' ? '⚠️' : '⛔'}</td>
                <td className="max-w-[300px] px-3 py-2"><ProductCell title={r.title} thumbnail={r.thumbnail} product={r.product} itemId={r.itemId} /></td>
                <td className="px-3 py-2 text-right tabular-nums">{clp(r.originalPrice)}</td>
                <td className="px-3 py-2 text-right">
                  {sellerPriced ? (
                    <span className="inline-flex flex-col items-end gap-0.5">
                      <input type="number" value={manual[r.itemId] ?? r.price ?? ''} min={1}
                        onChange={(e) => { const v = e.target.value; setManual((m) => { const n = { ...m }; if (v) n[r.itemId] = Number(v); else delete n[r.itemId]; return n; }); }}
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
            {busy ? 'Enviando…' : `Aplicar a ${toApply.length} publicación(es)`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Paso 4 ────────────────────────────────────────────────────────────────

export function StepResult({ job: initial, onClose }: { job: MlPromoJob; onClose: () => void }) {
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
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-gray-900">{job.title}</p>
        <p className="text-xs text-gray-500">{job.status === 'RUNNING' ? 'Aplicando en Mercado Libre… puedes cerrar esta pantalla, sigue en segundo plano.' : 'Terminado.'}</p>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-[var(--brand)] transition-all" style={{ width: `${progress}%` }} />
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <span>{job.done} de {job.total}</span>
        <span className="text-green-700">✅ {job.ok} aplicadas</span>
        {job.failed > 0 && <span className="text-red-600">⛔ {job.failed} rechazadas</span>}
      </div>
      {failed.length > 0 && (
        <div className="rounded-xl border border-red-100 bg-red-50/50 p-3">
          <p className="mb-1 text-xs font-semibold text-red-700">Rechazadas por Mercado Libre</p>
          <ul className="space-y-1 text-xs text-gray-700">
            {failed.map((r) => <li key={r.itemId}><strong>{r.title || r.itemId}</strong>: {r.error}</li>)}
          </ul>
        </div>
      )}
      {job.status !== 'RUNNING' && job.ok > 0 && (
        <p className="text-xs text-gray-500">Mercado Libre puede tardar unos minutos en mostrar el descuento. Mientras dure la promoción, el sistema no envía el precio a esas publicaciones para no quitar el descuento.</p>
      )}
      <button type="button" onClick={onClose} className={btnPrimary}>Volver a promociones</button>
    </div>
  );
}

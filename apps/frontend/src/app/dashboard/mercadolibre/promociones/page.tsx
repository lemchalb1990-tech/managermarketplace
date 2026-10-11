'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getToken } from '@/lib/auth';
import {
  api, type MlPromoActiveRow, type MlPromoCampaign, type MlPromoJob, type MlPromoSuggestion, type MlPromoSummary, type MlPromoType,
} from '@/lib/api';
import { onActivity } from '@/lib/activityBus';
import { FilterBar, FilterCount, FilterField, filterSelectCls } from '@/components/FilterBar';
import { btnPrimary, btnSecondary } from '@/components/ui/Modal';
import { useMlCompany } from '../MlCompanyContext';
import { alertDialog, confirmDialog } from '../../ConfirmDialog';
import { PromoWizard, CampaignGroupCard, JobsResult, groupCampaigns, type CampaignGroup, type WizardStart } from './PromoWizard';
import { RulesTab } from './RulesTab';
import {
  AccountDot, MARGIN_NOTE, MarginCell, PriceChange, ProductCell, StatusBadge, TYPE_INFO, TypeBadge, accountColor, day, daysLeft, type Account,
} from './shared';

type Tab = 'review' | 'active' | 'auto' | 'history';
type Quick = 'urgent' | 'meli' | 'lowMargin';
const ACCOUNTS_KEY = 'mp_promo_accounts';
const LOW_MARGIN = 10;
const CO_FUNDED: MlPromoType[] = ['MARKETPLACE_CAMPAIGN', 'SMART', 'PRICE_MATCHING', 'PRE_NEGOTIATED', 'UNHEALTHY_STOCK'];

// Filtros comunes a las pestañas.
type Filters = { search: string; type: string; status: string };
const emptyFilters: Filters = { search: '', type: '', status: '' };

export default function PromocionesPage() {
  return <Suspense fallback={null}><PromocionesInner /></Suspense>;
}

function PromocionesInner() {
  const { companyId } = useMlCompany();
  const params = useSearchParams();
  const router = useRouter();
  const initialTab = params.get('tab');
  const [tab, setTab] = useState<Tab>(initialTab === 'suggestions' ? 'review' : (initialTab as Tab) || 'review');
  const [summary, setSummary] = useState<MlPromoSummary | null>(null);
  // Cuentas elegidas arriba (vacío = todas).
  const [picked, setPicked] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]'); } catch { return []; }
  });
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [applied, setApplied] = useState<Filters>(emptyFilters);
  const [quick, setQuick] = useState<Set<Quick>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [reload, setReload] = useState(0);
  // Desde el catálogo: "Poner en promoción" llega con los productos elegidos (?products=…).
  const [wizard, setWizard] = useState<WizardStart | null>(() => {
    const products = params.get('products');
    return products ? { type: 'PRICE_DISCOUNT', productIds: products.split(',').filter(Boolean) } : null;
  });
  useEffect(() => {
    if (params.get('products')) router.replace('/dashboard/mercadolibre/promociones');
  }, [params, router]);

  const accounts: Account[] = useMemo(() => summary?.connections || [], [summary]);
  const selected = useMemo(() => picked.filter((id) => accounts.some((a) => a.id === id)), [picked, accounts]);
  const inScope = useCallback((connectionId: string) => !selected.length || selected.includes(connectionId), [selected]);

  const load = useCallback(() => {
    api.marketplace.promotions.summary(getToken()!, { companyId, connectionIds: picked.join(',') || undefined })
      .then(setSummary).catch(() => setSummary(null));
  }, [companyId, picked]);
  useEffect(() => { load(); }, [load, reload]);
  useEffect(() => onActivity(['promo'], () => setReload((n) => n + 1)), []);

  function togglePicked(id: string | null) {
    const next = id === null ? [] : picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setPicked(next);
    try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(next)); } catch {}
  }
  function toggleQuick(q: Quick) {
    setQuick((s) => { const n = new Set(s); if (n.has(q)) n.delete(q); else n.add(q); return n; });
  }
  function changeTab(t: Tab) {
    setTab(t);
    setFilters(emptyFilters);
    setApplied(emptyFilters);
    setQuick(new Set());
  }

  async function sync() {
    setSyncing(true);
    setSyncError('');
    try {
      const res = await api.marketplace.promotions.sync({ companyId }, getToken()!);
      if (res.errors?.length) setSyncError(res.errors.join(' · '));
      setReload((n) => n + 1);
    } catch (e) {
      setSyncError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  if (summary && !summary.connections.length) {
    return (
      <div className="max-w-6xl">
        <h1 className="ui-page-title mb-1">Promociones</h1>
        <div className="ui-card p-10 text-center text-sm text-gray-500">Conecta una cuenta de Mercado Libre para gestionar sus promociones.</div>
      </div>
    );
  }

  const s = summary;
  const statusOptions: Array<[string, string]> = tab === 'review'
    ? [['', 'Todo'], ['invitations', 'Invitaciones de ML'], ['suggestions', 'Sugerencias de reglas']]
    : [['', 'Todas'], ['started', 'Activas'], ['pending', 'Programadas']];
  const quickOptions: Array<[Quick, string]> = tab === 'review'
    ? [['urgent', 'Vence pronto'], ['meli', 'ML aporta'], ['lowMargin', 'Margen bajo']]
    : [['urgent', 'Termina pronto'], ['meli', 'ML aporta'], ['lowMargin', 'Margen bajo']];

  return (
    <div className="max-w-7xl">
      {/* Título y acciones en una sola línea, como el resto de las vistas */}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="ui-page-title mr-1">Promociones</h1>
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          {s?.lastSyncAt && <span className="hidden text-xs text-gray-400 md:inline">Actualizado {new Date(s.lastSyncAt).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
          <button type="button" onClick={sync} disabled={syncing || !accounts.length} className="ui-btn-secondary">{syncing ? 'Actualizando…' : 'Actualizar desde ML'}</button>
          {!wizard && (
            <button type="button" onClick={() => setWizard({})} disabled={!accounts.length}
              className="flex-1 sm:flex-none px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap">
              + Nueva promoción
            </button>
          )}
        </div>
      </div>
      {syncError && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{syncError}</p>}

      {/* Cuentas: todas a la vista, cada una con su color */}
      {accounts.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs font-semibold">
          <span className="mr-1 text-gray-500">Cuentas:</span>
          <button type="button" onClick={() => togglePicked(null)}
            className={`rounded-full px-3 py-1 ${!selected.length ? 'bg-[var(--navy)] text-white' : 'bg-gray-100 text-gray-600'}`}>Todas</button>
          {accounts.map((a) => {
            const on = selected.includes(a.id);
            return (
              <button key={a.id} type="button" onClick={() => togglePicked(a.id)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 ${on ? 'border-transparent text-white' : 'border-gray-200 bg-white text-gray-700'}`}
                style={on ? { background: accountColor(accounts, a.id) } : undefined}>
                <span className="h-2 w-2 rounded-full" style={{ background: on ? '#fff' : accountColor(accounts, a.id) }} />
                {a.name}
              </button>
            );
          })}
        </div>
      )}

      {wizard ? (
        <PromoWizard accounts={accounts} selectedAccounts={selected} companyId={companyId} start={wizard}
          onClose={() => setWizard(null)} onFinished={() => setReload((n) => n + 1)} />
      ) : (
        <>
          {/* Menú: tres tarjetas con lo importante de cada sección */}
          <div className="mb-2 grid gap-3 md:grid-cols-3">
            <TabCard active={tab === 'review'} onClick={() => changeTab('review')} title="Por revisar"
              value={s ? s.invitations + s.suggestions : null}
              lines={[`${s?.invitations ?? 0} invitación(es) de ML · ${s?.suggestions ?? 0} sugerencia(s)`]}
              alert={s?.urgent ? `${s.urgent} vence(n) en 3 días` : undefined} />
            <TabCard active={tab === 'active'} onClick={() => changeTab('active')} title="Activas"
              value={s?.active ?? null} lines={['publicaciones en promoción']}
              alert={s?.endingSoon ? `${s.endingSoon} termina(n) esta semana` : undefined} alertTone="info" />
            <TabCard active={tab === 'auto'} onClick={() => changeTab('auto')} title="Automatización"
              value={s?.rules ?? null} lines={['regla(s) activa(s) · solo sugieren']} />
          </div>
          <div className="mb-2 flex justify-end">
            <button type="button" onClick={() => changeTab('history')}
              className={`text-xs font-medium hover:underline ${tab === 'history' ? 'text-[var(--brand-ink)]' : 'text-gray-500'}`}>
              Historial de aplicaciones ↗
            </button>
          </div>

          {(tab === 'review' || tab === 'active') && (
            <>
              <FilterBar
                search={{ label: 'Buscar', value: filters.search, onChange: (v) => setFilters((f) => ({ ...f, search: v })), placeholder: tab === 'review' ? 'Campaña o producto…' : 'Producto, SKU o código ML…' }}
                primary={(
                  <>
                    <FilterField label="Tipo">
                      <select value={filters.type} onChange={(e) => { const f = { ...filters, type: e.target.value }; setFilters(f); setApplied(f); }} className={filterSelectCls}>
                        <option value="">Todos</option>
                        {(Object.keys(TYPE_INFO) as MlPromoType[]).map((t) => <option key={t} value={t}>{TYPE_INFO[t].label}</option>)}
                      </select>
                    </FilterField>
                    <FilterField label="Estado">
                      <select value={filters.status} onChange={(e) => { const f = { ...filters, status: e.target.value }; setFilters(f); setApplied(f); }} className={filterSelectCls}>
                        {statusOptions.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </FilterField>
                  </>
                )}
                onApply={() => setApplied(filters)}
                onClear={() => { setFilters(emptyFilters); setApplied(emptyFilters); setQuick(new Set()); }}
              />
              <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs font-semibold">
                <span className="mr-1 text-gray-500">Filtros rápidos:</span>
                {quickOptions.map(([k, l]) => (
                  <button key={k} type="button" onClick={() => toggleQuick(k)}
                    className={`rounded-full px-3 py-1 ${quick.has(k) ? 'bg-[var(--navy)] text-white' : 'bg-gray-100 text-gray-600'}`}>{l}</button>
                ))}
              </div>
            </>
          )}

          {tab === 'review' && <ReviewTab accounts={accounts} inScope={inScope} companyId={companyId} filters={applied} quick={quick} reload={reload}
            onOpen={(g) => setWizard({ group: g })} onChanged={() => setReload((n) => n + 1)} />}
          {tab === 'active' && <ActiveTab accounts={accounts} inScope={inScope} companyId={companyId} filters={applied} quick={quick} reload={reload}
            onOpen={(g) => setWizard({ group: g })} onChanged={() => setReload((n) => n + 1)} />}
          {tab === 'auto' && <RulesTab companyId={companyId} connections={accounts} onChanged={() => setReload((n) => n + 1)} />}
          {tab === 'history' && <HistoryTab accounts={accounts} inScope={inScope} companyId={companyId} reload={reload} />}
        </>
      )}
    </div>
  );
}

function TabCard({ active, onClick, title, value, lines, alert, alertTone = 'warn' }: {
  active: boolean; onClick: () => void; title: string; value: number | null; lines: string[]; alert?: string; alertTone?: 'warn' | 'info';
}) {
  return (
    <button type="button" onClick={onClick}
      className={`ui-stat flex flex-col items-start text-left transition hover:shadow-sm ${active ? '!border-[var(--brand)] ring-1 ring-[var(--brand)]' : ''}`}>
      <span className={`text-xs font-semibold uppercase tracking-wide ${active ? 'text-[var(--brand-ink)]' : 'text-gray-500'}`}>{title}</span>
      <span className="ui-stat-value mt-1">{value ?? '—'}</span>
      {lines.map((l) => <span key={l} className="ui-stat-label">{l}</span>)}
      {alert && <span className={`mt-1.5 ui-badge ui-badge--${alertTone}`}>{alert}</span>}
    </button>
  );
}

type TabProps = {
  accounts: Account[]; inScope: (connectionId: string) => boolean; companyId?: string; filters: Filters; quick: Set<Quick>; reload: number;
  onOpen: (g: CampaignGroup) => void; onChanged: () => void;
};

// ── Por revisar: invitaciones de ML (agrupadas entre cuentas) y sugerencias ──

function ReviewTab({ accounts, inScope, companyId, filters, quick, reload, onOpen, onChanged }: TabProps) {
  const [campaigns, setCampaigns] = useState<MlPromoCampaign[] | null>(null);
  const [suggestions, setSuggestions] = useState<MlPromoSuggestion[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<MlPromoJob[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    const t = getToken()!;
    api.marketplace.promotions.campaigns(t, { companyId, scope: 'INVITATION' }).then(setCampaigns).catch(() => setCampaigns([]));
    api.marketplace.promotions.suggestions(t, { companyId }).then((r) => { setSuggestions(r); setSelected(new Set()); }).catch(() => setSuggestions([]));
  }, [companyId, reload]);

  const q = filters.search.trim().toLowerCase();
  const showInvitations = filters.status !== 'suggestions' && !quick.has('lowMargin');
  const showSuggestions = filters.status !== 'invitations' && !quick.has('urgent');

  const groups = useMemo(() => groupCampaigns((campaigns || []).filter((c) => inScope(c.connection.id) && (daysLeft(c.deadlineDate) ?? 1) >= 0
    && (!filters.type || c.type === filters.type)
    && (!q || (c.name || '').toLowerCase().includes(q))
    && (!quick.has('urgent') || (daysLeft(c.deadlineDate) ?? 99) <= 3)
    && (!quick.has('meli') || Number(c.benefits?.meli_percent ?? 0) > 0 || CO_FUNDED.includes(c.type)))), [campaigns, inScope, filters.type, q, quick]);

  const sugs = useMemo(() => (suggestions || []).filter((r) => inScope(r.connection.id)
    && (!filters.type || r.type === filters.type)
    && (!q || `${r.title} ${r.product?.sku || ''} ${r.reason}`.toLowerCase().includes(q))
    && (!quick.has('meli') || CO_FUNDED.includes(r.type))
    && (!quick.has('lowMargin') || (r.marginPct ?? 0) < LOW_MARGIN)), [suggestions, inScope, filters.type, q, quick]);

  const byRule = useMemo(() => {
    const m = new Map<string, { rule: MlPromoSuggestion['rule']; rows: MlPromoSuggestion[] }>();
    for (const r of sugs) {
      const g = m.get(r.rule.id) || { rule: r.rule, rows: [] };
      g.rows.push(r);
      m.set(r.rule.id, g);
    }
    return Array.from(m.values());
  }, [sugs]);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const visibleSelected = sugs.filter((r) => selected.has(r.id)).map((r) => r.id);

  async function approve() {
    if (!visibleSelected.length) return;
    if (!(await confirmDialog(`¿Aplicar ${visibleSelected.length} promoción(es) sugerida(s) en Mercado Libre?`))) return;
    setBusy(true);
    try {
      const res = await api.marketplace.promotions.applySuggestions(visibleSelected, getToken()!);
      setJobs(res.jobs);
      setErrors(res.errors);
      onChanged();
    } catch (e) {
      setErrors([(e as Error).message]);
    } finally {
      setBusy(false);
    }
  }
  async function dismiss() {
    if (!visibleSelected.length) return;
    await api.marketplace.promotions.dismissSuggestions(visibleSelected, getToken()!).catch(() => null);
    onChanged();
  }

  if (jobs.length) return <div className="ui-card p-5"><JobsResult jobs={jobs} onClose={() => setJobs([])} /></div>;
  if (campaigns === null || suggestions === null) return <p className="text-sm text-gray-400">Cargando…</p>;

  return (
    <div className="space-y-5">
      {showInvitations && (
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="ui-subsection-title">Invitaciones de Mercado Libre</h2>
            <span className="text-xs text-[var(--text-2)]"><FilterCount n={groups.length} label="campaña(s)" /></span>
          </div>
          {groups.length === 0 ? (
            <div className="ui-card p-6 text-center text-sm text-gray-500">No hay invitaciones con estos filtros. Mercado Libre invita periódicamente; el sistema revisa cada 30 minutos.</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {groups.map((g) => <CampaignGroupCard key={g.key} g={g} accounts={accounts} onClick={() => onOpen(g)} cta="Ver productos y sumarme" />)}
            </div>
          )}
        </section>
      )}

      {showSuggestions && (
        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="ui-subsection-title">Sugerencias de tus reglas</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setSelected(new Set(sugs.map((r) => r.id)))} disabled={!sugs.length} className={btnSecondary}>Seleccionar todas</button>
              <button type="button" onClick={approve} disabled={busy || !visibleSelected.length} className={btnPrimary}>{busy ? 'Enviando…' : `Aprobar ${visibleSelected.length || ''}`}</button>
              <button type="button" onClick={dismiss} disabled={busy || !visibleSelected.length} className={btnSecondary}>Descartar</button>
            </div>
          </div>
          {errors.length > 0 && <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errors.join(' · ')}</div>}
          {byRule.length === 0 ? (
            <div className="ui-card p-6 text-center text-sm text-gray-500">No hay sugerencias pendientes con estos filtros. Crea reglas en Automatización para recibirlas; nada se aplica sin tu aprobación.</div>
          ) : byRule.map((g) => (
            <div key={g.rule.id} className="mb-3 overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <div className="flex items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                  <input type="checkbox" checked={g.rows.every((r) => selected.has(r.id))}
                    onChange={(e) => setSelected((s) => { const n = new Set(s); g.rows.forEach((r) => (e.target.checked ? n.add(r.id) : n.delete(r.id))); return n; })} />
                  {g.rule.name}
                </label>
                <span className="text-xs text-gray-500">{g.rows.length} sugerencia(s)</span>
              </div>
              <table className="w-full min-w-[820px] text-sm">
                <tbody className="divide-y divide-gray-100">
                  {g.rows.map((r) => (
                    <tr key={r.id} className={`cursor-pointer hover:bg-gray-50 ${selected.has(r.id) ? 'bg-[var(--brand-light)]' : ''}`} onClick={() => toggle(r.id)}>
                      <td className="w-10 px-3 py-2" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                      <td className="max-w-[300px] px-3 py-2"><ProductCell title={r.title} thumbnail={r.thumbnail} product={r.product} itemId={r.itemId} /></td>
                      <td className="max-w-[140px] px-3 py-2"><AccountDot accounts={accounts} id={r.connection.id} name={r.connection.name} /></td>
                      <td className="px-3 py-2 text-xs text-gray-600">
                        <div className="mb-0.5"><TypeBadge type={r.type} /></div>
                        {r.reason}
                      </td>
                      <td className="px-3 py-2 text-right"><PriceChange from={r.originalPrice} to={r.price} discount={r.discountPct} /></td>
                      <td className="px-3 py-2 text-right" title={MARGIN_NOTE}><MarginCell e={{ revenue: 0, fee: null, cost: null, profit: r.profit, marginPct: r.marginPct }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

// ── Activas: campañas propias y publicaciones en promoción de todas las cuentas ──

function ActiveTab({ accounts, inScope, companyId, filters, quick, reload, onOpen, onChanged }: TabProps) {
  const [rows, setRows] = useState<MlPromoActiveRow[] | null>(null);
  const [own, setOwn] = useState<MlPromoCampaign[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [jobs, setJobs] = useState<MlPromoJob[]>([]);

  useEffect(() => {
    const t = getToken()!;
    api.marketplace.promotions.active(t, { companyId }).then(setRows).catch(() => setRows([]));
    api.marketplace.promotions.campaigns(t, { companyId, scope: 'OWN' }).then(setOwn).catch(() => setOwn([]));
  }, [companyId, reload]);

  const q = filters.search.trim().toLowerCase();
  const list = useMemo(() => (rows || []).filter((r) => inScope(r.connection.id)
    && (!filters.type || r.type === filters.type)
    && (!filters.status || (filters.status === 'pending' ? r.status === 'pending' : r.status !== 'pending'))
    && (!q || `${r.title} ${r.product?.name || ''} ${r.product?.sku || ''} ${r.itemId}`.toLowerCase().includes(q))
    && (!quick.has('urgent') || (daysLeft(r.finishDate) ?? 99) <= 3)
    && (!quick.has('meli') || (r.meliPct ?? 0) > 0)
    && (!quick.has('lowMargin') || (r.estimate?.marginPct != null && r.estimate.marginPct < LOW_MARGIN))), [rows, inScope, filters, q, quick]);
  const ownGroups = groupCampaigns(own.filter((c) => inScope(c.connection.id) && (!filters.type || c.type === filters.type)));
  const removable = list.filter((r) => r.removable);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function remove(items: MlPromoActiveRow[]) {
    if (!items.length) return;
    if (!(await confirmDialog(`¿Quitar la promoción de ${items.length} publicación(es)? Vuelven a su precio normal.`, { danger: true }))) return;
    const byConn = new Map<string, MlPromoActiveRow[]>();
    for (const r of items) byConn.set(r.connection.id, [...(byConn.get(r.connection.id) || []), r]);
    const started: MlPromoJob[] = [];
    try {
      for (const [connectionId, rs] of byConn) {
        started.push(await api.marketplace.promotions.remove(connectionId, rs.map((r) => ({ itemId: r.itemId, type: r.type, promotionId: r.promotionId, offerId: r.offerId })), getToken()!));
      }
      setSelected(new Set());
      setJobs(started);
    } catch (e) {
      if (started.length) setJobs(started);
      await alertDialog((e as Error).message, { title: 'No se pudo quitar' });
    }
  }

  async function deleteCampaign(c: MlPromoCampaign) {
    if (!(await confirmDialog(`¿Eliminar la campaña "${c.name}" de ${c.connection.name}? Todos sus productos vuelven a su precio normal.`, { danger: true }))) return;
    await api.marketplace.promotions.deleteCampaign(c.id, getToken()!).catch(() => null);
    onChanged();
  }

  if (jobs.length) return <div className="ui-card p-5"><JobsResult jobs={jobs} onClose={() => { setJobs([]); onChanged(); }} /></div>;

  return (
    <div className="space-y-4">
      {ownGroups.length > 0 && (
        <section>
          <h2 className="ui-subsection-title mb-2">Mis campañas</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ownGroups.map((g) => (
              <CampaignGroupCard key={g.key} g={g} accounts={accounts} onClick={() => onOpen(g)} cta="Agregar productos"
                extra={(c) => <button type="button" onClick={() => deleteCampaign(c)} className="text-red-500 hover:underline">Eliminar</button>} />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="ui-subsection-title">Publicaciones en promoción</h2>
          <span className="text-xs text-[var(--text-2)]"><FilterCount n={list.length} label="en promoción" /></span>
        </div>
        {selected.size > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5">
            <span className="text-sm font-medium text-blue-800">{selected.size} seleccionada(s)</span>
            <button type="button" onClick={() => remove(list.filter((r) => selected.has(r.id)))}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700">Quitar promoción</button>
            <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-xs text-blue-600 hover:text-blue-800">Limpiar selección</button>
          </div>
        )}
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="w-10 px-3 py-2">
                  <input type="checkbox" aria-label="Seleccionar todas" checked={removable.length > 0 && removable.every((r) => selected.has(r.id))}
                    onChange={(e) => setSelected(e.target.checked ? new Set(removable.map((r) => r.id)) : new Set())} />
                </th>
                <th className="px-3 py-2">Producto</th>
                <th className="px-3 py-2">Cuenta</th>
                <th className="px-3 py-2">Promoción</th>
                <th className="px-3 py-2 text-right">Precio</th>
                <th className="px-3 py-2 text-right" title={MARGIN_NOTE}>Margen</th>
                <th className="px-3 py-2">Vigencia</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows === null && <tr><td colSpan={8} className="p-6 text-center text-gray-400">Cargando…</td></tr>}
              {rows !== null && !list.length && <tr><td colSpan={8} className="p-6 text-center text-gray-400">No hay publicaciones en promoción con estos filtros.</td></tr>}
              {list.map((r) => {
                const left = daysLeft(r.finishDate);
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2">{r.removable && <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />}</td>
                    <td className="max-w-[300px] px-3 py-2"><ProductCell title={r.title} thumbnail={r.thumbnail} product={r.product} itemId={r.itemId} permalink={r.permalink} /></td>
                    <td className="max-w-[140px] px-3 py-2"><AccountDot accounts={accounts} id={r.connection.id} name={r.connection.name} /></td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1"><TypeBadge type={r.type} /><StatusBadge status={r.status} /></div>
                      {r.promotionName && <span className="mt-0.5 block max-w-[200px] truncate text-[11px] text-gray-500">{r.promotionName}</span>}
                      {r.meliPct ? <span className="block text-[11px] text-green-700">ML aporta {r.meliPct}%</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <PriceChange from={r.originalPrice} to={r.price} discount={r.discountPct} />
                      {r.boosted && r.boostedPrice && <span className="block text-[11px] text-green-700" title="Mercado Libre suma un descuento extra pagado por ML">Con extra de ML: ${Math.round(r.boostedPrice).toLocaleString('es-CL')}</span>}
                    </td>
                    <td className="px-3 py-2 text-right"><MarginCell e={r.estimate} /></td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {r.status === 'pending' && r.startDate ? `Desde ${day(r.startDate)} ` : ''}{r.finishDate ? `hasta ${day(r.finishDate)}` : '—'}
                      {left != null && left >= 0 && left <= 3 && <span className="mt-0.5 block"><span className="ui-badge ui-badge--warn">Termina {left === 0 ? 'hoy' : `en ${left} día(s)`}</span></span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.removable
                        ? <button type="button" onClick={() => remove([r])} className="text-xs font-medium text-red-500 hover:underline">Quitar</button>
                        : <span className="text-[11px] text-gray-400" title="Mercado Libre no permite quitar ofertas del día ni relámpago activas. Puedes pausar la publicación.">No se puede quitar</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ── Historial ─────────────────────────────────────────────────────────────

type JobRow = MlPromoJob & { connectionId?: string };

function HistoryTab({ accounts, inScope, companyId, reload }: { accounts: Account[]; inScope: (id: string) => boolean; companyId?: string; reload: number }) {
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    api.marketplace.promotions.jobs(getToken()!, { companyId }).then(setJobs).catch(() => setJobs([]));
  }, [companyId, reload]);

  if (jobs === null) return <p className="text-sm text-gray-400">Cargando…</p>;
  const list = jobs.filter((j) => !j.connectionId || inScope(j.connectionId));
  if (!list.length) return <div className="ui-card p-8 text-center text-sm text-gray-500">Aún no se han aplicado promociones desde el sistema.</div>;
  return (
    <div className="ui-card divide-y divide-gray-100">
      {list.map((j) => (
        <div key={j.id} className="px-4 py-3">
          <button type="button" onClick={() => setOpen(open === j.id ? null : j.id)} className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
            <span className="min-w-0">
              <span className="text-sm font-medium text-gray-900">{j.kind === 'REMOVE' ? '↩︎ ' : ''}{j.title}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                {j.connectionId && <AccountDot accounts={accounts} id={j.connectionId} name={j.connection?.name} />}
                <span>{new Date(j.createdAt).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}{j.createdByName ? ` · ${j.createdByName}` : ''}</span>
              </span>
            </span>
            <span className="flex items-center gap-2 text-xs">
              {j.status === 'RUNNING' && <span className="ui-badge ui-badge--info">En curso {j.done}/{j.total}</span>}
              <span className="text-green-700">✅ {j.ok}</span>
              {j.failed > 0 && <span className="text-red-600">⛔ {j.failed}</span>}
              <span className="text-gray-400">{open === j.id ? '▲' : '▼'}</span>
            </span>
          </button>
          {open === j.id && (
            <ul className="mt-2 space-y-1 text-xs">
              {(j.results || []).map((r) => (
                <li key={r.itemId} className={r.ok ? 'text-gray-600' : 'text-red-600'}>
                  {r.ok ? '✅' : '⛔'} <strong>{r.title || r.itemId}</strong>{r.ok && r.price ? ` · $${Math.round(r.price).toLocaleString('es-CL')}` : ''}{r.error ? `: ${r.error}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

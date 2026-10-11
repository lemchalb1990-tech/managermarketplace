'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { api, type MlPromoActiveRow, type MlPromoCampaign, type MlPromoJob, type MlPromoSuggestion, type MlPromoSummary, type MlPromoType } from '@/lib/api';
import { onActivity } from '@/lib/activityBus';
import { FilterBar, FilterCount, FilterField, filterSelectCls } from '@/components/FilterBar';
import { btnPrimary, btnSecondary } from '@/components/ui/Modal';
import { useMlCompany } from '../MlCompanyContext';
import { alertDialog, confirmDialog } from '../../ConfirmDialog';
import { PromoWizard, CampaignCard, StepResult, type WizardStart } from './PromoWizard';
import { RulesTab } from './RulesTab';
import { MARGIN_NOTE, MarginCell, PriceChange, ProductCell, StatusBadge, TYPE_INFO, TypeBadge, day, daysLeft } from './shared';

type Tab = 'invitations' | 'active' | 'suggestions' | 'rules' | 'history';
const CONN_KEY = 'mp_promo_conn';

export default function PromocionesPage() {
  return <Suspense fallback={null}><PromocionesInner /></Suspense>;
}

function PromocionesInner() {
  const { companyId } = useMlCompany();
  const params = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'invitations');
  const [summary, setSummary] = useState<MlPromoSummary | null>(null);
  const [connectionId, setConnectionId] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  // Desde el catálogo: "Poner en promoción" llega con los productos elegidos (?products=…).
  const [wizard, setWizard] = useState<WizardStart | null>(() => {
    const products = params.get('products');
    return products ? { type: 'PRICE_DISCOUNT', productIds: products.split(',').filter(Boolean) } : null;
  });
  const [reload, setReload] = useState(0);

  const loadSummary = useCallback(() => {
    api.marketplace.promotions.summary(getToken()!, { companyId, connectionId: connectionId || undefined })
      .then((s) => {
        setSummary(s);
        if (!connectionId && s.connections.length) {
          let saved = '';
          try { saved = localStorage.getItem(CONN_KEY) || ''; } catch {}
          setConnectionId(s.connections.some((c) => c.id === saved) ? saved : s.connections[0].id);
        }
      })
      .catch(() => setSummary(null));
  }, [companyId, connectionId]);
  useEffect(() => { loadSummary(); }, [loadSummary, reload]);
  useEffect(() => onActivity(['promo'], () => setReload((n) => n + 1)), []);

  useEffect(() => {
    if (params.get('products')) router.replace('/dashboard/mercadolibre/promociones');
  }, [params, router]);

  function changeConn(id: string) {
    setConnectionId(id);
    try { localStorage.setItem(CONN_KEY, id); } catch {}
  }

  async function sync() {
    if (!connectionId) return;
    setSyncing(true);
    setSyncError('');
    try {
      setSummary(await api.marketplace.promotions.sync(connectionId, getToken()!));
      setReload((n) => n + 1);
    } catch (e) {
      setSyncError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  const tabs: Array<[Tab, string, number?]> = [
    ['invitations', 'Invitaciones de ML', summary?.invitations],
    ['active', 'Mis promociones', summary?.active],
    ['suggestions', 'Sugerencias', summary?.suggestions],
    ['rules', 'Reglas'],
    ['history', 'Historial'],
  ];

  if (summary && !summary.connections.length) {
    return (
      <div className="max-w-6xl">
        <h1 className="ui-page-title mb-1">Promociones</h1>
        <div className="ui-card p-10 text-center text-sm text-gray-500">Conecta una cuenta de Mercado Libre para gestionar sus promociones.</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="ui-page-title mr-1">Promociones</h1>
        {summary && summary.connections.length > 1 && (
          <select value={connectionId} onChange={(e) => changeConn(e.target.value)} className={filterSelectCls} aria-label="Cuenta de Mercado Libre">
            {summary.connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {summary?.lastSyncAt && <span className="hidden text-xs text-gray-400 sm:inline">Actualizado {new Date(summary.lastSyncAt).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
          <button type="button" onClick={sync} disabled={syncing || !connectionId} className={btnSecondary}>{syncing ? 'Actualizando…' : 'Actualizar desde ML'}</button>
          {!wizard && <button type="button" onClick={() => setWizard({})} disabled={!connectionId} className={btnPrimary}>+ Nueva promoción</button>}
        </div>
      </div>
      <p className="ui-page-subtitle mb-4">Súmate a las campañas de Mercado Libre o crea tus descuentos, viendo cuánto ganas antes de aplicar. Las reglas solo sugieren: nada se aplica sin tu aprobación.</p>
      {syncError && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{syncError}</p>}

      {wizard && connectionId ? (
        <PromoWizard key={connectionId} connectionId={connectionId} start={wizard} onClose={() => setWizard(null)} onFinished={() => setReload((n) => n + 1)} />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Invitaciones vigentes" value={summary?.invitations} onClick={() => setTab('invitations')} />
            <Stat label="Productos invitados" value={summary?.candidates} onClick={() => setTab('invitations')} />
            <Stat label="Publicaciones en promoción" value={summary?.active} onClick={() => setTab('active')} tone="ok" />
            <Stat label="Sugerencias por aprobar" value={summary?.suggestions} onClick={() => setTab('suggestions')} tone={summary?.suggestions ? 'warn' : undefined} />
          </div>
          <div className="mb-4 flex gap-1 overflow-x-auto border-b border-gray-200">
            {tabs.map(([k, l, n]) => (
              <button key={k} type="button" onClick={() => setTab(k)}
                className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium ${tab === k ? 'border-[var(--brand)] text-[var(--brand-ink)]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                {l}
                {!!n && <span className={`rounded-full px-1.5 text-[10px] font-bold ${k === 'suggestions' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>{n}</span>}
              </button>
            ))}
          </div>
          {connectionId && tab === 'invitations' && <InvitationsTab connectionId={connectionId} reload={reload} onOpen={(c) => setWizard({ campaign: c })} />}
          {connectionId && tab === 'active' && <ActiveTab connectionId={connectionId} reload={reload} onChanged={() => setReload((n) => n + 1)} onOpen={(c) => setWizard({ campaign: c })} />}
          {tab === 'suggestions' && <SuggestionsTab companyId={companyId} reload={reload} onChanged={() => setReload((n) => n + 1)} />}
          {tab === 'rules' && <RulesTab companyId={companyId} connections={summary?.connections || []} onChanged={() => setReload((n) => n + 1)} />}
          {connectionId && tab === 'history' && <HistoryTab connectionId={connectionId} reload={reload} />}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, onClick, tone }: { label: string; value?: number; onClick: () => void; tone?: 'ok' | 'warn' }) {
  return (
    <button type="button" onClick={onClick} className="ui-stat text-left transition hover:shadow-sm">
      <div className={`ui-stat-value ${tone === 'ok' ? 'text-[var(--ok)]' : tone === 'warn' ? 'text-[var(--warn)]' : ''}`}>{value ?? '—'}</div>
      <div className="ui-stat-label">{label}</div>
    </button>
  );
}

// ── Invitaciones ──────────────────────────────────────────────────────────

function InvitationsTab({ connectionId, reload, onOpen }: { connectionId: string; reload: number; onOpen: (c: MlPromoCampaign) => void }) {
  const [rows, setRows] = useState<MlPromoCampaign[] | null>(null);
  const [type, setType] = useState('');
  useEffect(() => {
    api.marketplace.promotions.campaigns(getToken()!, { connectionId, scope: 'INVITATION' }).then(setRows).catch(() => setRows([]));
  }, [connectionId, reload]);
  const list = (rows || []).filter((c) => (!type || c.type === type) && (daysLeft(c.deadlineDate) ?? 1) >= 0);
  const types = Array.from(new Set((rows || []).map((c) => c.type)));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setType('')} className={`rounded-full px-3 py-1 text-xs font-semibold ${!type ? 'bg-[var(--navy)] text-white' : 'bg-gray-100 text-gray-600'}`}>Todas</button>
        {types.map((t) => (
          <button key={t} type="button" onClick={() => setType(t)} className={`rounded-full px-3 py-1 text-xs font-semibold ${type === t ? 'bg-[var(--navy)] text-white' : 'bg-gray-100 text-gray-600'}`}>{TYPE_INFO[t]?.label || t}</button>
        ))}
      </div>
      {rows === null ? <p className="text-sm text-gray-400">Cargando…</p>
        : list.length === 0 ? (
          <div className="ui-card p-8 text-center text-sm text-gray-500">
            No hay invitaciones vigentes. Mercado Libre invita periódicamente según tu reputación y tus productos; el sistema revisa cada 30 minutos.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((c) => <CampaignCard key={c.id} c={c} onClick={() => onOpen(c)} cta="Ver productos y sumarme" />)}
          </div>
        )}
    </div>
  );
}

// ── Mis promociones ───────────────────────────────────────────────────────

function ActiveTab({ connectionId, reload, onChanged, onOpen }: { connectionId: string; reload: number; onChanged: () => void; onOpen: (c: MlPromoCampaign) => void }) {
  const [rows, setRows] = useState<MlPromoActiveRow[] | null>(null);
  const [own, setOwn] = useState<MlPromoCampaign[]>([]);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [applied, setApplied] = useState({ search: '', type: '' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [job, setJob] = useState<MlPromoJob | null>(null);

  const load = useCallback(() => {
    const t = getToken()!;
    api.marketplace.promotions.active(t, { connectionId, ...applied }).then(setRows).catch(() => setRows([]));
    api.marketplace.promotions.campaigns(t, { connectionId, scope: 'OWN' }).then(setOwn).catch(() => setOwn([]));
  }, [connectionId, applied]);
  useEffect(() => { load(); }, [load, reload]);

  const list = rows || [];
  const removable = list.filter((r) => r.removable);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function remove(items: MlPromoActiveRow[]) {
    if (!items.length) return;
    if (!(await confirmDialog(`¿Quitar la promoción de ${items.length} publicación(es)? Vuelven a su precio normal.`, { danger: true }))) return;
    try {
      setJob(await api.marketplace.promotions.remove(connectionId, items.map((r) => ({ itemId: r.itemId, type: r.type, promotionId: r.promotionId, offerId: r.offerId })), getToken()!));
      setSelected(new Set());
    } catch (e) {
      await alertDialog((e as Error).message, { title: 'No se pudo quitar' });
    }
  }

  async function deleteCampaign(c: MlPromoCampaign) {
    if (!(await confirmDialog(`¿Eliminar la campaña "${c.name}"? Todos sus productos vuelven a su precio normal.`, { danger: true }))) return;
    await api.marketplace.promotions.deleteCampaign(c.id, getToken()!).catch(() => null);
    onChanged();
  }

  if (job) return <div className="ui-card p-5"><StepResult job={job} onClose={() => { setJob(null); onChanged(); }} /></div>;

  return (
    <div className="space-y-4">
      {own.length > 0 && (
        <div>
          <p className="ui-subsection-title mb-2">Mis campañas</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {own.map((c) => (
              <CampaignCard key={c.id} c={c} onClick={() => onOpen(c)} cta="Agregar productos"
                extra={<button type="button" onClick={() => deleteCampaign(c)} className="text-xs text-red-500 hover:underline">Eliminar</button>} />
            ))}
          </div>
        </div>
      )}
      <FilterBar
        search={{ label: 'Buscar', value: search, onChange: setSearch, placeholder: 'Producto, SKU o código ML…' }}
        primary={(
          <FilterField label="Tipo">
            <select value={type} onChange={(e) => { setType(e.target.value); setApplied({ search, type: e.target.value }); }} className={filterSelectCls}>
              <option value="">Todos</option>
              {(Object.keys(TYPE_INFO) as MlPromoType[]).map((t) => <option key={t} value={t}>{TYPE_INFO[t].label}</option>)}
            </select>
          </FilterField>
        )}
        onApply={() => setApplied({ search, type })}
        onClear={() => { setSearch(''); setType(''); setApplied({ search: '', type: '' }); }}
        summary={<FilterCount n={list.length} label="en promoción" />}
      />
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-xl bg-[var(--brand-light)] px-3 py-2 text-sm">
          <span className="font-semibold">{selected.size} seleccionada(s)</span>
          <button type="button" onClick={() => remove(list.filter((r) => selected.has(r.id)))} className="font-medium text-red-600 hover:underline">Quitar promoción</button>
          <button type="button" onClick={() => setSelected(new Set())} className="text-gray-500 hover:underline">Cancelar</button>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="w-10 px-3 py-2">
                <input type="checkbox" aria-label="Seleccionar todas" checked={removable.length > 0 && removable.every((r) => selected.has(r.id))}
                  onChange={(e) => setSelected(e.target.checked ? new Set(removable.map((r) => r.id)) : new Set())} />
              </th>
              <th className="px-3 py-2">Producto</th>
              <th className="px-3 py-2">Promoción</th>
              <th className="px-3 py-2 text-right">Precio</th>
              <th className="px-3 py-2 text-right" title={MARGIN_NOTE}>Margen</th>
              <th className="px-3 py-2">Vigencia</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows === null && <tr><td colSpan={7} className="p-6 text-center text-gray-400">Cargando…</td></tr>}
            {rows !== null && !list.length && <tr><td colSpan={7} className="p-6 text-center text-gray-400">No hay publicaciones en promoción en esta cuenta.</td></tr>}
            {list.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-3 py-2">{r.removable && <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />}</td>
                <td className="max-w-[320px] px-3 py-2"><ProductCell title={r.title} thumbnail={r.thumbnail} product={r.product} itemId={r.itemId} permalink={r.permalink} /></td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1"><TypeBadge type={r.type} /><StatusBadge status={r.status} /></div>
                  {r.promotionName && <span className="mt-0.5 block truncate text-[11px] text-gray-500">{r.promotionName}</span>}
                  {r.meliPct ? <span className="block text-[11px] text-green-700">ML aporta {r.meliPct}%</span> : null}
                </td>
                <td className="px-3 py-2 text-right">
                  <PriceChange from={r.originalPrice} to={r.price} discount={r.discountPct} />
                  {r.boosted && r.boostedPrice && <span className="block text-[11px] text-green-700" title="Mercado Libre suma un descuento extra pagado por ML">Con extra de ML: ${Math.round(r.boostedPrice).toLocaleString('es-CL')}</span>}
                </td>
                <td className="px-3 py-2 text-right"><MarginCell e={r.estimate} /></td>
                <td className="px-3 py-2 text-xs text-gray-600">
                  {r.status === 'pending' && r.startDate ? `Desde ${day(r.startDate)} ` : ''}{r.finishDate ? `hasta ${day(r.finishDate)}` : '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  {r.removable
                    ? <button type="button" onClick={() => remove([r])} className="text-xs font-medium text-red-500 hover:underline">Quitar</button>
                    : <span className="text-[11px] text-gray-400" title="Mercado Libre no permite quitar ofertas del día ni relámpago activas. Puedes pausar la publicación.">No se puede quitar</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Sugerencias ───────────────────────────────────────────────────────────

function SuggestionsTab({ companyId, reload, onChanged }: { companyId?: string; reload: number; onChanged: () => void }) {
  const [rows, setRows] = useState<MlPromoSuggestion[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<MlPromoJob[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const load = useCallback(() => {
    api.marketplace.promotions.suggestions(getToken()!, { companyId }).then((r) => { setRows(r); setSelected(new Set()); }).catch(() => setRows([]));
  }, [companyId]);
  useEffect(() => { load(); }, [load, reload]);

  const groups = useMemo(() => {
    const m = new Map<string, { rule: MlPromoSuggestion['rule']; rows: MlPromoSuggestion[] }>();
    for (const r of rows || []) {
      const g = m.get(r.rule.id) || { rule: r.rule, rows: [] };
      g.rows.push(r);
      m.set(r.rule.id, g);
    }
    return Array.from(m.values());
  }, [rows]);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function approve() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (!(await confirmDialog(`¿Aplicar ${ids.length} promoción(es) sugerida(s) en Mercado Libre?`))) return;
    setBusy(true);
    try {
      const res = await api.marketplace.promotions.applySuggestions(ids, getToken()!);
      setJobs(res.jobs);
      setErrors(res.errors);
      load();
      onChanged();
    } catch (e) {
      setErrors([(e as Error).message]);
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    await api.marketplace.promotions.dismissSuggestions(ids, getToken()!).catch(() => null);
    load();
    onChanged();
  }

  if (jobs.length) {
    return (
      <div className="space-y-3">
        {jobs.map((j) => <div key={j.id} className="ui-card p-5"><StepResult job={j} onClose={() => setJobs((js) => js.filter((x) => x.id !== j.id))} /></div>)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-xs leading-relaxed text-gray-500">
        Las reglas revisan cada 30 minutos las invitaciones de ML y tus productos, y proponen promociones que cumplen tus condiciones (margen mínimo, descuento máximo, costo cargado).
        <strong className="text-gray-700"> Nada se aplica hasta que lo apruebes.</strong>
      </p>
      {errors.length > 0 && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errors.join(' · ')}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setSelected(new Set((rows || []).map((r) => r.id)))} disabled={!rows?.length} className={btnSecondary}>Seleccionar todas</button>
        <button type="button" onClick={approve} disabled={busy || !selected.size} className={btnPrimary}>{busy ? 'Enviando…' : `Aprobar ${selected.size || ''}`}</button>
        <button type="button" onClick={dismiss} disabled={busy || !selected.size} className={btnSecondary}>Descartar</button>
      </div>
      {rows === null ? <p className="text-sm text-gray-400">Cargando…</p>
        : !rows.length ? <div className="ui-card p-8 text-center text-sm text-gray-500">No hay sugerencias pendientes. Crea una regla en la pestaña Reglas para recibirlas.</div>
          : groups.map((g) => (
            <div key={g.rule.id} className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                  <input type="checkbox" checked={g.rows.every((r) => selected.has(r.id))}
                    onChange={(e) => setSelected((s) => { const n = new Set(s); g.rows.forEach((r) => (e.target.checked ? n.add(r.id) : n.delete(r.id))); return n; })} />
                  {g.rule.name}
                </label>
                <span className="text-xs text-gray-500">{g.rows.length} sugerencia(s)</span>
              </div>
              <table className="w-full min-w-[760px] text-sm">
                <tbody className="divide-y divide-gray-100">
                  {g.rows.map((r) => (
                    <tr key={r.id} className={`cursor-pointer hover:bg-gray-50 ${selected.has(r.id) ? 'bg-[var(--brand-light)]' : ''}`} onClick={() => toggle(r.id)}>
                      <td className="w-10 px-3 py-2" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                      <td className="max-w-[300px] px-3 py-2"><ProductCell title={r.title} thumbnail={r.thumbnail} product={r.product} itemId={r.itemId} /></td>
                      <td className="px-3 py-2 text-xs text-gray-600">
                        <div className="mb-0.5 flex items-center gap-1"><TypeBadge type={r.type} /><span className="text-gray-400">{r.connection.name}</span></div>
                        {r.reason}
                      </td>
                      <td className="px-3 py-2 text-right"><PriceChange from={r.originalPrice} to={r.price} discount={r.discountPct} /></td>
                      <td className="px-3 py-2 text-right"><MarginCell e={{ revenue: 0, fee: null, cost: null, profit: r.profit, marginPct: r.marginPct }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
    </div>
  );
}

// ── Historial ─────────────────────────────────────────────────────────────

function HistoryTab({ connectionId, reload }: { connectionId: string; reload: number }) {
  const [jobs, setJobs] = useState<MlPromoJob[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    api.marketplace.promotions.jobs(getToken()!, { connectionId }).then(setJobs).catch(() => setJobs([]));
  }, [connectionId, reload]);

  if (jobs === null) return <p className="text-sm text-gray-400">Cargando…</p>;
  if (!jobs.length) return <div className="ui-card p-8 text-center text-sm text-gray-500">Aún no se han aplicado promociones desde el sistema.</div>;
  return (
    <div className="ui-card divide-y divide-gray-100">
      {jobs.map((j) => (
        <div key={j.id} className="px-4 py-3">
          <button type="button" onClick={() => setOpen(open === j.id ? null : j.id)} className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
            <span>
              <span className="text-sm font-medium text-gray-900">{j.kind === 'REMOVE' ? '↩︎ ' : ''}{j.title}</span>
              <span className="block text-xs text-gray-500">
                {new Date(j.createdAt).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                {j.createdByName ? ` · ${j.createdByName}` : ''}
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

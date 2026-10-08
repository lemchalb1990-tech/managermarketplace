'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api, SUBSCRIPTION_FEATURE_LABEL, type SubscriptionFeature, type SubscriptionPlan } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import { SkeletonTable } from '@/components/Skeleton';
import { Modal, btnPrimary, btnSecondary, inputCls, labelCls, FormError } from '@/components/ui/Modal';
import { confirmDialog } from '../ConfirmDialog';

const ALL_FEATURES = Object.keys(SUBSCRIPTION_FEATURE_LABEL) as SubscriptionFeature[];
const clp = (v: number | null | undefined) => (v == null ? '—' : `$${v.toLocaleString('es-CL')}`);
const lim = (v: number | null | undefined) => (v == null ? 'Sin límite' : v.toLocaleString('es-CL'));

type Form = {
  id?: string;
  name: string; description: string;
  monthlyPrice: string; annualPrice: string; priceFrom: boolean;
  implementationPrice: string; implementationFreeAnnual: boolean;
  maxChannels: string; maxProducts: string; maxUsers: string; maxWarehouses: string;
  features: SubscriptionFeature[]; addons: string;
  isTrial: boolean; trialDays: string; sortOrder: string; active: boolean;
};

const s = (v: number | null | undefined) => (v == null ? '' : String(v));
const n = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.floor(Number(v))));

function toForm(p?: SubscriptionPlan): Form {
  return {
    id: p?.id,
    name: p?.name ?? '', description: p?.description ?? '',
    monthlyPrice: s(p?.monthlyPrice), annualPrice: s(p?.annualPrice), priceFrom: p?.priceFrom ?? false,
    implementationPrice: s(p?.implementationPrice), implementationFreeAnnual: p?.implementationFreeAnnual ?? false,
    maxChannels: s(p?.maxChannels), maxProducts: s(p?.maxProducts), maxUsers: s(p?.maxUsers), maxWarehouses: s(p?.maxWarehouses),
    features: p?.features ?? [], addons: p?.addons ?? '',
    isTrial: p?.isTrial ?? false, trialDays: s(p?.trialDays ?? (p ? null : 15)), sortOrder: s(p?.sortOrder ?? 0), active: p?.active ?? true,
  };
}

// Planes comerciales (Super Admin): precios, límites y funciones. Se asignan a cada empresa
// en Empresas; los límites se cuentan y bloquean al crear productos, usuarios, bodegas y
// conexiones de más, y el menú oculta las funciones que el plan no incluye.
export default function PlansPage() {
  const [plans, setPlans] = useState<SubscriptionPlan[] | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  async function load() {
    try {
      setPlans(await api.subscription.plans.list(getToken()!));
    } catch (e: any) {
      setError(e.message || 'No se pudieron cargar los planes.');
    }
  }

  useEffect(() => { load(); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (!form.name.trim()) { setFormError('El plan necesita un nombre.'); return; }
    setSaving(true);
    setFormError('');
    const data: Partial<SubscriptionPlan> = {
      name: form.name.trim(), description: form.description.trim() || null,
      monthlyPrice: n(form.monthlyPrice), annualPrice: n(form.annualPrice), priceFrom: form.priceFrom,
      implementationPrice: n(form.implementationPrice), implementationFreeAnnual: form.implementationFreeAnnual,
      maxChannels: n(form.maxChannels), maxProducts: n(form.maxProducts), maxUsers: n(form.maxUsers), maxWarehouses: n(form.maxWarehouses),
      features: form.features, addons: form.addons.trim() || null,
      isTrial: form.isTrial, trialDays: form.isTrial ? (n(form.trialDays) || 15) : null,
      sortOrder: n(form.sortOrder) ?? 0, active: form.active,
    };
    try {
      const token = getToken()!;
      if (form.id) await api.subscription.plans.update(form.id, data, token);
      else await api.subscription.plans.create(data, token);
      setForm(null);
      await load();
    } catch (err: any) {
      setFormError(err.message || 'No se pudo guardar el plan.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: SubscriptionPlan) {
    const count = p._count?.companies ?? 0;
    if (!(await confirmDialog(count ? `¿Eliminar el plan "${p.name}"? ${count} empresa(s) quedarán sin plan (sin límites).` : `¿Eliminar el plan "${p.name}"?`, { danger: true }))) return;
    try {
      await api.subscription.plans.remove(p.id, getToken()!);
      await load();
    } catch (e: any) {
      setError(e.message || 'No se pudo eliminar el plan.');
    }
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Planes"
        crumbs={[{ label: 'Administrador de plataforma' }, { label: 'Planes' }]}
        actions={<button type="button" onClick={() => { setFormError(''); setForm(toForm()); }} className={btnPrimary}>+ Nuevo plan</button>}
      />
      {error && <FormError message={error} />}

      <div className="ui-card overflow-hidden">
        {!plans ? <SkeletonTable rows={5} cols={6} /> : plans.length === 0 ? (
          <p className="p-5 text-sm text-[var(--text-muted)]">No hay planes. Crea el primero.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--text-muted)] border-b border-[var(--border-soft)]">
                  <th className="px-4 py-2.5 font-medium">Plan</th>
                  <th className="px-3 py-2.5 font-medium text-right">Mensual</th>
                  <th className="px-3 py-2.5 font-medium text-right">Anual</th>
                  <th className="px-3 py-2.5 font-medium text-right">Canales</th>
                  <th className="px-3 py-2.5 font-medium text-right">Productos</th>
                  <th className="px-3 py-2.5 font-medium text-right">Usuarios</th>
                  <th className="px-3 py-2.5 font-medium text-right">Bodegas</th>
                  <th className="px-3 py-2.5 font-medium">Incluye</th>
                  <th className="px-3 py-2.5 font-medium text-right">Empresas</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-soft)]">
                {plans.map((p) => (
                  <tr key={p.id} className={p.active ? '' : 'opacity-50'}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-[var(--text)]">
                        {p.name}
                        {p.isTrial && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">Prueba {p.trialDays} días</span>}
                        {!p.active && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">Inactivo</span>}
                      </p>
                      {p.description && <p className="text-xs text-[var(--text-muted)]">{p.description}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">{p.isTrial ? 'Gratis' : `${p.priceFrom ? 'Desde ' : ''}${clp(p.monthlyPrice)}`}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">{p.isTrial ? '—' : p.annualPrice == null ? 'A medida' : clp(p.annualPrice)}</td>
                    <td className="px-3 py-2.5 text-right">{lim(p.maxChannels)}</td>
                    <td className="px-3 py-2.5 text-right">{lim(p.maxProducts)}</td>
                    <td className="px-3 py-2.5 text-right">{lim(p.maxUsers)}</td>
                    <td className="px-3 py-2.5 text-right">{lim(p.maxWarehouses)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {p.features.map((f) => <span key={f} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 whitespace-nowrap">{SUBSCRIPTION_FEATURE_LABEL[f]}</span>)}
                        {p.addons && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 whitespace-nowrap">Add-on: {p.addons}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">{p._count?.companies ?? 0}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button type="button" className="text-xs text-blue-600 hover:underline mr-3" onClick={() => { setFormError(''); setForm(toForm(p)); }}>Editar</button>
                      <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => remove(p)}>Eliminar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-xs text-[var(--text-muted)]">Valores en CLP + IVA. El plan de cada empresa se asigna en Empresas. Límite vacío = sin límite.</p>

      {form && (
        <Modal title={form.id ? `Editar plan ${form.name}` : 'Nuevo plan'} size="xl" busy={saving}
          onClose={() => setForm(null)} onSubmit={save}
          footer={(
            <>
              <button type="button" onClick={() => setForm(null)} disabled={saving} className={btnSecondary}>Cancelar</button>
              <button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Guardando...' : 'Guardar'}</button>
            </>
          )}>
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className={labelCls}>Nombre *</label>
                <input value={form.name} onChange={(e) => set('name', e.target.value)} required className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Orden</label>
                <input type="number" value={form.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} className={inputCls} />
              </div>
              <div className="sm:col-span-3">
                <label className={labelCls}>Descripción</label>
                <input value={form.description} onChange={(e) => set('description', e.target.value)} className={inputCls} />
              </div>
            </div>

            <div>
              <h3 className="ui-section-title mb-2">Precios (CLP + IVA)</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className={labelCls}>Mensual</label>
                  <input type="number" min={0} value={form.monthlyPrice} onChange={(e) => set('monthlyPrice', e.target.value)} disabled={form.isTrial} className={inputCls} />
                  <label className="flex items-center gap-1.5 text-xs text-[var(--text-2)] mt-1">
                    <input type="checkbox" checked={form.priceFrom} onChange={(e) => set('priceFrom', e.target.checked)} /> Es precio &quot;desde&quot;
                  </label>
                </div>
                <div>
                  <label className={labelCls}>Anual</label>
                  <input type="number" min={0} value={form.annualPrice} onChange={(e) => set('annualPrice', e.target.value)} disabled={form.isTrial} placeholder="Vacío = a medida" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Implementación (única)</label>
                  <input type="number" min={0} value={form.implementationPrice} onChange={(e) => set('implementationPrice', e.target.value)} disabled={form.isTrial} placeholder="Vacío = a cotizar" className={inputCls} />
                  <label className="flex items-center gap-1.5 text-xs text-[var(--text-2)] mt-1">
                    <input type="checkbox" checked={form.implementationFreeAnnual} onChange={(e) => set('implementationFreeAnnual', e.target.checked)} /> Gratis en plan anual
                  </label>
                </div>
              </div>
            </div>

            <div>
              <h3 className="ui-section-title mb-2">Límites <span className="text-xs font-normal text-[var(--text-muted)]">(vacío = sin límite)</span></h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {([['maxChannels', 'Canales o cuentas'], ['maxProducts', 'Productos'], ['maxUsers', 'Usuarios'], ['maxWarehouses', 'Bodegas']] as const).map(([k, label]) => (
                  <div key={k}>
                    <label className={labelCls}>{label}</label>
                    <input type="number" min={0} value={form[k]} onChange={(e) => set(k, e.target.value)} placeholder="Sin límite" className={inputCls} />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="ui-section-title mb-2">Funciones incluidas</h3>
              <p className="text-xs text-[var(--text-muted)] mb-2">Catálogo, sincronización, ventas, etiquetas, facturación y atención de Mercado Libre van en todos los planes.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {ALL_FEATURES.map((f) => (
                  <label key={f} className={`flex items-center gap-2 border rounded-lg px-3 py-2 text-sm cursor-pointer ${form.features.includes(f) ? 'border-blue-400 bg-blue-50/40' : 'border-gray-200'}`}>
                    <input type="checkbox" checked={form.features.includes(f)} className="accent-blue-600"
                      onChange={(e) => set('features', e.target.checked ? [...form.features, f] : form.features.filter((x) => x !== f))} />
                    {SUBSCRIPTION_FEATURE_LABEL[f]}
                  </label>
                ))}
              </div>
              <div className="mt-3">
                <label className={labelCls}>Add-ons incluidos</label>
                <input value={form.addons} onChange={(e) => set('addons', e.target.value)} placeholder="Ej: 1 a elección, Todos" className={inputCls} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isTrial} onChange={(e) => set('isTrial', e.target.checked)} className="accent-blue-600" />
                Es plan de prueba gratis
              </label>
              {form.isTrial && (
                <label className="flex items-center gap-2 text-sm">
                  Días de prueba
                  <input type="number" min={1} value={form.trialDays} onChange={(e) => set('trialDays', e.target.value)} className="w-20 px-2 py-1 border border-gray-300 rounded-lg text-sm" />
                </label>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} className="accent-blue-600" />
                Activo (se puede asignar)
              </label>
            </div>
            <FormError message={formError} />
          </div>
        </Modal>
      )}
    </div>
  );
}

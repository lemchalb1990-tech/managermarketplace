'use client';

import { SUBSCRIPTION_FEATURE_LABEL, type SubscriptionFeature, type SubscriptionPlan } from '@/lib/api';

export type AddonsState = {
  extraChannels: string;
  extraProducts: string;
  extraListings: string;
  extraStorageMb: string;
  extraUsers: string;
  extraWarehouses: string;
  extraFeatures: string[];
  addonsMonthlyPrice: string;
  addonsNote: string;
};

export function addonsFromCompany(c: any): AddonsState {
  return {
    extraChannels: String(c.extraChannels ?? 0),
    extraProducts: String(c.extraProducts ?? 0),
    extraListings: String(c.extraListings ?? 0),
    extraStorageMb: String(c.extraStorageMb ?? 0),
    extraUsers: String(c.extraUsers ?? 0),
    extraWarehouses: String(c.extraWarehouses ?? 0),
    extraFeatures: Array.isArray(c.extraFeatures) ? c.extraFeatures : [],
    addonsMonthlyPrice: c.addonsMonthlyPrice != null ? String(c.addonsMonthlyPrice) : '',
    addonsNote: c.addonsNote ?? '',
  };
}

const toInt = (v: string) => Math.max(0, Math.trunc(Number(v) || 0));

// Lo que se envía al guardar la empresa. Sin plan, los adicionales no aplican y se limpian.
export function addonsPayload(a: AddonsState, hasPlan: boolean) {
  if (!hasPlan) {
    return { extraChannels: 0, extraProducts: 0, extraListings: 0, extraStorageMb: 0, extraUsers: 0, extraWarehouses: 0, extraFeatures: [], addonsMonthlyPrice: null, addonsNote: null };
  }
  return {
    extraChannels: toInt(a.extraChannels),
    extraProducts: toInt(a.extraProducts),
    extraListings: toInt(a.extraListings),
    extraStorageMb: toInt(a.extraStorageMb),
    extraUsers: toInt(a.extraUsers),
    extraWarehouses: toInt(a.extraWarehouses),
    extraFeatures: a.extraFeatures,
    addonsMonthlyPrice: a.addonsMonthlyPrice.trim() === '' ? null : toInt(a.addonsMonthlyPrice),
    addonsNote: a.addonsNote.trim() || null,
  };
}

const RESOURCES = [
  { key: 'extraChannels', plan: 'maxChannels', label: 'Canales' },
  { key: 'extraProducts', plan: 'maxProducts', label: 'Productos (SKU)' },
  { key: 'extraListings', plan: 'maxListings', label: 'Publicaciones' },
  { key: 'extraUsers', plan: 'maxUsers', label: 'Usuarios' },
  { key: 'extraWarehouses', plan: 'maxWarehouses', label: 'Bodegas' },
  { key: 'extraStorageMb', plan: 'maxStorageMb', label: 'Almacenamiento (MB · 1 GB = 1.024)' },
] as const;

const ALL_FEATURES = Object.keys(SUBSCRIPTION_FEATURE_LABEL) as SubscriptionFeature[];
const clp = (n: number) => `$${n.toLocaleString('es-CL')}`;
const num = (n: number) => n.toLocaleString('es-CL');

// Adicionales sobre el plan comercial, al editar una empresa (Super Admin): cantidades extra
// de cada recurso, funciones que el plan no trae y el precio mensual acordado.
export default function CompanyAddons({ plan, billing, value, onChange }: {
  plan: SubscriptionPlan | undefined;
  billing: 'MONTHLY' | 'ANNUAL';
  value: AddonsState;
  onChange: (next: AddonsState) => void;
}) {
  if (!plan) {
    return <p className="text-[11px] text-gray-400">Sin plan no hay límites, así que no hay adicionales que agregar.</p>;
  }

  const set = (patch: Partial<AddonsState>) => onChange({ ...value, ...patch });
  const toggleFeature = (f: string) => set({
    extraFeatures: value.extraFeatures.includes(f) ? value.extraFeatures.filter((x) => x !== f) : [...value.extraFeatures, f],
  });
  const addonsPrice = value.addonsMonthlyPrice.trim() === '' ? 0 : toInt(value.addonsMonthlyPrice);
  const hasAny = RESOURCES.some((r) => toInt(value[r.key]) > 0) || value.extraFeatures.some((f) => !plan.features.includes(f as SubscriptionFeature));

  return (
    <div className="space-y-3 border-t border-gray-100 pt-3">
      <p className="text-xs font-medium text-gray-600">Adicionales sobre el plan</p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="text-[11px] text-gray-500 text-left">
              <th className="font-medium py-1 pr-2">Recurso</th>
              <th className="font-medium py-1 px-2 text-right">Plan {plan.name}</th>
              <th className="font-medium py-1 px-2">Adicional</th>
              <th className="font-medium py-1 pl-2 text-right">Límite total</th>
            </tr>
          </thead>
          <tbody>
            {RESOURCES.map((r) => {
              const planLimit = plan[r.plan];
              const extra = toInt(value[r.key]);
              return (
                <tr key={r.key} className="border-t border-gray-100">
                  <td className="py-1.5 pr-2 text-gray-700">{r.label}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-gray-600">{planLimit == null ? 'Sin límite' : num(planLimit)}</td>
                  <td className="py-1.5 px-2">
                    <div className="flex items-center gap-1">
                      <span className="text-gray-400">+</span>
                      <input type="number" min={0} step={1} value={planLimit == null ? '' : value[r.key]}
                        disabled={planLimit == null}
                        aria-label={`${r.label} adicionales`}
                        placeholder={planLimit == null ? 'No aplica' : '0'}
                        onChange={(e) => set({ [r.key]: e.target.value } as Partial<AddonsState>)}
                        className="w-24 px-2 py-1 border border-gray-300 rounded-md text-sm tabular-nums disabled:bg-gray-50 disabled:text-gray-400" />
                    </div>
                  </td>
                  <td className={`py-1.5 pl-2 text-right tabular-nums ${extra > 0 && planLimit != null ? 'font-semibold text-blue-700' : 'text-gray-700'}`}>
                    {planLimit == null ? 'Sin límite' : num(planLimit + extra)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div>
        <p className="text-[11px] text-gray-500 mb-1">Funciones</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {ALL_FEATURES.map((f) => {
            const inPlan = plan.features.includes(f);
            return (
              <label key={f} className={`flex items-center gap-1.5 text-sm ${inPlan ? 'text-gray-400' : 'text-gray-700 cursor-pointer'}`}>
                <input type="checkbox" className="accent-blue-600" disabled={inPlan}
                  checked={inPlan || value.extraFeatures.includes(f)} onChange={() => toggleFeature(f)} />
                {SUBSCRIPTION_FEATURE_LABEL[f]}{inPlan && <span className="text-[11px]">(incluida en el plan)</span>}
              </label>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-3">
        <div>
          <label className="block text-[11px] text-gray-500 mb-1">Precio mensual de los adicionales</label>
          <div className="flex items-center gap-1">
            <span className="text-gray-400 text-sm">$</span>
            <input type="number" min={0} step={1} value={value.addonsMonthlyPrice} placeholder="0"
              onChange={(e) => set({ addonsMonthlyPrice: e.target.value })}
              className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm tabular-nums" />
          </div>
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 mb-1">Nota interna</label>
          <input value={value.addonsNote} maxLength={300} placeholder="Ej: 2 usuarios extra por temporada navideña"
            onChange={(e) => set({ addonsNote: e.target.value })}
            className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm" />
        </div>
      </div>

      {(hasAny || addonsPrice > 0) && (
        <p className="text-xs text-gray-600 bg-gray-50 rounded-md px-3 py-2">
          {billing === 'ANNUAL' || plan.monthlyPrice == null
            ? <>Plan {plan.name}{billing === 'ANNUAL' && plan.annualPrice != null ? ` ${clp(plan.annualPrice)} al año` : ''} más adicionales {clp(addonsPrice)} al mes, + IVA.</>
            : <>Plan {plan.name} {clp(plan.monthlyPrice)} + adicionales {clp(addonsPrice)} = <b>{clp(plan.monthlyPrice + addonsPrice)} al mes</b> + IVA.</>}
        </p>
      )}
    </div>
  );
}

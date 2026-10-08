'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api, type AiPlan } from '@/lib/api';
import { Modal, btnPrimary, btnSecondary, inputCls, labelCls, FormError } from '@/components/ui/Modal';
import { confirmDialog } from '../ConfirmDialog';
import ProvidersSection from './ProvidersSection';

type CompanyRow = { id: string; name: string; aiPlanId: string | null; usedToday: number; usedMonth: number };
type PlanForm = { id?: string; name: string; dailyCredits: string; monthlyCredits: string };

const limitLabel = (v: number | null) => (v == null ? 'Sin límite' : v.toLocaleString('es-CL'));
const toLimit = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.floor(Number(v))));

// Inteligencia artificial (Super Admin): tareas, proveedores de IA (varios a la vez) y planes: créditos diarios y mensuales para revisar y corregir fotos, y
// qué plan tiene cada empresa. Una empresa sin plan no puede usar la IA.
export default function AiPlansPage() {
  const [plans, setPlans] = useState<AiPlan[]>([]);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<PlanForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [error, setError] = useState('');
  const [assigning, setAssigning] = useState('');

  async function load() {
    const token = getToken();
    if (!token) return;
    try {
      const [p, c] = await Promise.all([api.ai.plans.list(token), api.ai.companies(token)]);
      setPlans(p);
      setCompanies(c);
    } catch (e: any) {
      setError(e.message || 'No se pudieron cargar los planes.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function savePlan(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (!form.name.trim()) { setFormError('El plan necesita un nombre.'); return; }
    setSaving(true);
    setFormError('');
    const data = { name: form.name.trim(), dailyCredits: toLimit(form.dailyCredits), monthlyCredits: toLimit(form.monthlyCredits) };
    try {
      const token = getToken()!;
      if (form.id) await api.ai.plans.update(form.id, data, token);
      else await api.ai.plans.create(data, token);
      setForm(null);
      await load();
    } catch (err: any) {
      setFormError(err.message || 'No se pudo guardar el plan.');
    } finally {
      setSaving(false);
    }
  }

  async function removePlan(plan: AiPlan) {
    const n = plan._count?.companies ?? 0;
    const msg = n ? `¿Eliminar el plan "${plan.name}"? ${n} empresa(s) quedarán sin IA.` : `¿Eliminar el plan "${plan.name}"?`;
    if (!(await confirmDialog(msg, { danger: true }))) return;
    try {
      await api.ai.plans.remove(plan.id, getToken()!);
      await load();
    } catch (e: any) {
      setError(e.message || 'No se pudo eliminar el plan.');
    }
  }

  async function assign(companyId: string, aiPlanId: string) {
    setAssigning(companyId);
    setError('');
    try {
      await api.ai.assignPlan(companyId, aiPlanId || null, getToken()!);
      setCompanies((cs) => cs.map((c) => (c.id === companyId ? { ...c, aiPlanId: aiPlanId || null } : c)));
      setPlans((ps) => ps.map((p) => ({ ...p, _count: { companies: companies.filter((c) => (c.id === companyId ? aiPlanId : c.aiPlanId) === p.id).length } })));
    } catch (e: any) {
      setError(e.message || 'No se pudo asignar el plan.');
    } finally {
      setAssigning('');
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="ui-page-title">Inteligencia artificial</h1>
        <p className="ui-page-subtitle">
          Servicio de IA de la plataforma: qué proveedor hace cada tarea y cuántos créditos puede usar cada empresa para revisar y corregir fotos antes de publicar en Mercado Libre.
        </p>
      </div>

      {error && <FormError message={error} />}

      <ProvidersSection />

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between gap-3">
          <h2 className="ui-section-title">Planes de IA</h2>
          <button type="button" onClick={() => { setFormError(''); setForm({ name: '', dailyCredits: '', monthlyCredits: '' }); }} className={btnPrimary}>
            + Nuevo plan
          </button>
        </div>
        {loading ? <p className="px-5 py-4 text-sm text-gray-400">Cargando…</p> : plans.length === 0 ? (
          <p className="px-5 py-4 text-sm text-gray-500">Aún no hay planes. Crea uno y asígnalo a las empresas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <th className="px-5 py-2 font-medium">Plan</th>
                  <th className="px-3 py-2 font-medium text-right">Diario</th>
                  <th className="px-3 py-2 font-medium text-right">Mensual</th>
                  <th className="px-3 py-2 font-medium text-right">Empresas</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {plans.map((p) => (
                  <tr key={p.id}>
                    <td className="px-5 py-2.5 font-medium text-gray-800">{p.name}</td>
                    <td className="px-3 py-2.5 text-right">{limitLabel(p.dailyCredits)}</td>
                    <td className="px-3 py-2.5 text-right">{limitLabel(p.monthlyCredits)}</td>
                    <td className="px-3 py-2.5 text-right">{p._count?.companies ?? 0}</td>
                    <td className="px-5 py-2.5 text-right whitespace-nowrap">
                      <button type="button" className="text-xs text-blue-600 hover:underline mr-3"
                        onClick={() => { setFormError(''); setForm({ id: p.id, name: p.name, dailyCredits: p.dailyCredits?.toString() ?? '', monthlyCredits: p.monthlyCredits?.toString() ?? '' }); }}>
                        Editar
                      </button>
                      <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => removePlan(p)}>Eliminar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
          <h2 className="ui-section-title">Empresas</h2>
          <p className="text-xs text-gray-400 mt-0.5">Plan asignado y créditos usados hoy y este mes.</p>
        </div>
        {loading ? <p className="px-5 py-4 text-sm text-gray-400">Cargando…</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <th className="px-5 py-2 font-medium">Empresa</th>
                  <th className="px-3 py-2 font-medium">Plan</th>
                  <th className="px-3 py-2 font-medium text-right">Hoy</th>
                  <th className="px-5 py-2 font-medium text-right">Mes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {companies.map((c) => {
                  const plan = plans.find((p) => p.id === c.aiPlanId);
                  return (
                    <tr key={c.id}>
                      <td className="px-5 py-2.5 text-gray-800">{c.name}</td>
                      <td className="px-3 py-2.5">
                        <select value={c.aiPlanId ?? ''} disabled={assigning === c.id} onChange={(e) => assign(c.id, e.target.value)}
                          className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm bg-white min-w-[160px] disabled:opacity-50">
                          <option value="">Sin IA</option>
                          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        {c.usedToday}{plan?.dailyCredits != null ? ` / ${plan.dailyCredits}` : ''}
                      </td>
                      <td className="px-5 py-2.5 text-right whitespace-nowrap">
                        {c.usedMonth}{plan?.monthlyCredits != null ? ` / ${plan.monthlyCredits}` : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {form && (
        <Modal title={form.id ? 'Editar plan' : 'Nuevo plan'} subtitle="Deja un límite vacío para que no tenga tope."
          onClose={() => setForm(null)} onSubmit={savePlan} busy={saving}
          footer={(
            <>
              <button type="button" onClick={() => setForm(null)} disabled={saving} className={btnSecondary}>Cancelar</button>
              <button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Guardando...' : 'Guardar'}</button>
            </>
          )}>
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Nombre *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Ej: Básico" className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Créditos por día</label>
                <input type="number" min={0} value={form.dailyCredits} onChange={(e) => setForm({ ...form, dailyCredits: e.target.value })} placeholder="Sin límite" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Créditos por mes</label>
                <input type="number" min={0} value={form.monthlyCredits} onChange={(e) => setForm({ ...form, monthlyCredits: e.target.value })} placeholder="Sin límite" className={inputCls} />
              </div>
            </div>
            <FormError message={formError} />
          </div>
        </Modal>
      )}
    </div>
  );
}

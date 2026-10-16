'use client';

import { useCallback, useEffect, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api, type ProductionArea, type ProductionProcess, type ProductionProcessStage, type ProductionSettings } from '@/lib/api';
import { useAdminCompany } from '../../AdminCompanyContext';
import { confirmDialog } from '../../ConfirmDialog';
import { Modal, btnPrimary, btnSecondary, inputCls, labelCls, FormError } from '@/components/ui/Modal';
import { Badge, fmtCLP } from '../shared';

type Tab = 'processes' | 'areas' | 'settings';

const emptyStage = (): ProductionProcessStage => ({ name: '', areaId: null, estimatedDays: null, estimatedHours: null, checklist: [], requiresApproval: false, notifyCustomer: false, customerVisible: true });

// Plantillas para partir rápido (se pueden editar antes de guardar).
const TEMPLATES: Array<{ name: string; isRepair: boolean; description: string; stages: Array<Partial<ProductionProcessStage> & { name: string }> }> = [
  {
    name: 'Mueble a medida', isRepair: false, description: 'Fabricación de muebles según especificaciones del cliente',
    stages: [
      { name: 'Medición', estimatedDays: 1, checklist: ['Visitar al cliente', 'Registrar medidas'] },
      { name: 'Diseño', estimatedDays: 2, requiresApproval: true, checklist: ['Plano con medidas', 'Materiales y colores'] },
      { name: 'Corte', estimatedDays: 1 },
      { name: 'Armado', estimatedDays: 2 },
      { name: 'Terminaciones', estimatedDays: 2, checklist: ['Lijado', 'Barniz o tapizado'] },
      { name: 'Control de calidad', estimatedDays: 1, checklist: ['Medidas finales', 'Sin defectos de terminación'] },
    ],
  },
  {
    name: 'Reparación', isRepair: true, description: 'Equipo o mueble que trae el cliente',
    stages: [
      { name: 'Recepción', estimatedDays: 0, checklist: ['Fotos del estado al recibir', 'Accesorios registrados'] },
      { name: 'Diagnóstico', estimatedDays: 1 },
      { name: 'Presupuesto', estimatedDays: 1, requiresApproval: true },
      { name: 'Reparación', estimatedDays: 3 },
      { name: 'Prueba y entrega', estimatedDays: 1, checklist: ['Prueba funcional'] },
    ],
  },
  {
    name: 'Personalización', isRepair: false, description: 'Producto base con terminación personalizada',
    stages: [
      { name: 'Diseño', estimatedDays: 1, requiresApproval: true },
      { name: 'Producción', estimatedDays: 2 },
      { name: 'Empaque', estimatedDays: 0.5, customerVisible: false },
    ],
  },
];

export default function ProductionConfigPage() {
  const { companyId, selectedCompanyId } = useAdminCompany();
  const [tab, setTab] = useState<Tab>('processes');
  const [processes, setProcesses] = useState<ProductionProcess[]>([]);
  const [areas, setAreas] = useState<ProductionArea[]>([]);
  const [settings, setSettings] = useState<ProductionSettings | null>(null);
  const [editing, setEditing] = useState<Partial<ProductionProcess> | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [noCompany, setNoCompany] = useState(false);

  const load = useCallback(() => {
    const t = getToken();
    if (!t) return;
    if (getUser()?.role === 'SUPER_ADMIN' && !selectedCompanyId) { setNoCompany(true); return; }
    setNoCompany(false);
    Promise.all([api.production.processes(t, companyId), api.production.areas(t, companyId), api.production.settings(t, companyId)])
      .then(([p, a, s]) => { setProcesses(p); setAreas(a); setSettings(s); setError(''); })
      .catch((e) => setError(e.message));
  }, [companyId, selectedCompanyId]);

  useEffect(() => {
    const id = requestAnimationFrame(load);
    return () => cancelAnimationFrame(id);
  }, [load]);

  async function removeProcess(p: ProductionProcess) {
    if (!(await confirmDialog(`¿Eliminar el proceso «${p.name}»? Si ya se usa, queda desactivado.`, { danger: true }))) return;
    try {
      const r = await api.production.deleteProcess(p.id, getToken()!);
      setNotice(r.deactivated ? 'El proceso estaba en uso: quedó desactivado' : 'Proceso eliminado');
      load();
    } catch (e) { setError((e as Error).message); }
  }

  async function saveSettings(next: Partial<ProductionSettings>) {
    try {
      setSettings(await api.production.updateSettings({ ...next, companyId }, getToken()!));
      setNotice('Ajustes guardados');
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="max-w-5xl">
      <h1 className="ui-page-title mb-1">Procesos y áreas</h1>
      <p className="ui-page-subtitle mb-4">Define las etapas de cada rubro (mueble a medida, reparación, personalización…), las áreas de trabajo y cómo se descuentan los materiales.</p>
      {noCompany && <p className="text-sm text-gray-500">Selecciona una empresa en la barra superior.</p>}
      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {notice && <div className="mb-4 rounded-lg bg-green-50 px-4 py-2.5 text-sm text-green-700">{notice}</div>}

      {!noCompany && (
        <>
          <div className="mb-4 flex gap-1 border-b border-gray-200">
            {([['processes', 'Procesos'], ['areas', 'Áreas'], ['settings', 'Ajustes']] as Array<[Tab, string]>).map(([k, l]) => (
              <button key={k} onClick={() => { setTab(k); setNotice(''); }} className={`border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{l}</button>
            ))}
          </div>

          {tab === 'processes' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => setEditing({ name: '', description: '', isRepair: false, active: true, stages: [emptyStage()] })} className={btnPrimary}>+ Nuevo proceso</button>
                <span className="text-xs text-gray-400">o parte de una plantilla:</span>
                {TEMPLATES.map((tp) => (
                  <button key={tp.name} onClick={() => setEditing({ name: tp.name, description: tp.description, isRepair: tp.isRepair, active: true, stages: tp.stages.map((s) => ({ ...emptyStage(), ...s })) })}
                    className="rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">{tp.name}</button>
                ))}
              </div>
              {processes.length === 0 && <p className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">Aún no hay procesos. Crea uno o parte de una plantilla.</p>}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {processes.map((p) => (
                  <div key={p.id} className={`rounded-2xl border bg-white p-4 ${p.active ? 'border-gray-200' : 'border-gray-200 opacity-60'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h2 className="ui-section-title">{p.name}</h2>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {p.isRepair && <Badge cls="bg-purple-50 text-purple-700">Reparación</Badge>}
                          {!p.active && <Badge cls="bg-gray-100 text-gray-500">Desactivado</Badge>}
                          <Badge cls="bg-gray-100 text-gray-600">{p._count?.products ?? 0} producto(s)</Badge>
                          <Badge cls="bg-gray-100 text-gray-600">{p._count?.orders ?? 0} orden(es)</Badge>
                        </div>
                      </div>
                      <div className="flex gap-2 text-xs">
                        <button onClick={() => setEditing(p)} className="font-medium text-blue-600 hover:underline">Editar</button>
                        <button onClick={() => removeProcess(p)} className="font-medium text-red-500 hover:underline">Eliminar</button>
                      </div>
                    </div>
                    {p.description && <p className="mt-2 text-xs text-gray-500">{p.description}</p>}
                    <ol className="mt-3 flex flex-wrap items-center gap-1 text-xs text-gray-700">
                      {p.stages.map((s, i) => (
                        <li key={s.id || i} className="flex items-center gap-1">
                          <span className={`rounded-md px-2 py-0.5 ${s.requiresApproval ? 'bg-amber-50 text-amber-800' : 'bg-gray-100'}`}>{s.name}</span>
                          {i < p.stages.length - 1 && <span className="text-gray-300">→</span>}
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'areas' && <AreasTab areas={areas} companyId={companyId} onChanged={load} onError={setError} />}

          {tab === 'settings' && settings && (
            <div className="space-y-4">
              <section className="rounded-2xl border border-gray-200 bg-white p-5">
                <h2 className="ui-section-title mb-1">Descuento de materiales</h2>
                <p className="mb-3 text-xs text-gray-500">Cuándo salen del inventario los materiales de la lista de materiales de cada orden.</p>
                <div className="space-y-2">
                  {([
                    ['START', 'Al iniciar la orden', 'Se descuentan todos al iniciar la primera etapa.'],
                    ['STAGE', 'Al iniciar la etapa que los usa', 'Los materiales sin etapa salen al iniciar la orden; el resto, al iniciar su etapa.'],
                    ['END', 'Al terminar la orden', 'Se descuentan todos al terminar.'],
                  ] as const).map(([v, l, d]) => (
                    <label key={v} className="flex items-start gap-2 text-sm">
                      <input type="radio" name="consume" checked={settings.consumeMaterialsAt === v} onChange={() => saveSettings({ consumeMaterialsAt: v })} className="mt-1 accent-blue-600" />
                      <span><span className="font-medium text-gray-800">{l}</span><span className="block text-xs text-gray-500">{d}</span></span>
                    </label>
                  ))}
                </div>
              </section>
              <section className="rounded-2xl border border-gray-200 bg-white p-5">
                <h2 className="ui-section-title mb-1">Despacho</h2>
                <p className="mb-3 text-xs text-gray-500">Una venta con órdenes de fabricación en curso nunca se despacha. Además puedes exigir que esté pagada.</p>
                <label className="flex items-center gap-2 text-sm text-gray-800">
                  <input type="checkbox" checked={settings.blockDispatchWithBalance} onChange={(e) => saveSettings({ blockDispatchWithBalance: e.target.checked })} className="accent-blue-600" />
                  No despachar mientras la venta tenga saldo por cobrar
                </label>
              </section>
              <section className="rounded-2xl border border-gray-200 bg-white p-5">
                <div className="mb-1 flex items-center gap-2">
                  <h2 className="ui-section-title">Avisos al cliente</h2>
                  <Badge cls="bg-[var(--brand)] text-white">Próximamente</Badge>
                </div>
                <p className="mb-3 text-xs text-gray-500">
                  Cada etapa marcada con «Avisar al cliente» ya queda registrada. Cuando se activen, el cliente recibirá el aviso automáticamente.
                  Mientras tanto, compártele el link de seguimiento o escríbele por WhatsApp desde la orden.
                </p>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-gray-400"><input type="checkbox" disabled checked={false} readOnly /> Correo automático</label>
                  <label className="flex items-center gap-2 text-sm text-gray-400"><input type="checkbox" disabled checked={false} readOnly /> WhatsApp automático</label>
                </div>
              </section>
            </div>
          )}
        </>
      )}

      {editing && (
        <ProcessModal process={editing} areas={areas.filter((a) => a.active)} companyId={companyId}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setNotice('Proceso guardado'); load(); }} />
      )}
    </div>
  );
}

function ProcessModal({ process, areas, companyId, onClose, onSaved }: { process: Partial<ProductionProcess>; areas: ProductionArea[]; companyId?: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: process.name || '', description: process.description || '', isRepair: !!process.isRepair, active: process.active ?? true });
  const [stages, setStages] = useState<ProductionProcessStage[]>((process.stages || []).map((s) => ({ ...s, checklist: s.checklist || [] })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const setStage = (i: number, patch: Partial<ProductionProcessStage>) => setStages((list) => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => setStages((list) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.production.saveProcess({
        id: process.id, companyId, ...form,
        stages: stages.map((s) => ({
          name: s.name, areaId: s.areaId || null,
          estimatedDays: s.estimatedDays === '' || s.estimatedDays == null ? null : Number(s.estimatedDays),
          estimatedHours: s.estimatedHours === '' || s.estimatedHours == null ? null : Number(s.estimatedHours),
          checklist: s.checklist, requiresApproval: s.requiresApproval, notifyCustomer: s.notifyCustomer, customerVisible: s.customerVisible,
        })),
      }, getToken()!);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const totalDays = stages.reduce((s, st) => s + (Number(st.estimatedDays) || 0), 0);

  return (
    <Modal title={process.id ? `Editar «${process.name}»` : 'Nuevo proceso'} size="xl" busy={busy} onClose={onClose} onSubmit={save}
      footer={<><button type="button" onClick={onClose} className={btnSecondary}>Cancelar</button><button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Guardando…' : 'Guardar proceso'}</button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className={labelCls}>Nombre</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} required /></div>
          <div><label className={labelCls}>Descripción</label><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls} /></div>
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-gray-700">
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.isRepair} onChange={(e) => setForm({ ...form, isRepair: e.target.checked })} className="accent-blue-600" /> Es de reparación (pide la ficha del equipo recibido)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="accent-blue-600" /> Activo</label>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">Etapas ({stages.length}) · {totalDays} día(s) en total</h3>
            <button type="button" onClick={() => setStages((l) => [...l, emptyStage()])} className="text-xs font-semibold text-blue-600 hover:underline">+ Agregar etapa</button>
          </div>
          <ol className="space-y-3">
            {stages.map((s, i) => (
              <li key={i} className="rounded-xl border border-gray-200 p-3">
                <div className="flex items-start gap-2">
                  <span className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-600">{i + 1}</span>
                  <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-6">
                    <input value={s.name} onChange={(e) => setStage(i, { name: e.target.value })} placeholder="Nombre de la etapa" className={`${inputCls} col-span-2 sm:col-span-2`} />
                    <select value={s.areaId || ''} onChange={(e) => setStage(i, { areaId: e.target.value || null })} className={`${inputCls} col-span-2 sm:col-span-2`}>
                      <option value="">Sin área</option>
                      {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    <input type="number" min="0" step="0.5" value={s.estimatedDays ?? ''} onChange={(e) => setStage(i, { estimatedDays: e.target.value })} placeholder="Días" title="Días estimados" className={inputCls} />
                    <input type="number" min="0" step="0.5" value={s.estimatedHours ?? ''} onChange={(e) => setStage(i, { estimatedHours: e.target.value })} placeholder="Horas" title="Horas de trabajo por unidad" className={inputCls} />
                    <textarea value={s.checklist.join('\n')} onChange={(e) => setStage(i, { checklist: e.target.value.split('\n') })} rows={2}
                      placeholder="Lista de verificación (una tarea por línea)" className={`${inputCls} col-span-2 resize-none sm:col-span-6`} />
                    <div className="col-span-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-700 sm:col-span-6">
                      <label className="flex items-center gap-1.5"><input type="checkbox" checked={s.requiresApproval} onChange={(e) => setStage(i, { requiresApproval: e.target.checked })} className="accent-blue-600" /> Requiere aprobación del cliente</label>
                      <label className="flex items-center gap-1.5"><input type="checkbox" checked={s.customerVisible} onChange={(e) => setStage(i, { customerVisible: e.target.checked })} className="accent-blue-600" /> El cliente la ve en su seguimiento</label>
                      <label className="flex items-center gap-1.5" title="Los avisos automáticos se activarán más adelante"><input type="checkbox" checked={s.notifyCustomer} onChange={(e) => setStage(i, { notifyCustomer: e.target.checked })} className="accent-blue-600" /> Avisar al cliente <span className="text-gray-400">(cuando se activen los avisos)</span></label>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded px-1.5 text-gray-400 hover:bg-gray-100 disabled:opacity-30" aria-label="Subir">↑</button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === stages.length - 1} className="rounded px-1.5 text-gray-400 hover:bg-gray-100 disabled:opacity-30" aria-label="Bajar">↓</button>
                    <button type="button" onClick={() => setStages((l) => l.filter((_, j) => j !== i))} className="rounded px-1.5 text-red-400 hover:bg-red-50" aria-label="Quitar etapa">✕</button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[11px] text-gray-400">Cambiar las etapas no altera las órdenes ya creadas: cada orden guarda su propia copia.</p>
        </div>
        <FormError message={error} />
      </div>
    </Modal>
  );
}

function AreasTab({ areas, companyId, onChanged, onError }: { areas: ProductionArea[]; companyId?: string; onChanged: () => void; onError: (m: string) => void }) {
  const [form, setForm] = useState<{ id?: string; name: string; hourlyCost: string; dailyCapacityHours: string; active: boolean }>({ name: '', hourlyCost: '', dailyCapacityHours: '', active: true });
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.production.saveArea({ ...form, companyId, hourlyCost: Number(form.hourlyCost) || 0, dailyCapacityHours: form.dailyCapacityHours === '' ? null : Number(form.dailyCapacityHours) }, getToken()!);
      setForm({ name: '', hourlyCost: '', dailyCapacityHours: '', active: true });
      onChanged();
    } catch (err) { onError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function remove(a: ProductionArea) {
    if (!(await confirmDialog(`¿Eliminar el área «${a.name}»? Si ya se usa, queda desactivada.`, { danger: true }))) return;
    try { await api.production.deleteArea(a.id, getToken()!); onChanged(); } catch (err) { onError((err as Error).message); }
  }
  return (
    <div className="space-y-4">
      <form onSubmit={save} className="grid grid-cols-2 gap-2 rounded-2xl border border-gray-200 bg-white p-4 sm:grid-cols-5">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nombre (p. ej. Tapicería)" className={`${inputCls} col-span-2`} required />
        <input type="number" min="0" value={form.hourlyCost} onChange={(e) => setForm({ ...form, hourlyCost: e.target.value })} placeholder="Costo por hora $" className={inputCls} />
        <input type="number" min="0" step="0.5" value={form.dailyCapacityHours} onChange={(e) => setForm({ ...form, dailyCapacityHours: e.target.value })} placeholder="Horas por día" className={inputCls} />
        <div className="col-span-2 flex gap-2 sm:col-span-1">
          <button type="submit" disabled={busy} className={`${btnPrimary} flex-1`}>{form.id ? 'Guardar' : 'Agregar'}</button>
          {form.id && <button type="button" onClick={() => setForm({ name: '', hourlyCost: '', dailyCapacityHours: '', active: true })} className={btnSecondary}>✕</button>}
        </div>
      </form>
      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
            <tr><th className="px-3 py-2 text-left font-medium">Área</th><th className="px-3 py-2 text-right font-medium">Costo por hora</th><th className="px-3 py-2 text-right font-medium">Capacidad diaria</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {areas.map((a) => (
              <tr key={a.id} className={a.active ? '' : 'opacity-50'}>
                <td className="px-3 py-2 font-medium text-gray-900">{a.name}{!a.active && <span className="ml-2 text-xs text-gray-400">(desactivada)</span>}</td>
                <td className="px-3 py-2 text-right">{fmtCLP(Number(a.hourlyCost))}</td>
                <td className="px-3 py-2 text-right text-gray-600">{a.dailyCapacityHours != null ? `${Number(a.dailyCapacityHours)} h` : '—'}</td>
                <td className="px-3 py-2 text-right text-xs">
                  <button onClick={() => setForm({ id: a.id, name: a.name, hourlyCost: String(Number(a.hourlyCost)), dailyCapacityHours: a.dailyCapacityHours != null ? String(Number(a.dailyCapacityHours)) : '', active: true })} className="mr-3 font-medium text-blue-600 hover:underline">Editar</button>
                  <button onClick={() => remove(a)} className="font-medium text-red-500 hover:underline">Eliminar</button>
                </td>
              </tr>
            ))}
            {areas.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-400">Sin áreas. Las áreas dan el costo de la mano de obra y la carga del calendario.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

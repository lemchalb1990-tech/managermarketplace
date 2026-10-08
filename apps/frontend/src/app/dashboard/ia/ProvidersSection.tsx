'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api, type AiProviderInfo, type AiProvidersOverview, type AiTask } from '@/lib/api';
import { Modal, btnPrimary, btnSecondary, inputCls, labelCls, FormError } from '@/components/ui/Modal';

const TASK_ICON: Record<AiTask, string> = { PHOTO_CHECK: '🔍', PHOTO_FIX: '✨', PHOTO_GENERATE: '🎨' };
const PROVIDER_COLOR: Record<string, string> = {
  openai: 'bg-gray-900 text-white',
  anthropic: 'bg-orange-100 text-orange-700',
  gemini: 'bg-blue-100 text-blue-700',
  photoroom: 'bg-purple-100 text-purple-700',
  removebg: 'bg-emerald-100 text-emerald-700',
};

// Tareas de IA (qué proveedor hace cada una y cuántos créditos cuesta) y proveedores
// disponibles. Al hacer clic en un proveedor se abre su modal de configuración.
export default function ProvidersSection() {
  const [data, setData] = useState<AiProvidersOverview | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<AiProviderInfo | null>(null);
  const [costs, setCosts] = useState<Record<AiTask, string>>({ PHOTO_CHECK: '', PHOTO_FIX: '', PHOTO_GENERATE: '' });
  const [savingCosts, setSavingCosts] = useState(false);
  const [costsMsg, setCostsMsg] = useState('');

  async function load() {
    try {
      const d = await api.ai.providers.list(getToken()!);
      setData(d);
      if (d.costs) setCosts({ PHOTO_CHECK: String(d.costs.PHOTO_CHECK), PHOTO_FIX: String(d.costs.PHOTO_FIX), PHOTO_GENERATE: String(d.costs.PHOTO_GENERATE ?? '') });
    } catch (e: any) {
      setError(e.message || 'No se pudieron cargar los proveedores de IA.');
    }
  }

  useEffect(() => { load(); }, []);

  async function saveCosts() {
    setSavingCosts(true);
    setCostsMsg('');
    try {
      await api.ai.updateCosts({ PHOTO_CHECK: Number(costs.PHOTO_CHECK) || 0, PHOTO_FIX: Number(costs.PHOTO_FIX) || 0, PHOTO_GENERATE: Number(costs.PHOTO_GENERATE) || 0 }, getToken()!);
      setCostsMsg('✓ Guardado');
      setTimeout(() => setCostsMsg(''), 2500);
    } catch (e: any) {
      setError(e.message || 'No se pudieron guardar los créditos.');
    } finally {
      setSavingCosts(false);
    }
  }

  if (error && !data) return <FormError message={error} />;
  if (!data) return <p className="text-sm text-gray-400">Cargando…</p>;

  const providerName = (id: string | null) => data.providers.find((p) => p.id === id)?.name;
  const tasks = Object.keys(data.tasks) as AiTask[];

  return (
    <>
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
          <h2 className="ui-section-title">Tareas</h2>
          <p className="text-xs text-gray-400 mt-0.5">Qué trabajo hace la IA, con qué proveedor y cuántos créditos del plan descuenta cada vez.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-gray-100">
          {tasks.map((t) => {
            const task = data.tasks[t];
            const prov = data.providers.find((p) => p.id === task.providerId);
            const ready = !!prov?.configured;
            return (
              <div key={t} className="p-5 space-y-2">
                <p className="text-sm font-semibold text-gray-800">{TASK_ICON[t]} {task.label}</p>
                <p className="text-xs text-gray-500">{task.description}</p>
                <p className="text-xs">
                  Proveedor:{' '}
                  {prov
                    ? <button type="button" onClick={() => setOpen(prov)} className="font-medium text-blue-600 hover:underline">{prov.name}</button>
                    : <span className="font-medium text-red-600">Sin asignar</span>}
                  {prov && !ready && <span className="text-red-600"> · falta la API key</span>}
                </p>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500">{t === 'PHOTO_GENERATE' ? 'Créditos por imagen' : 'Créditos por foto'}</label>
                  <input type="number" min={0} value={costs[t]} onChange={(e) => setCosts((c) => ({ ...c, [t]: e.target.value }))}
                    className="w-20 px-2 py-1 border border-gray-300 rounded-lg text-sm" />
                </div>
              </div>
            );
          })}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-3">
          <button type="button" onClick={saveCosts} disabled={savingCosts} className={btnSecondary}>
            {savingCosts ? 'Guardando...' : 'Guardar créditos'}
          </button>
          {costsMsg && <span className="text-xs text-green-600">{costsMsg}</span>}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
          <h2 className="ui-section-title">Proveedores de IA</h2>
          <p className="text-xs text-gray-400 mt-0.5">Puedes usar varios a la vez: cada tarea la hace el proveedor que elijas. Haz clic en uno para configurarlo.</p>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.providers.map((p) => (
            <button key={p.id} type="button" onClick={() => setOpen(p)}
              className="text-left border border-gray-200 rounded-xl p-4 hover:border-blue-400 hover:shadow-sm transition flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <span className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold shrink-0 ${PROVIDER_COLOR[p.id] || 'bg-gray-100 text-gray-700'}`}>
                  {p.name.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-800">{p.name}</p>
                  <p className="text-[11px] text-gray-400">{p.company}</p>
                </div>
                <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded shrink-0 ${p.configured ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {p.configured ? 'Configurada' : 'Sin configurar'}
                </span>
              </div>
              <p className="text-xs text-gray-500">{p.description}</p>
              <div className="flex flex-wrap gap-1 mt-auto">
                {p.tasks.map((t) => (
                  <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded ${p.assignedTasks.includes(t) ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    {TASK_ICON[t]} {data.tasks[t].label}{p.assignedTasks.includes(t) ? ' · en uso' : ''}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      </div>

      {open && (
        <ProviderModal
          provider={open}
          tasks={data.tasks}
          currentFor={(t) => providerName(data.tasks[t].providerId) || null}
          onClose={() => setOpen(null)}
          onSaved={(d) => { setData((prev) => ({ ...d, costs: prev?.costs })); setOpen(null); }}
        />
      )}
    </>
  );
}

function ProviderModal({ provider, tasks, currentFor, onClose, onSaved }: {
  provider: AiProviderInfo;
  tasks: AiProvidersOverview['tasks'];
  currentFor: (t: AiTask) => string | null;
  onClose: () => void;
  onSaved: (d: AiProvidersOverview) => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [removeKey, setRemoveKey] = useState(false);
  const [models, setModels] = useState<Record<string, string>>(
    () => Object.fromEntries(Object.entries(provider.models).map(([t, m]) => [t, m!.value])),
  );
  const [useFor, setUseFor] = useState<AiTask[]>(provider.assignedTasks);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState('');

  const willHaveKey = !removeKey && (provider.configured || !!apiKey.trim());

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (useFor.length && !willHaveKey) { setError(`Ingresa la API Key de ${provider.name} para usarla en una tarea.`); return; }
    setSaving(true);
    setError('');
    try {
      const d = await api.ai.providers.update(provider.id, {
        ...(removeKey ? { removeKey: true } : apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        models,
        tasks: removeKey ? [] : useFor,
      }, getToken()!);
      onSaved(d);
    } catch (err: any) {
      setError(err.message || 'No se pudo guardar.');
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setTestMsg(null);
    try {
      const r = await api.ai.providers.test(provider.id, getToken()!, apiKey.trim() || undefined);
      setTestMsg({ ok: true, text: r.message });
    } catch (err: any) {
      setTestMsg({ ok: false, text: err.message || 'No se pudo conectar.' });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Modal
      title={`${provider.name} · ${provider.company}`}
      subtitle={provider.description}
      size="lg"
      busy={saving}
      onClose={onClose}
      onSubmit={save}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={saving} className={btnSecondary}>Cancelar</button>
          <button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Guardando...' : 'Guardar'}</button>
        </>
      )}
    >
      <div className="space-y-5">
        <div>
          <h3 className="text-xs font-semibold text-gray-600 mb-2">Qué trabajo hará</h3>
          <div className="space-y-2">
            {provider.tasks.map((t) => {
              const current = currentFor(t);
              const taking = !provider.assignedTasks.includes(t) && useFor.includes(t) && current && current !== provider.name;
              return (
                <label key={t} className={`flex items-start gap-3 border rounded-xl p-3 cursor-pointer ${useFor.includes(t) ? 'border-blue-400 bg-blue-50/40' : 'border-gray-200'}`}>
                  <input type="checkbox" checked={useFor.includes(t)} disabled={removeKey} className="mt-1 accent-blue-600"
                    onChange={(e) => setUseFor((u) => (e.target.checked ? [...u, t] : u.filter((x) => x !== t)))} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-800">{TASK_ICON[t]} {tasks[t].label}</span>
                    <span className="block text-xs text-gray-500">{tasks[t].description}</span>
                    {provider.taskNotes[t] && <span className="block text-[11px] text-gray-400 mt-1">{provider.taskNotes[t]}</span>}
                    {taking && <span className="block text-[11px] text-amber-600 mt-1">Reemplazará a {current} en esta tarea.</span>}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div>
          <label className={labelCls}>API Key</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input type="password" autoComplete="off" value={apiKey} disabled={removeKey}
              onChange={(e) => { setApiKey(e.target.value); setTestMsg(null); }}
              placeholder={provider.configured ? 'Configurada — escribe una nueva para reemplazarla' : 'Pega aquí la API key'}
              className={`${inputCls} font-mono`} />
            <button type="button" onClick={test} disabled={testing || removeKey || (!provider.configured && !apiKey.trim())}
              className={`${btnSecondary} shrink-0`}>
              {testing ? 'Probando...' : 'Probar conexión'}
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 mt-1">
            <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-600 hover:underline">
              Obtener una API key de {provider.name} ↗
            </a>
            {provider.configured && (
              <label className="flex items-center gap-1.5 text-[11px] text-red-600 cursor-pointer">
                <input type="checkbox" checked={removeKey} onChange={(e) => setRemoveKey(e.target.checked)} />
                Quitar la API key guardada (deja de usarse)
              </label>
            )}
          </div>
          {testMsg && <p className={`text-xs mt-1 ${testMsg.ok ? 'text-green-600' : 'text-red-600'}`}>{testMsg.ok ? '✓ ' : ''}{testMsg.text}</p>}
        </div>

        {Object.keys(provider.models).length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(Object.entries(provider.models) as [AiTask, NonNullable<AiProviderInfo['models'][AiTask]>][]).map(([t, m]) => (
              <div key={t}>
                <label className={labelCls}>{m.label}</label>
                <input value={models[t] ?? ''} placeholder={m.default}
                  onChange={(e) => setModels((v) => ({ ...v, [t]: e.target.value }))} className={`${inputCls} font-mono`} />
                <p className="text-[11px] text-gray-400 mt-1">Vacío = {m.default}</p>
              </div>
            ))}
          </div>
        )}

        <FormError message={error} />
      </div>
    </Modal>
  );
}

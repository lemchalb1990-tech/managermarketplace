'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';
import { btnPrimary, inputCls, labelCls, FormError } from '@/components/ui/Modal';

const MASK = '••••••••';
const FIELDS = [
  { key: 'OPENAI_VISION_MODEL', label: 'Modelo de visión (revisar fotos)', placeholder: 'gpt-5-mini' },
  { key: 'OPENAI_IMAGE_MODEL', label: 'Modelo de imagen (corregir fotos)', placeholder: 'gpt-image-1.5' },
  { key: 'AI_CREDITS_PHOTO_CHECK', label: 'Créditos por foto revisada', placeholder: '1', number: true },
  { key: 'AI_CREDITS_PHOTO_FIX', label: 'Créditos por foto corregida', placeholder: '5', number: true },
] as const;

// Servicio de IA de la plataforma (OpenAI): API key, modelos y costo en créditos. Se guarda
// en la configuración del sistema (grupo "ia").
export default function AiServiceSettings() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [keySet, setKeySet] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api.settings.list(token)
      .then((rows) => {
        const v: Record<string, string> = {};
        rows.filter((r: any) => r.group === 'ia').forEach((r: any) => { v[r.key] = r.value ?? ''; });
        setKeySet(v.OPENAI_API_KEY === MASK);
        setValues(v);
      })
      .catch(() => setError('No se pudo cargar la configuración de IA.'))
      .finally(() => setLoading(false));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    setError('');
    try {
      const items: { key: string; value: string }[] = FIELDS.map((f) => ({ key: f.key, value: (values[f.key] ?? '').trim() }));
      // La key solo se envía si se escribió una nueva (la guardada no se muestra).
      if (newKey.trim()) items.push({ key: 'OPENAI_API_KEY', value: newKey.trim() });
      await api.settings.update(items, getToken()!);
      if (newKey.trim()) { setKeySet(true); setNewKey(''); }
      setMsg('Configuración de IA guardada.');
    } catch (err: any) {
      setError(err.message || 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  }

  async function removeKey() {
    setSaving(true);
    setError('');
    try {
      await api.settings.update([{ key: 'OPENAI_API_KEY', value: '' }], getToken()!);
      setKeySet(false);
      setMsg('API Key eliminada: la IA queda desactivada.');
    } catch (err: any) {
      setError(err.message || 'No se pudo quitar la API Key.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
        <h2 className="ui-section-title">Servicio de IA (OpenAI)</h2>
        <p className="text-xs text-gray-400 mt-0.5">Revisa que las fotos coincidan con el título y las corrige antes de publicar en Mercado Libre.</p>
      </div>
      {loading ? <p className="px-5 py-4 text-sm text-gray-400">Cargando…</p> : (
        <form onSubmit={save} className="p-5 space-y-4">
          <div>
            <label className={labelCls}>API Key de OpenAI</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input type="password" autoComplete="off" value={newKey} onChange={(e) => setNewKey(e.target.value)}
                placeholder={keySet ? 'Configurada — escribe una nueva para reemplazarla' : 'sk-...'} className={`${inputCls} font-mono`} />
              {keySet && (
                <button type="button" onClick={removeKey} disabled={saving}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 shrink-0">
                  Quitar
                </button>
              )}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              {keySet ? '✓ Hay una API Key guardada.' : 'Sin API Key la IA no funciona.'} Se crea en platform.openai.com → API keys.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {FIELDS.map((f) => (
              <div key={f.key}>
                <label className={labelCls}>{f.label}</label>
                <input type={'number' in f ? 'number' : 'text'} min={0} value={values[f.key] ?? ''} placeholder={f.placeholder}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} className={inputCls} />
              </div>
            ))}
          </div>
          <FormError message={error} />
          <div className="flex items-center gap-3">
            <button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Guardando...' : 'Guardar'}</button>
            {msg && <span className="text-xs text-green-600">{msg}</span>}
          </div>
        </form>
      )}
    </div>
  );
}

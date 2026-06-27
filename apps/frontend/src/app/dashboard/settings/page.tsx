'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api';

const GROUP_LABELS: Record<string, string> = {
  sistema: 'Sistema',
  mercadolibre: 'Mercado Libre',
  otros: 'Otros',
};

const GROUP_HINTS: Record<string, string> = {
  sistema: 'URLs base de la plataforma. Requieren redespliegue si se cambian en variables de entorno.',
  mercadolibre: 'Configuración de integración con Mercado Libre. La URL de callback debe coincidir exactamente con la registrada en ML Developer.',
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<any[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api.settings.list(token)
      .then((rows) => {
        setSettings(rows);
        const initial: Record<string, string> = {};
        rows.forEach((r: any) => { initial[r.key] = r.value; });
        setDraft(initial);
      })
      .catch(() => setError('No se pudo cargar la configuración.'))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const token = getToken()!;
      const items = Object.entries(draft).map(([key, value]) => ({ key, value }));
      await api.settings.update(items, token);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Error al guardar.');
    } finally {
      setSaving(false);
    }
  }

  const grouped = settings.reduce((acc: Record<string, any[]>, s) => {
    if (!acc[s.group]) acc[s.group] = [];
    acc[s.group].push(s);
    return acc;
  }, {});

  const groupOrder = ['sistema', 'mercadolibre', 'otros'];

  if (loading) return <p className="text-gray-400 text-sm">Cargando configuración...</p>;

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Configuración del sistema</h1>
        <p className="text-sm text-gray-500">
          Variables y URLs que controlan el comportamiento de la plataforma. Solo visible para Super Admin.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {groupOrder
          .filter((g) => grouped[g])
          .map((group) => (
            <div key={group} className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
                <h2 className="font-semibold text-gray-800 text-sm">{GROUP_LABELS[group] || group}</h2>
                {GROUP_HINTS[group] && (
                  <p className="text-xs text-gray-400 mt-0.5">{GROUP_HINTS[group]}</p>
                )}
              </div>
              <div className="divide-y divide-gray-50">
                {grouped[group].map((s: any) => (
                  <div key={s.key} className="px-5 py-4">
                    <div className="flex items-start justify-between mb-1.5">
                      <label className="text-sm font-medium text-gray-700">{s.label}</label>
                      <code className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded font-mono">
                        {s.key}
                      </code>
                    </div>
                    {s.hint && (
                      <p className="text-xs text-gray-400 mb-2 leading-relaxed">{s.hint}</p>
                    )}
                    <input
                      type={s.sensitive ? 'password' : 'text'}
                      value={draft[s.key] ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                      placeholder={s.sensitive ? '••••••••' : `Ej: ${s.key === 'APP_URL' ? 'https://api.tudominio.com' : s.key === 'FRONTEND_URL' ? 'https://tudominio.com' : ''}`}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition"
          >
            {saving ? 'Guardando...' : 'Guardar configuración'}
          </button>
          {saved && (
            <span className="text-sm text-green-600 font-medium">
              ✓ Configuración guardada
            </span>
          )}
          {error && (
            <span className="text-sm text-red-600">{error}</span>
          )}
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700 leading-relaxed">
          <strong>Nota:</strong> Los cambios guardados aquí tienen prioridad sobre las variables de entorno del servidor.
          Si actualizas <code className="bg-amber-100 px-1 rounded">ML_REDIRECT_URI</code>, también debes actualizarla
          en la configuración de tu app en <strong>ML Developer</strong>.
        </div>
      </form>
    </div>
  );
}

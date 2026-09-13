'use client';

import { useEffect, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api, imgUrl } from '@/lib/api';
import { invalidateDashboardTimezoneCache } from '@/lib/dashboardTimezone';
import { invalidateNotificationSoundsCache } from '@/lib/notificationSounds';
import { confirmDialog } from '../ConfirmDialog';
import { useNotifications } from '../Notifications';

const NOTIF_SOUND_KEYS = ['NOTIF_SOUND_SALE', 'NOTIF_SOUND_QUESTION', 'NOTIF_SOUND_CLAIM'];

const TIMEZONE_OPTIONS = [
  { value: 'America/Santiago', label: 'Santiago (Chile)' },
  { value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires (Argentina)' },
  { value: 'America/Montevideo', label: 'Montevideo (Uruguay)' },
  { value: 'America/Lima', label: 'Lima (Perú)' },
  { value: 'America/Bogota', label: 'Bogotá (Colombia)' },
  { value: 'America/Mexico_City', label: 'Ciudad de México (México)' },
  { value: 'UTC', label: 'UTC' },
];

const GROUP_LABELS: Record<string, string> = {
  sistema: 'Sistema',
  mercadolibre: 'Mercado Libre',
  notificaciones: 'Notificaciones',
  otros: 'Otros',
};

const GROUP_HINTS: Record<string, string> = {
  sistema: 'URLs base de la plataforma. Requieren redespliegue si se cambian en variables de entorno.',
  mercadolibre: 'Configuración de integración con Mercado Libre. La URL de callback debe coincidir exactamente con la registrada en ML Developer.',
  notificaciones: 'Sonido que suena en la campanita al llegar cada tipo de evento. Sube archivos MP3/WAV/OGG (máx. 2 MB) y elige cuál usa cada tipo.',
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<any[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');
  const canEdit = getUser()?.role === 'SUPER_ADMIN';
  const { muted, toggleMuted } = useNotifications();

  const [sounds, setSounds] = useState<{ id: string; name: string; url: string }[]>([]);
  const [uploadingSound, setUploadingSound] = useState(false);
  const [soundError, setSoundError] = useState('');
  const [playingId, setPlayingId] = useState('');

  function loadSounds() {
    const token = getToken();
    if (!token) return;
    api.notificationSounds.list(token).then(setSounds).catch(() => {});
  }

  async function handleUploadSound(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSoundError('');
    setUploadingSound(true);
    try {
      const token = getToken()!;
      await api.notificationSounds.upload(file, token);
      loadSounds();
    } catch (err: any) {
      setSoundError(err.message || 'No se pudo subir el sonido.');
    } finally {
      setUploadingSound(false);
      e.target.value = '';
    }
  }

  async function handleDeleteSound(id: string) {
    if (!(await confirmDialog('¿Eliminar este sonido? Los tipos de evento que lo tengan elegido volverán al beep por defecto.', { danger: true }))) return;
    const token = getToken()!;
    await api.notificationSounds.remove(id, token).catch(() => {});
    invalidateNotificationSoundsCache();
    loadSounds();
    setSettings((prev) => prev.map((s) => (NOTIF_SOUND_KEYS.includes(s.key) && s.value === id ? { ...s, value: '' } : s)));
    setDraft((d) => {
      const next = { ...d };
      NOTIF_SOUND_KEYS.forEach((k) => { if (next[k] === id) next[k] = ''; });
      return next;
    });
  }

  function handlePreviewSound(url: string, id: string) {
    setPlayingId(id);
    const audio = new Audio(imgUrl(url));
    audio.play().catch(() => {});
    audio.onended = () => setPlayingId('');
  }

  function handleCopyField(key: string, value: string) {
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(''), 2000);
    });
  }

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
    loadSounds();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const token = getToken()!;
      const items = Object.entries(draft).map(([key, value]) => ({ key, value }));
      await api.settings.update(items, token);
      invalidateDashboardTimezoneCache();
      invalidateNotificationSoundsCache();
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

  const groupOrder = ['sistema', 'mercadolibre', 'notificaciones', 'otros'];
  const callbackUri = draft['APP_URL']
    ? `${draft['APP_URL'].replace(/\/+$/, '')}/api/ecommerce/ml/callback`
    : '';

  function handleCopyCallback() {
    if (!callbackUri) return;
    navigator.clipboard.writeText(callbackUri).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (loading) return <p className="text-gray-400 text-sm">Cargando configuración...</p>;

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Configuración del sistema</h1>
        <p className="text-sm text-gray-500">
          {canEdit
            ? 'Variables y URLs que controlan el comportamiento de la plataforma.'
            : 'Variables y URLs que controlan el comportamiento de la plataforma. Modo solo lectura: puedes ver y copiar los valores, pero no editarlos.'}
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
                {group === 'notificaciones' && (
                  <div className="px-5 py-4 border-b border-gray-50">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!muted}
                        onChange={toggleMuted}
                        className="w-4 h-4 accent-blue-600"
                      />
                      <span className="text-sm font-medium text-gray-700">Sonido de notificaciones</span>
                    </label>
                    <p className="text-xs text-gray-400 mt-1 ml-6">
                      Solo para ti, en este navegador. Si lo desactivas, la campanita y los avisos emergentes
                      siguen funcionando igual — solo deja de sonar, y no vuelve a pedirte que actives el sonido.
                    </p>
                  </div>
                )}
                {group === 'notificaciones' && (
                  <div className="px-5 py-4 space-y-3">
                    <label className="text-sm font-medium text-gray-700">Biblioteca de sonidos</label>
                    {sounds.length === 0 ? (
                      <p className="text-xs text-gray-400">Aún no hay sonidos subidos. Se usará el beep por defecto.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {sounds.map((s) => (
                          <li key={s.id} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                            <button
                              type="button"
                              onClick={() => handlePreviewSound(s.url, s.id)}
                              className="text-blue-600 hover:text-blue-800 shrink-0"
                              aria-label={`Reproducir ${s.name}`}
                            >
                              {playingId === s.id ? '⏸' : '▶'}
                            </button>
                            <span className="text-sm text-gray-700 truncate flex-1">{s.name}</span>
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => handleDeleteSound(s.id)}
                                className="text-gray-400 hover:text-red-600 text-xs shrink-0"
                                aria-label={`Eliminar ${s.name}`}
                              >
                                Eliminar
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {canEdit && (
                      <div>
                        <label className={`inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-50 cursor-pointer ${uploadingSound ? 'opacity-50 pointer-events-none' : ''}`}>
                          {uploadingSound ? 'Subiendo...' : '+ Subir sonido (MP3/WAV/OGG)'}
                          <input type="file" accept="audio/*" className="hidden" onChange={handleUploadSound} disabled={uploadingSound} />
                        </label>
                        {soundError && <p className="text-xs text-red-600 mt-1.5">{soundError}</p>}
                      </div>
                    )}
                  </div>
                )}
                {group === 'mercadolibre' && (
                  <div className="px-5 py-4">
                    <div className="flex items-start justify-between mb-1.5">
                      <label className="text-sm font-medium text-gray-700">Callback URI de Mercado Libre</label>
                      <code className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded font-mono">
                        calculado
                      </code>
                    </div>
                    <p className="text-xs text-gray-400 mb-2 leading-relaxed">
                      Se calcula automáticamente a partir de "URL del backend" (arriba). Copia este valor exacto
                      y pégalo como "Redirect URI" en tu app de ML Developer — no se edita aquí.
                    </p>
                    <div className="flex gap-2">
                      <input
                        readOnly
                        value={callbackUri || 'Configura primero la URL del backend'}
                        className="w-full px-3 py-2 border border-gray-200 bg-gray-50 rounded-lg text-sm font-mono text-gray-600"
                      />
                      <button
                        type="button"
                        onClick={handleCopyCallback}
                        disabled={!callbackUri}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 shrink-0"
                      >
                        {copied ? '✓ Copiado' : 'Copiar'}
                      </button>
                    </div>
                  </div>
                )}
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
                    {canEdit ? (
                      s.key === 'DASHBOARD_TIMEZONE' ? (
                        <select
                          value={draft[s.key] ?? ''}
                          onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {!TIMEZONE_OPTIONS.some((o) => o.value === draft[s.key]) && draft[s.key] && (
                            <option value={draft[s.key]}>{draft[s.key]}</option>
                          )}
                          {TIMEZONE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      ) : NOTIF_SOUND_KEYS.includes(s.key) ? (
                        <select
                          value={draft[s.key] ?? ''}
                          onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">🔔 Beep por defecto</option>
                          {sounds.map((snd) => (
                            <option key={snd.id} value={snd.id}>{snd.name}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={s.sensitive ? 'password' : 'text'}
                          value={draft[s.key] ?? ''}
                          onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                          placeholder={s.sensitive ? '••••••••' : `Ej: ${s.key === 'APP_URL' ? 'https://api.tudominio.com' : s.key === 'FRONTEND_URL' ? 'https://tudominio.com' : ''}`}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      )
                    ) : (
                      <div className="flex gap-2">
                        <input
                          readOnly
                          type={s.sensitive ? 'password' : 'text'}
                          value={s.key === 'DASHBOARD_TIMEZONE'
                            ? (TIMEZONE_OPTIONS.find((o) => o.value === draft[s.key])?.label ?? draft[s.key] ?? '')
                            : NOTIF_SOUND_KEYS.includes(s.key)
                            ? (sounds.find((snd) => snd.id === draft[s.key])?.name ?? (draft[s.key] ? draft[s.key] : '🔔 Beep por defecto'))
                            : draft[s.key] ?? ''}
                          className="w-full px-3 py-2 border border-gray-200 bg-gray-50 rounded-lg text-sm font-mono text-gray-600"
                        />
                        <button
                          type="button"
                          onClick={() => handleCopyField(s.key, draft[s.key] ?? '')}
                          disabled={!draft[s.key]}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 shrink-0"
                        >
                          {copiedKey === s.key ? '✓ Copiado' : 'Copiar'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

        {canEdit ? (
          <>
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
              Si cambias <code className="bg-amber-100 px-1 rounded">APP_URL</code>, el Callback URI de Mercado Libre
              cambia con ella — actualízalo también en la configuración de tu app en <strong>ML Developer</strong>.
            </div>
          </>
        ) : (
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-xs text-gray-500 leading-relaxed">
            Solo Super Admin puede editar estos valores — son compartidos por todas las empresas de la plataforma.
          </div>
        )}
      </form>
    </div>
  );
}

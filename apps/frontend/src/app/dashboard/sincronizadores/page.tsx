'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, getUser } from '@/lib/auth';
import { api } from '@/lib/api';
import {
  usePlatformLogos, resolvePlatformLogo, resolvePlatformName, resolvePlatformDescription,
  invalidatePlatformLogosCache, type PlatformLogoSetting,
} from '@/lib/platformLogos';
import { CONNECTORS, GROUP_LABELS, connectorStatus, type ConnectorGroup, type ConnectorStatus } from '@/lib/connectors';
import { PlatformEditModal } from '@/components/PlatformEditModal';
import { confirmDialog } from '../ConfirmDialog';

const STATUS: Array<{ value: ConnectorStatus; label: string; on: string }> = [
  { value: 'AVAILABLE', label: 'Disponible', on: 'bg-green-600 text-white' },
  { value: 'SOON', label: 'Próximamente', on: 'bg-[var(--brand)] text-white' },
  { value: 'DISABLED', label: 'Desactivado', on: 'bg-gray-700 text-white' },
];

/**
 * Sincronizadores (solo Super Admin): define cuáles están disponibles para las empresas y en la
 * landing, cuáles se muestran como "Próximamente" y cuáles quedan ocultos. Desactivar uno no
 * corta las conexiones que ya existen: solo impide conexiones nuevas y lo oculta.
 */
export default function SincronizadoresPage() {
  const router = useRouter();
  const shared = usePlatformLogos();
  const [saved, setSaved] = useState<Record<string, PlatformLogoSetting>>({});
  const map = { ...shared, ...saved };
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (getUser()?.role !== 'SUPER_ADMIN') { router.replace('/dashboard'); return; }
      setAllowed(true);
      api.settings.platforms.usage(getToken()!).then(setUsage).catch(() => setUsage({}));
    });
    return () => cancelAnimationFrame(id);
  }, [router]);

  async function setStatus(key: string, status: ConnectorStatus) {
    const used = usage[key] || 0;
    if (status === 'DISABLED' && used > 0) {
      const ok = await confirmDialog(
        `${used} empresa(s) usan este sincronizador. Sus conexiones seguirán funcionando, pero nadie más podrá conectarlo y dejará de verse en la página de inicio. ¿Desactivarlo?`,
      );
      if (!ok) return;
    }
    setBusy(key);
    setError('');
    try {
      const updated = await api.settings.platforms.update(key, { status }, getToken()!);
      setSaved((m) => ({ ...m, [key]: updated }));
      invalidatePlatformLogosCache();
    } catch (e) {
      setError((e as Error).message || 'No se pudo cambiar el estado');
    } finally {
      setBusy(null);
    }
  }

  if (!allowed) return null;
  const editingConn = CONNECTORS.find((c) => c.key === editing);
  const groups = Object.keys(GROUP_LABELS) as ConnectorGroup[];

  return (
    <div className="max-w-5xl">
      <h1 className="ui-page-title mb-1">Sincronizadores</h1>
      <p className="ui-page-subtitle mb-3">
        Elige qué sincronizadores ven las empresas y la página de inicio. Los nuevos parten desactivados hasta que los valides.
      </p>
      <div className="mb-6 flex flex-wrap gap-x-5 gap-y-1 rounded-xl border border-gray-200 bg-white px-4 py-3 text-xs text-gray-600">
        <span><strong className="text-green-700">Disponible:</strong> se ve en la landing y las empresas lo pueden conectar.</span>
        <span><strong className="text-[var(--brand)]">Próximamente:</strong> se ve con esa etiqueta, pero no se puede conectar.</span>
        <span><strong className="text-gray-700">Desactivado:</strong> oculto; las conexiones que ya existen siguen funcionando.</span>
      </div>
      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {groups.map((g) => (
        <section key={g} className="mb-8">
          <h2 className="ui-section-title mb-3">{GROUP_LABELS[g]}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CONNECTORS.filter((c) => c.group === g).map((c) => {
              const status = connectorStatus(map, c.key);
              const name = resolvePlatformName(map, c.key, c.name);
              const used = usage[c.key] || 0;
              return (
                <div key={c.key} className={`relative rounded-2xl border-2 bg-white p-5 transition-all hover:shadow-md ${
                  status === 'AVAILABLE' ? 'border-green-400' : status === 'SOON' ? 'border-[var(--brand)]/40' : 'border-gray-200'}`}>
                  <button type="button" onClick={() => setEditing(c.key)} title="Editar nombre, descripción y logo"
                    className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700">
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <div className="mb-4 flex justify-center">
                    <div className={`h-16 w-24 overflow-hidden rounded-lg transition-all ${status === 'DISABLED' ? 'grayscale opacity-50' : ''}`}>
                      {resolvePlatformLogo(map, c.key, c.logo, name)}
                    </div>
                  </div>
                  <h3 className="ui-section-title mb-1">{name}</h3>
                  <p className="text-xs leading-relaxed text-gray-500">{resolvePlatformDescription(map, c.key, c.description)}</p>
                  <p className="mt-2 text-[11px] text-gray-400">{used ? `${used} empresa(s) lo usan` : 'Sin empresas conectadas'}</p>
                  {/* Estado: tres opciones */}
                  <div role="radiogroup" aria-label={`Estado de ${name}`} className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1 text-[11px] font-semibold">
                    {STATUS.map((s) => (
                      <button key={s.value} type="button" role="radio" aria-checked={status === s.value} disabled={busy === c.key}
                        onClick={() => status !== s.value && setStatus(c.key, s.value)}
                        className={`rounded-md px-1 py-1.5 transition-colors disabled:opacity-60 ${status === s.value ? s.on : 'text-gray-500 hover:bg-white'}`}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {editingConn && (
        <PlatformEditModal
          platform={editingConn.key}
          defaultName={editingConn.name}
          defaultDescription={editingConn.description}
          current={map[editingConn.key]}
          fallback={editingConn.logo}
          onClose={() => setEditing(null)}
          onSaved={(u) => { setSaved((m) => ({ ...m, [u.platform]: u })); setEditing(null); }}
        />
      )}
    </div>
  );
}

'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { Modal, btnPrimary, btnSecondary, inputCls, labelCls, FormError } from '@/components/ui/Modal';
import { invalidatePlatformLogosCache, type PlatformLogoSetting } from '@/lib/platformLogos';
import { PlatformLogoField } from '@/components/PlatformLogoField';
import { VISIBILITY_LABELS, type ConnectorVisibility } from '@/lib/connectors';
import { useAdminCompany } from '@/app/dashboard/AdminCompanyContext';

const VISIBILITY_HINTS: Record<ConnectorVisibility, string> = {
  PUBLIC: 'Aparece en la landing y lo ven todos los clientes.',
  INTERNAL: 'Lo ven todos los clientes en el panel, pero no aparece en la landing.',
  RESERVED: 'Solo lo ven las empresas que elijas (no aparece en la landing).',
};

/**
 * Editar nombre, descripción y logo de una plataforma (facturadores, etc.). El logo se sube
 * y ajusta igual que el de la empresa, con tamaño por vista. Solo Super Admin.
 */
export function PlatformEditModal({ platform, defaultName, defaultDescription, current, fallback, onClose, onSaved }: {
  platform: string;
  defaultName: string;
  defaultDescription: string;
  current?: PlatformLogoSetting;
  fallback?: ReactNode;
  onClose: () => void;
  onSaved: (updated: PlatformLogoSetting) => void;
}) {
  const [form, setForm] = useState({
    displayName: current?.displayName || '',
    description: current?.description || '',
    logoUrl: current?.logoUrl || '',
    logoScale: current?.logoScale || 100,
    logoScales: (current?.logoScales || null) as Record<string, number> | null,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Visibilidad: Publicado / Interno / Reservado (con las empresas que lo ven).
  const { companies } = useAdminCompany();
  const [visibility, setVisibility] = useState<ConnectorVisibility>(
    current?.visibility === 'INTERNAL' || current?.visibility === 'RESERVED' ? current.visibility : 'PUBLIC',
  );
  const [allowed, setAllowed] = useState<Set<string>>(new Set());
  const [companyFilter, setCompanyFilter] = useState('');
  // La lista pública no trae las empresas de los reservados: se piden aparte (solo Super Admin).
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api.settings.platforms.list(token)
      .then((rows) => {
        const row = rows.find((r: PlatformLogoSetting) => r.platform === platform);
        if (row?.allowedCompanyIds) setAllowed(new Set(row.allowedCompanyIds));
      })
      .catch(() => {});
  }, [platform]);
  const toggleCompany = (id: string) => setAllowed((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const shownCompanies = (companies || [])
    .filter((c: { id: string; name: string }) => !companyFilter || c.name.toLowerCase().includes(companyFilter.toLowerCase()));

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (visibility === 'RESERVED' && allowed.size === 0) {
      setError('Elige al menos una empresa para un sincronizador reservado');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const updated = await api.settings.platforms.update(platform, {
        displayName: form.displayName.trim() || undefined,
        description: form.description.trim() || undefined,
        logoUrl: form.logoUrl.trim() || undefined,
        logoScale: form.logoScale,
        logoScales: form.logoScales || undefined,
        visibility,
        allowedCompanyIds: [...allowed],
      }, getToken()!);
      invalidatePlatformLogosCache();
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Editar ${defaultName}`}
      busy={saving}
      onClose={onClose}
      onSubmit={handleSave}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={saving} className={btnSecondary}>Cancelar</button>
          <button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Guardando...' : 'Guardar cambios'}</button>
        </>
      )}
    >
      <div className="space-y-4">
        <div>
          <label className={labelCls}>Nombre</label>
          <input value={form.displayName} placeholder={defaultName} className={inputCls}
            onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} />
          <p className="mt-1 text-xs text-gray-400">Deja vacío para usar el nombre por defecto.</p>
        </div>
        <div>
          <label className={labelCls}>Descripción</label>
          <textarea value={form.description} placeholder={defaultDescription} rows={3} className={`${inputCls} resize-none`}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </div>
        <div>
          <label className={`${labelCls} mb-2`}>Logo</label>
          <PlatformLogoField
            platform={platform}
            name={form.displayName || defaultName}
            logoUrl={form.logoUrl}
            logoScale={form.logoScale}
            logoScales={form.logoScales}
            fallback={fallback}
            onChange={(v) => setForm((f) => ({ ...f, ...v }))}
          />
        </div>
        <div>
          <label className={`${labelCls} mb-2`}>Visibilidad</label>
          <div role="radiogroup" aria-label="Visibilidad" className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1 text-xs font-semibold">
            {(Object.keys(VISIBILITY_LABELS) as ConnectorVisibility[]).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={visibility === v} onClick={() => setVisibility(v)}
                className={`rounded-md py-1.5 transition ${visibility === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {VISIBILITY_LABELS[v]}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-gray-400">{VISIBILITY_HINTS[visibility]}</p>
          {visibility === 'RESERVED' && (
            <div className="mt-2 rounded-lg border border-gray-200">
              <div className="border-b border-gray-100 p-2">
                <input value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} placeholder="Buscar empresa…" className={inputCls} />
              </div>
              <div className="max-h-44 overflow-y-auto p-1">
                {shownCompanies.map((c: { id: string; name: string }) => (
                  <label key={c.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                    <input type="checkbox" checked={allowed.has(c.id)} onChange={() => toggleCompany(c.id)} className="accent-blue-600" />
                    {c.name}
                  </label>
                ))}
                {shownCompanies.length === 0 && <p className="px-2 py-3 text-xs text-gray-400">Sin empresas.</p>}
              </div>
              <p className="border-t border-gray-100 px-3 py-1.5 text-[11px] text-gray-500">
                {allowed.size} {allowed.size === 1 ? 'empresa elegida' : 'empresas elegidas'}
              </p>
            </div>
          )}
        </div>
        <FormError message={error} />
      </div>
    </Modal>
  );
}

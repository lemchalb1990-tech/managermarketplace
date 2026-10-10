'use client';

import { useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { Modal, btnPrimary, btnSecondary, inputCls, labelCls, FormError } from '@/components/ui/Modal';
import { invalidatePlatformLogosCache, type PlatformLogoSetting } from '@/lib/platformLogos';
import { PlatformLogoField } from '@/components/PlatformLogoField';

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

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const updated = await api.settings.platforms.update(platform, {
        displayName: form.displayName.trim() || undefined,
        description: form.description.trim() || undefined,
        logoUrl: form.logoUrl.trim() || undefined,
        logoScale: form.logoScale,
        logoScales: form.logoScales || undefined,
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
        <FormError message={error} />
      </div>
    </Modal>
  );
}

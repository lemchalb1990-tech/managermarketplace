'use client';

import { useState } from 'react';
import { getToken, getUser, saveSession } from '@/lib/auth';
import { api, imgUrl } from '@/lib/api';
import { Modal, btnPrimary, btnSecondary, inputCls, labelCls, FormError } from '@/components/ui/Modal';
import { confirmDialog } from '../ConfirmDialog';

const FIELDS = [
  'companyName', 'razonSocial', 'rut', 'giro', 'address', 'commune', 'city',
  'phone', 'email', 'resolutionNumber', 'resolutionDate', 'footerText',
] as const;
type Form = Record<(typeof FIELDS)[number], string>;

function toForm(profile: any): Form {
  const f = {} as Form;
  FIELDS.forEach((k) => { f[k] = profile?.[k] || ''; });
  f.resolutionDate = profile?.resolutionDate ? profile.resolutionDate.slice(0, 10) : '';
  return f;
}

// Datos de la empresa: nombre comercial (Company.name) + identidad legal y logo (perfil de
// facturación). Encabezan los tickets, órdenes de trabajo, comprobantes, correos y los DTE.
export default function CompanyDataModal({ profile, companyId, onClose, onSaved }: {
  profile: any;
  companyId?: string;
  onClose: () => void;
  onSaved: (profile: any) => void;
}) {
  const [form, setForm] = useState<Form>(() => toForm(profile));
  const [logoUrl, setLogoUrl] = useState<string | null>(profile?.logoUrl || null);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState('');

  const field = (key: keyof Form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const companyName = form.companyName.trim();
    if (!companyName) { setError('El nombre de la empresa es obligatorio.'); return; }
    setSaving(true);
    // Campo vacío = se borra (null); así se puede quitar un dato ya guardado.
    const val = (v: string) => v.trim() || null;
    try {
      const token = getToken()!;
      const saved = await api.billing.profile.save({
        companyName,
        razonSocial: val(form.razonSocial),
        rut: val(form.rut),
        giro: val(form.giro),
        address: val(form.address),
        commune: val(form.commune),
        city: val(form.city),
        phone: val(form.phone),
        email: val(form.email),
        resolutionNumber: val(form.resolutionNumber),
        resolutionDate: form.resolutionDate || null,
        footerText: val(form.footerText),
      }, token, companyId);
      // El nombre de la empresa del admin también se muestra en el panel: se actualiza la sesión.
      const u = getUser();
      if (u?.company && u.role !== 'SUPER_ADMIN') {
        saveSession(token, { ...u, company: { ...u.company, name: companyName } });
      }
      onSaved({ ...saved, logoUrl });
    } catch (err: any) {
      setError(err.message || 'Error al guardar los datos');
      setSaving(false);
    }
  }

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setUploadingLogo(true);
    try {
      const p = await api.billing.profile.uploadLogo(file, getToken()!, companyId);
      setLogoUrl(p.logoUrl || null);
    } catch (err: any) {
      setError(err.message || 'Error al subir el logo');
    } finally {
      setUploadingLogo(false);
      e.target.value = '';
    }
  }

  async function handleRemoveLogo() {
    if (!(await confirmDialog('¿Quitar el logo? Los documentos saldrán sin logo hasta que subas otro.', { danger: true }))) return;
    setError('');
    setUploadingLogo(true);
    try {
      await api.billing.profile.removeLogo(getToken()!, companyId);
      setLogoUrl(null);
    } catch (err: any) {
      setError(err.message || 'Error al quitar el logo');
    } finally {
      setUploadingLogo(false);
    }
  }

  const busy = saving || uploadingLogo;

  return (
    <Modal
      title="Datos de la empresa"
      subtitle="Se imprimen en tickets, órdenes de trabajo y comprobantes, y se usan como emisor en boletas y facturas."
      size="lg"
      busy={busy}
      onClose={onClose}
      onSubmit={handleSave}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className={btnSecondary}>Cancelar</button>
          <button type="submit" disabled={busy} className={btnPrimary}>{saving ? 'Guardando...' : 'Guardar datos'}</button>
        </>
      )}
    >
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-20 h-20 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden shrink-0">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imgUrl(logoUrl)} alt="Logo" className="w-full h-full object-contain" />
            ) : (
              <span className="text-gray-300 text-xs text-center px-2">Sin logo</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className={`${btnSecondary} cursor-pointer ${uploadingLogo ? 'opacity-50 pointer-events-none' : ''}`}>
              {uploadingLogo ? 'Procesando...' : logoUrl ? 'Cambiar logo' : 'Subir logo'}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
                disabled={uploadingLogo} onChange={handleLogoChange} />
            </label>
            {logoUrl && (
              <button type="button" onClick={handleRemoveLogo} disabled={uploadingLogo}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">
                Quitar logo
              </button>
            )}
            <span className="text-xs text-gray-400 w-full">PNG, JPG, WebP o SVG, máx. 5 MB.</span>
          </div>
        </div>

        <div>
          <label className={labelCls}>Nombre de la empresa *</label>
          <input {...field('companyName')} required maxLength={120} className={inputCls} />
          <p className="text-xs text-gray-400 mt-1">Nombre comercial: encabeza los tickets, órdenes y correos.</p>
        </div>

        <div>
          <h3 className="ui-section-title mb-3">Identidad tributaria</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Razón social</label>
              <input {...field('razonSocial')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>RUT</label>
              <input {...field('rut')} placeholder="Ej: 76.123.456-7" className={`${inputCls} font-mono`} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Giro</label>
              <input {...field('giro')} className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Dirección</label>
              <input {...field('address')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Comuna</label>
              <input {...field('commune')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Ciudad</label>
              <input {...field('city')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Teléfono</label>
              <input {...field('phone')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Email de contacto</label>
              <input type="email" {...field('email')} className={inputCls} />
            </div>
          </div>
        </div>

        <div>
          <h3 className="ui-section-title mb-3">Resolución SII</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>N° de resolución</label>
              <input {...field('resolutionNumber')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Fecha de resolución</label>
              <input type="date" {...field('resolutionDate')} className={inputCls} />
            </div>
          </div>
        </div>

        <div>
          <label className={labelCls}>Pie de página / texto legal (opcional)</label>
          <textarea {...field('footerText')} rows={2} className={`${inputCls} resize-none`} />
        </div>

        <FormError message={error} />
      </div>
    </Modal>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { getToken, getUser, saveSession } from '@/lib/auth';
import { api, imgUrl } from '@/lib/api';
import { useAdminCompany } from '../AdminCompanyContext';
import { SkeletonForm } from '@/components/Skeleton';
import { confirmDialog } from '../ConfirmDialog';

const emptyForm = {
  companyName: '', razonSocial: '', rut: '', giro: '', address: '', commune: '', city: '',
  phone: '', email: '', resolutionNumber: '', resolutionDate: '', footerText: '',
};

// Datos de la empresa: nombre comercial (Company.name) + identidad legal y logo (perfil de
// facturación). Encabezan los tickets, órdenes de trabajo, comprobantes, correos y los DTE
// emitidos. Los edita el administrador de la empresa o el Super Admin (empresa seleccionada).
export default function CompanyDataPage() {
  const { companyId } = useAdminCompany();
  const [currentUser, setCurrentUser] = useState<any>(null);

  const [form, setForm] = useState(emptyForm);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [error, setError] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const canEdit = ['SUPER_ADMIN', 'COMPANY_ADMIN'].includes(currentUser?.role);

  async function load() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      const profile = await api.billing.profile.get(token, companyId);
      setForm({
        companyName: profile?.companyName || '',
        razonSocial: profile?.razonSocial || '',
        rut: profile?.rut || '',
        giro: profile?.giro || '',
        address: profile?.address || '',
        commune: profile?.commune || '',
        city: profile?.city || '',
        phone: profile?.phone || '',
        email: profile?.email || '',
        resolutionNumber: profile?.resolutionNumber || '',
        resolutionDate: profile?.resolutionDate ? profile.resolutionDate.slice(0, 10) : '',
        footerText: profile?.footerText || '',
      });
      setLogoUrl(profile?.logoUrl || null);
    } catch {
      setForm(emptyForm);
      setLogoUrl(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setCurrentUser(getUser());
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaveMsg('');
    const companyName = form.companyName.trim();
    if (!companyName) { setError('El nombre de la empresa es obligatorio.'); return; }
    setSaving(true);
    // Campo vacío = se borra (null); así se puede quitar un dato ya guardado.
    const val = (v: string) => v.trim() || null;
    try {
      const token = getToken()!;
      await api.billing.profile.save({
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
      setSaveMsg('Datos guardados. Se usarán en los próximos tickets, órdenes y documentos.');
    } catch (err: any) {
      setError(err.message || 'Error al guardar los datos');
    } finally {
      setSaving(false);
    }
  }

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setUploadingLogo(true);
    try {
      const token = getToken()!;
      const profile = await api.billing.profile.uploadLogo(file, token, companyId);
      setLogoUrl(profile.logoUrl || null);
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

  const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50';
  const label = 'block text-xs font-medium text-gray-600 mb-1';
  const field = (key: keyof typeof emptyForm) => ({
    value: form[key],
    disabled: !canEdit,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  return (
    <div className="max-w-2xl">
      <div className="mb-3">
        <h1 className="ui-page-title">Datos de la empresa</h1>
        <p className="ui-page-subtitle">
          Nombre, logo, RUT y dirección de tu empresa. Se imprimen en los tickets, órdenes de trabajo y comprobantes de venta, y se usan como emisor al emitir boletas y facturas.
        </p>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-5"><SkeletonForm fields={8} /></div>
      ) : (
      <form onSubmit={handleSave} className="space-y-6">
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="ui-section-title mb-4">Empresa</h2>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="w-20 h-20 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden shrink-0">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imgUrl(logoUrl)} alt="Logo" className="w-full h-full object-contain" />
              ) : (
                <span className="text-gray-300 text-xs text-center px-2">Sin logo</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <label className={label}>Nombre de la empresa *</label>
              <input {...field('companyName')} required maxLength={120} className={input} />
              <p className="text-xs text-gray-400 mt-1">Nombre comercial: encabeza los tickets, órdenes y correos.</p>
            </div>
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-2 mt-4">
              <label className={`px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 cursor-pointer ${uploadingLogo ? 'opacity-50 pointer-events-none' : ''}`}>
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
              <span className="text-xs text-gray-400 self-center">PNG, JPG, WebP o SVG, máx. 5 MB.</span>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="ui-section-title mb-4">Identidad tributaria</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={label}>Razón social</label>
              <input {...field('razonSocial')} className={input} />
            </div>
            <div>
              <label className={label}>RUT</label>
              <input {...field('rut')} placeholder="Ej: 76.123.456-7" className={`${input} font-mono`} />
            </div>
            <div className="sm:col-span-2">
              <label className={label}>Giro</label>
              <input {...field('giro')} className={input} />
            </div>
            <div className="sm:col-span-2">
              <label className={label}>Dirección</label>
              <input {...field('address')} className={input} />
            </div>
            <div>
              <label className={label}>Comuna</label>
              <input {...field('commune')} className={input} />
            </div>
            <div>
              <label className={label}>Ciudad</label>
              <input {...field('city')} className={input} />
            </div>
            <div>
              <label className={label}>Teléfono</label>
              <input {...field('phone')} className={input} />
            </div>
            <div>
              <label className={label}>Email de contacto</label>
              <input type="email" {...field('email')} className={input} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="ui-section-title mb-4">Resolución SII</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={label}>N° de resolución</label>
              <input {...field('resolutionNumber')} className={input} />
            </div>
            <div>
              <label className={label}>Fecha de resolución</label>
              <input type="date" {...field('resolutionDate')} className={input} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <label className={label}>Pie de página / texto legal (opcional)</label>
          <textarea {...field('footerText')} rows={2} className={`${input} resize-none`} />
        </div>

        {error && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
        )}
        {saveMsg && (
          <div className="px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">{saveMsg}</div>
        )}

        {canEdit && (
          <button type="submit" disabled={saving}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-xl text-sm">
            {saving ? 'Guardando...' : 'Guardar datos'}
          </button>
        )}
      </form>
      )}
    </div>
  );
}

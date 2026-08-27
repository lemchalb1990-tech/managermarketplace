'use client';

import { useEffect, useState } from 'react';
import { getToken, getUser } from '@/lib/auth';
import { api, imgUrl } from '@/lib/api';
import { useBillingCompany } from '../BillingCompanyContext';

const emptyForm = {
  razonSocial: '', rut: '', giro: '', address: '', commune: '', city: '',
  phone: '', email: '', resolutionNumber: '', resolutionDate: '', footerText: '',
};

export default function BillingProfilePage() {
  const { companyId } = useBillingCompany();
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
      if (profile) {
        setForm({
          razonSocial: profile.razonSocial || '',
          rut: profile.rut || '',
          giro: profile.giro || '',
          address: profile.address || '',
          commune: profile.commune || '',
          city: profile.city || '',
          phone: profile.phone || '',
          email: profile.email || '',
          resolutionNumber: profile.resolutionNumber || '',
          resolutionDate: profile.resolutionDate ? profile.resolutionDate.slice(0, 10) : '',
          footerText: profile.footerText || '',
        });
        setLogoUrl(profile.logoUrl || null);
      } else {
        setForm(emptyForm);
        setLogoUrl(null);
      }
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
    setSaving(true);
    try {
      const token = getToken()!;
      await api.billing.profile.save({
        razonSocial: form.razonSocial.trim() || undefined,
        rut: form.rut.trim() || undefined,
        giro: form.giro.trim() || undefined,
        address: form.address.trim() || undefined,
        commune: form.commune.trim() || undefined,
        city: form.city.trim() || undefined,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        resolutionNumber: form.resolutionNumber.trim() || undefined,
        resolutionDate: form.resolutionDate || undefined,
        footerText: form.footerText.trim() || undefined,
      }, token, companyId);
      setSaveMsg('Perfil guardado.');
    } catch (err: any) {
      setError(err.message || 'Error al guardar el perfil');
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

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 mb-6">
        <a href="/dashboard/billing" className="text-sm text-gray-400 hover:text-gray-600">Facturación</a>
        <span className="text-gray-300">/</span>
        <span className="text-sm text-gray-600 font-medium">Perfil de facturación</span>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Perfil de facturación</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          Datos de tu empresa como emisora de documentos tributarios. Se usan automáticamente al emitir cualquier DTE.
        </p>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-10 text-center text-gray-400 text-sm">Cargando...</div>
      ) : (
      <form onSubmit={handleSave} className="space-y-6">
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-800 mb-4">Logo</h2>
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden shrink-0">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imgUrl(logoUrl)} alt="Logo" className="w-full h-full object-contain" />
              ) : (
                <span className="text-gray-300 text-xs text-center px-2">Sin logo</span>
              )}
            </div>
            {canEdit && (
              <label className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 cursor-pointer">
                {uploadingLogo ? 'Subiendo...' : 'Cambiar logo'}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
                  disabled={uploadingLogo} onChange={handleLogoChange} />
              </label>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-800 mb-4">Identidad tributaria</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Razón social</label>
              <input value={form.razonSocial} disabled={!canEdit}
                onChange={(e) => setForm((f) => ({ ...f, razonSocial: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">RUT</label>
              <input value={form.rut} disabled={!canEdit}
                onChange={(e) => setForm((f) => ({ ...f, rut: e.target.value }))}
                placeholder="Ej: 76.123.456-7"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono disabled:bg-gray-50" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Giro</label>
              <input value={form.giro} disabled={!canEdit}
                onChange={(e) => setForm((f) => ({ ...f, giro: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Dirección</label>
              <input value={form.address} disabled={!canEdit}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Comuna</label>
              <input value={form.commune} disabled={!canEdit}
                onChange={(e) => setForm((f) => ({ ...f, commune: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Ciudad</label>
              <input value={form.city} disabled={!canEdit}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Teléfono</label>
              <input value={form.phone} disabled={!canEdit}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email de contacto</label>
              <input type="email" value={form.email} disabled={!canEdit}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-800 mb-4">Resolución SII</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">N° de resolución</label>
              <input value={form.resolutionNumber} disabled={!canEdit}
                onChange={(e) => setForm((f) => ({ ...f, resolutionNumber: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Fecha de resolución</label>
              <input type="date" value={form.resolutionDate} disabled={!canEdit}
                onChange={(e) => setForm((f) => ({ ...f, resolutionDate: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <label className="block text-xs font-medium text-gray-600 mb-1">Pie de página / texto legal (opcional)</label>
          <textarea value={form.footerText} disabled={!canEdit}
            onChange={(e) => setForm((f) => ({ ...f, footerText: e.target.value }))}
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none disabled:bg-gray-50" />
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
            {saving ? 'Guardando...' : 'Guardar perfil'}
          </button>
        )}
      </form>
      )}
    </div>
  );
}

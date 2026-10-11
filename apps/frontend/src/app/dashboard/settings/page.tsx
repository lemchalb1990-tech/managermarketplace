'use client';

import Link from 'next/link';
import AccountClosureSection from './AccountClosureSection';
import CompanySection from './CompanySection';
import { getUser } from '@/lib/auth';
import { useNotifications } from '../Notifications';

// Configuración de la empresa: datos de la empresa, preferencias personales y baja de la cuenta.
// Los ajustes del sistema (compartidos por todas las empresas) están en Administrador de
// plataforma → Ajustes del sistema, solo para el Super Admin.
export default function SettingsPage() {
  const role = getUser()?.role;
  const { muted, toggleMuted } = useNotifications();

  return (
    <div className="max-w-2xl">
      <div className="mb-3">
        <h1 className="ui-page-title mb-1">Configuración</h1>
        <p className="ui-page-subtitle">Datos de tu empresa y tus preferencias.</p>
      </div>

      {role === 'SUPER_ADMIN' && (
        <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Las URLs, el acceso con Google, el correo de la plataforma y demás valores compartidos están en{' '}
          <Link href="/dashboard/ajustes-sistema" className="font-semibold underline">Administrador de plataforma → Ajustes del sistema</Link>.
        </div>
      )}

      {['SUPER_ADMIN', 'COMPANY_ADMIN'].includes(role) && <CompanySection />}

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden mb-6">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
          <h2 className="ui-section-title">Notificaciones</h2>
        </div>
        <div className="px-5 py-4">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={!muted} onChange={toggleMuted} className="w-4 h-4 accent-blue-600" />
            <span className="text-sm font-medium text-gray-700">Sonido de notificaciones</span>
          </label>
          <p className="text-xs text-gray-400 mt-1 ml-6">
            Solo para ti, en este navegador. Si lo desactivas, la campanita y los avisos emergentes
            siguen funcionando igual — solo deja de sonar, y no vuelve a pedirte que actives el sonido.
          </p>
        </div>
      </div>

      {role === 'COMPANY_ADMIN' && <AccountClosureSection />}
    </div>
  );
}

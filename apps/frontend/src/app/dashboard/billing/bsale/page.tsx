'use client';
import ProviderPage from '../components/ProviderPage';
import { BillingLogos } from '../components/logos';

export default function BsalePage() {
  return (
    <ProviderPage config={{
      provider: 'BSALE',
      name: 'Bsale',
      description: 'Integración con Bsale para emitir documentos tributarios y sincronizar ventas.',
      color: '#FF6B00',
      logo: BillingLogos.bsale,
      supportsDirectEmission: true,
      helpText: 'Obtén tu Access Token desde Configuración → Desarrolladores en tu cuenta de Bsale. El Office ID corresponde a tu sucursal principal (generalmente 1).',
      helpUrl: 'https://developers.bsale.cl',
      fields: [
        { key: 'accessToken', label: 'Access Token', type: 'password', placeholder: 'Tu token de acceso de Bsale' },
        { key: 'officeId', label: 'Office ID', placeholder: '1', hint: 'ID de la sucursal desde donde se emiten documentos' },
      ],
    }} />
  );
}

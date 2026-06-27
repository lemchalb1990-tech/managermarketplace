'use client';
import ProviderPage from '../components/ProviderPage';
import { BillingLogos } from '../components/logos';

export default function NuboxPage() {
  return (
    <ProviderPage config={{
      provider: 'NUBOX',
      name: 'Nubox',
      description: 'Software de gestión y facturación para PYMES chilenas. Integración directa con el SII.',
      color: '#0057B8',
      logo: BillingLogos.nubox,
      helpText: 'Genera tu API Key desde Configuración → Integraciones en tu cuenta de Nubox. El RUT debe coincidir con el contribuyente registrado.',
      fields: [
        { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Tu API Key de Nubox' },
        { key: 'companyRut', label: 'RUT de la empresa', placeholder: 'Ej: 12345678-9' },
      ],
    }} />
  );
}

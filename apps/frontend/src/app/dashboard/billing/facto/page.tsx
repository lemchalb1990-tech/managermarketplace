'use client';
import ProviderPage from '../components/ProviderPage';
import { BillingLogos } from '../components/logos';

export default function FactoPage() {
  return (
    <ProviderPage config={{
      provider: 'FACTO',
      name: 'Facto',
      description: 'Facturación electrónica sencilla y autorizada por el SII. Conecta tu cuenta de Facto para emitir DTEs.',
      color: '#00B274',
      logo: BillingLogos.facto,
      helpText: 'Accede a tu cuenta de Facto y genera una clave de API desde el panel de integraciones.',
      fields: [
        { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Tu API Key de Facto' },
        { key: 'companyRut', label: 'RUT de la empresa', placeholder: 'Ej: 12345678-9' },
      ],
    }} />
  );
}

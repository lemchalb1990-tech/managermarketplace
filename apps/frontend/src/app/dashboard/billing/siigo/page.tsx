'use client';
import ProviderPage from '../components/ProviderPage';
import { BillingLogos } from '../components/logos';

export default function SiigoPage() {
  return (
    <ProviderPage config={{
      provider: 'SIIGO',
      name: 'Siigo',
      description: 'Software contable en la nube con módulo DTE. API moderna REST con soporte para facturas y boletas.',
      color: '#6B21A8',
      logo: BillingLogos.siigo,
      helpText: 'Obtén tu Partner API Key y Access Key desde el portal de desarrolladores de Siigo. Solicita acceso en developers.siigo.com.',
      helpUrl: 'https://developers.siigo.com',
      fields: [
        { key: 'partnerApiKey', label: 'Partner API Key', type: 'password', placeholder: 'Tu Partner API Key' },
        { key: 'accessKey', label: 'Access Key (usuario:contraseña en base64)', type: 'password', placeholder: 'Base64 de usuario:contraseña' },
        { key: 'companyRut', label: 'RUT de la empresa', placeholder: 'Ej: 12345678-9' },
      ],
    }} />
  );
}

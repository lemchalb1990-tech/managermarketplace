'use client';
import ProviderPage from '../components/ProviderPage';
import { BillingLogos } from '../components/logos';

export default function OpenFacturaPage() {
  return (
    <ProviderPage config={{
      provider: 'OPENFACTURA',
      name: 'OpenFactura',
      description: 'Emisión de DTEs (facturas, boletas, notas de crédito) a través de la API de Haulmer.',
      color: '#1A3C8F',
      logo: BillingLogos.openfactura,
      supportsDirectEmission: true,
      helpText: 'Obtén tu API Key desde el portal de desarrolladores de Haulmer (developers.haulmer.com). También necesitas el RUT de tu empresa.',
      helpUrl: 'https://developers.haulmer.com',
      fields: [
        { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Tu API Key de OpenFactura' },
        { key: 'companyRut', label: 'RUT de la empresa', placeholder: 'Ej: 12345678-9', hint: 'RUT con dígito verificador, sin puntos' },
        { key: 'companyActivity', label: 'Giro comercial', placeholder: 'Ej: Venta al por menor de artículos', required: false },
      ],
    }} />
  );
}

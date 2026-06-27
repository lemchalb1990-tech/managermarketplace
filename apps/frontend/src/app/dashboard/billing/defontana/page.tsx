'use client';
import ProviderPage from '../components/ProviderPage';
import { BillingLogos } from '../components/logos';

export default function DefontanaPage() {
  return (
    <ProviderPage config={{
      provider: 'DEFONTANA',
      name: 'Defontana',
      description: 'ERP empresarial chileno con facturación electrónica. Ideal para empresas con alto volumen de documentos.',
      color: '#1B2A4A',
      logo: BillingLogos.defontana,
      helpText: 'Solicita las credenciales de API a tu ejecutivo de cuenta de Defontana. Necesitas usuario y contraseña del portal de integración.',
      fields: [
        { key: 'apiUser', label: 'Usuario API', placeholder: 'Tu usuario de integración Defontana' },
        { key: 'apiPassword', label: 'Contraseña API', type: 'password', placeholder: 'Tu contraseña de integración' },
        { key: 'companyRut', label: 'RUT de la empresa', placeholder: 'Ej: 12345678-9' },
      ],
    }} />
  );
}

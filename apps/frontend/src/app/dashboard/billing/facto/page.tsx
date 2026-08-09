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
      supportsDirectEmission: true,
      helpText: 'Estas credenciales llegan por correo al solicitar acceso "Software Propio" en Facto: Account ID, Resource Owner Name/Password y Client Identification/Secret.',
      helpUrl: 'https://facto.cl/documentacion/api/es/bienvenida/',
      fields: [
        { key: 'accountId', label: 'Account ID', placeholder: 'Ej: 31907' },
        { key: 'clientId', label: 'Client Identification', placeholder: 'Ej: e88fc08b0d7d' },
        { key: 'clientSecret', label: 'Client Secret', type: 'password' },
        { key: 'username', label: 'Resource Owner Name', placeholder: 'Ej: 78069413-0/fee7' },
        { key: 'password', label: 'Resource Owner Password', type: 'password' },
        { key: 'companyRut', label: 'RUT de la empresa', placeholder: 'Ej: 12345678-9' },
        { key: 'companyName', label: 'Razón social', placeholder: 'Nombre legal de la empresa' },
        { key: 'companyActivity', label: 'Giro comercial', placeholder: 'Ej: Venta al por menor de artículos', required: false },
        { key: 'companyAddress', label: 'Dirección', placeholder: 'Dirección de la empresa', required: false },
        { key: 'companyDistrict', label: 'Comuna', placeholder: 'Ej: Santiago', required: false },
        { key: 'companyCity', label: 'Ciudad', placeholder: 'Ej: Santiago', required: false },
        { key: 'companyPhone', label: 'Teléfono', placeholder: 'Ej: +56912345678', required: false },
      ],
    }} />
  );
}

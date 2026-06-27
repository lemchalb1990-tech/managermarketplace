'use client';
import PlatformPage from '../components/PlatformPage';
import { Logos } from '../components/logos';

export default function HitesPage() {
  return (
    <PlatformPage config={{
      marketplace: 'HITES',
      name: 'Hites',
      description: 'Publica en Hites Marketplace y gestiona tu stock automáticamente.',
      moduleKey: 'ecommerce_hites',
      color: '#E30613',
      logo: Logos.hites,
      supportsPublish: true,
      helpText: 'Ingresa las credenciales de acceso al portal de vendedores de Hites. Contacta a Hites para obtener acceso API.',
      fields: [
        { key: 'sellerId', label: 'Seller ID', placeholder: 'Tu ID de vendedor' },
        { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Tu clave de API' },
      ],
    }} />
  );
}

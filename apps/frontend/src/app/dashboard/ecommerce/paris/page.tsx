'use client';
import PlatformPage from '../components/PlatformPage';
import { Logos } from '../components/logos';

export default function ParisPage() {
  return (
    <PlatformPage config={{
      marketplace: 'PARIS',
      name: 'Paris',
      description: 'Vende en Paris Marketplace (Cencosud) con sincronización de inventario.',
      moduleKey: 'ecommerce_paris',
      color: '#003087',
      logo: Logos.paris,
      supportsPublish: true,
      helpText: 'Ingresa las credenciales de acceso al portal de vendedores de Paris. Contacta a Paris para obtener acceso API.',
      fields: [
        { key: 'sellerId', label: 'Seller ID', placeholder: 'Tu ID de vendedor' },
        { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Tu clave de API' },
      ],
    }} />
  );
}

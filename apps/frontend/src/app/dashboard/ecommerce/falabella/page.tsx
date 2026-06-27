'use client';
import PlatformPage from '../components/PlatformPage';
import { Logos } from '../components/logos';

export default function FalabellaPage() {
  return (
    <PlatformPage config={{
      marketplace: 'FALABELLA',
      name: 'Falabella',
      description: 'Conecta tu cuenta de Falabella Seller para sincronizar tu inventario.',
      moduleKey: 'ecommerce_falabella',
      color: '#009A44',
      logo: Logos.falabella,
      supportsPublish: true,
      helpText: 'Ingresa las credenciales de acceso a Falabella Seller Center. Contacta a Falabella para obtener acceso API.',
      fields: [
        { key: 'sellerId', label: 'Seller ID', placeholder: 'Tu ID de vendedor' },
        { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Tu clave de API' },
      ],
    }} />
  );
}

'use client';
import PlatformPage from '../components/PlatformPage';
import { Logos } from '../components/logos';

export default function RipleyPage() {
  return (
    <PlatformPage config={{
      marketplace: 'RIPLEY',
      name: 'Ripley',
      description: 'Conecta tu cuenta de Ripley Marketplace para centralizar tu inventario.',
      moduleKey: 'ecommerce_ripley',
      color: '#5B2D8E',
      logo: Logos.ripley,
      supportsPublish: true,
      helpText: 'Ingresa las credenciales de acceso al portal de vendedores de Ripley. Contacta a Ripley para obtener acceso API.',
      fields: [
        { key: 'sellerId', label: 'Seller ID', placeholder: 'Tu ID de vendedor' },
        { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Tu clave de API' },
      ],
    }} />
  );
}

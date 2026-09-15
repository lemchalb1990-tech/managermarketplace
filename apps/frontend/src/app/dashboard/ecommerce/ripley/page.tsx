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
      color: '#EC008C',
      logo: Logos.ripley,
      supportsPublish: true,
      helpText: 'Ingresa las credenciales de acceso al portal de vendedores de Ripley (Seller Center).',
      fields: [
        { key: 'sellerId', label: 'Usuario del Seller Center', placeholder: 'Tu usuario', hint: 'El mismo con el que entras al Seller Center' },
        { key: 'apiKey', label: 'Contraseña del Seller Center', type: 'password', placeholder: 'Tu contraseña' },
      ],
    }} />
  );
}

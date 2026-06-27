'use client';
import PlatformPage from '../components/PlatformPage';

export default function HitesPage() {
  return (
    <PlatformPage config={{
      marketplace: 'HITES',
      name: 'Hites',
      description: 'Conecta tu cuenta de Hites Marketplace (Cencosud) para sincronizar tu inventario.',
      moduleKey: 'ecommerce_hites',
      color: '#E53935',
      logoBg: '#E53935',
      logoText: 'HI',
      logoTextColor: '#fff',
      supportsPublish: false,
      helpText: 'Ingresa las credenciales de acceso al portal de vendedores de Hites. Contacta a Hites para obtener acceso API.',
      fields: [
        { key: 'sellerId', label: 'Seller ID', placeholder: 'Tu ID de vendedor' },
        { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Tu clave de API' },
      ],
    }} />
  );
}

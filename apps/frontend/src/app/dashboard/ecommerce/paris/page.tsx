'use client';
import PlatformPage from '../components/PlatformPage';

export default function ParisPage() {
  return (
    <PlatformPage config={{
      marketplace: 'PARIS',
      name: 'Paris',
      description: 'Conecta tu cuenta de Paris Marketplace (Cencosud) para sincronizar tu inventario.',
      moduleKey: 'ecommerce_paris',
      color: '#1565C0',
      logoBg: '#1565C0',
      logoText: 'PA',
      logoTextColor: '#fff',
      supportsPublish: false,
      helpText: 'Ingresa las credenciales de acceso al portal de vendedores de Paris. Contacta a Paris para obtener acceso API.',
      fields: [
        { key: 'sellerId', label: 'Seller ID', placeholder: 'Tu ID de vendedor' },
        { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Tu clave de API' },
      ],
    }} />
  );
}

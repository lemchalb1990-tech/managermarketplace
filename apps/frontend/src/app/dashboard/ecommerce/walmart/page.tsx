'use client';
import PlatformPage from '../components/PlatformPage';

export default function WalmartPage() {
  return (
    <PlatformPage config={{
      marketplace: 'WALMART',
      name: 'Walmart',
      description: 'Conecta tu cuenta de Walmart Marketplace Chile para sincronizar stock y precios.',
      moduleKey: 'ecommerce_walmart',
      color: '#0071CE',
      logoBg: '#0071CE',
      logoText: 'WM',
      logoTextColor: '#fff',
      supportsPublish: true,
      helpText: 'Obtén tu Client ID y Client Secret desde el portal de vendedores de Walmart Chile.',
      fields: [
        { key: 'clientId', label: 'Client ID', placeholder: 'Tu Client ID' },
        { key: 'clientSecret', label: 'Client Secret', type: 'password', placeholder: 'Tu Client Secret' },
      ],
    }} />
  );
}

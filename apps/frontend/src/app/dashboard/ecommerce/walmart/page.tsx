'use client';
import PlatformPage from '../components/PlatformPage';
import { Logos } from '../components/logos';

export default function WalmartPage() {
  return (
    <PlatformPage config={{
      marketplace: 'WALMART',
      name: 'Walmart',
      description: 'Vende en Walmart Chile con sincronización automática de precios y stock.',
      moduleKey: 'ecommerce_walmart',
      color: '#0071CE',
      logo: Logos.walmart,
      supportsPublish: true,
      helpText: 'Obtén tu Client ID y Client Secret desde el portal de vendedores de Walmart Chile.',
      fields: [
        { key: 'clientId', label: 'Client ID', placeholder: 'Tu Client ID' },
        { key: 'clientSecret', label: 'Client Secret', type: 'password', placeholder: 'Tu Client Secret' },
      ],
    }} />
  );
}

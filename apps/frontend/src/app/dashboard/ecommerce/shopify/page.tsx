'use client';
import PlatformPage from '../components/PlatformPage';
import { Logos } from '../components/logos';

export default function ShopifyPage() {
  return (
    <PlatformPage config={{
      marketplace: 'SHOPIFY',
      name: 'Shopify',
      description: 'Sincroniza tu catálogo con tu tienda Shopify. Stock y precios se actualizan automáticamente.',
      moduleKey: 'ecommerce_shopify',
      color: '#96BF48',
      logo: Logos.shopify,
      supportsPublish: true,
      helpText: 'Crea una app en el Dev Dashboard de Shopify (Settings → Apps → Develop apps) para obtener el Client ID y Client Secret.',
      fields: [
        { key: 'shopDomain', label: 'Dominio de la tienda', placeholder: 'mitienda.myshopify.com', hint: 'Solo el dominio, sin https://' },
        { key: 'clientId', label: 'Client ID', placeholder: 'Tu Client ID', hint: 'Lo entrega la app al crearla en el Dev Dashboard' },
        { key: 'accessToken', label: 'Client Secret', type: 'password', placeholder: 'Tu Client Secret' },
      ],
    }} />
  );
}

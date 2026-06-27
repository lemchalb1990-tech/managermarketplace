'use client';
import PlatformPage from '../components/PlatformPage';

export default function ShopifyPage() {
  return (
    <PlatformPage config={{
      marketplace: 'SHOPIFY',
      name: 'Shopify',
      description: 'Sincroniza tu catálogo con tu tienda Shopify. Stock y precios se actualizan automáticamente.',
      moduleKey: 'ecommerce_shopify',
      color: '#96BF48',
      logoBg: '#96BF48',
      logoText: 'SH',
      logoTextColor: '#fff',
      supportsPublish: true,
      helpText: 'Crea una app privada en tu tienda Shopify (Settings → Apps → Develop apps) y copia el Admin API access token.',
      fields: [
        { key: 'shopDomain', label: 'Dominio de la tienda', placeholder: 'mi-tienda.myshopify.com', hint: 'Solo el dominio, sin https://' },
        { key: 'accessToken', label: 'Admin API Access Token', type: 'password', placeholder: 'shpat_xxx...' },
      ],
    }} />
  );
}

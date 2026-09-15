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
      helpText: 'Crea una app personalizada en tu tienda Shopify (Configuración → Apps y canales de venta → Desarrollar apps), configura los permisos del Admin API que necesites (lectura/escritura de productos e inventario) e instálala. El Client ID y Client Secret de esa pantalla NO sirven para conectar acá — lo que necesitas es el "Admin API access token" (empieza con shpat_), que se muestra una sola vez en la pestaña "Credenciales de API" al instalar la app.',
      fields: [
        { key: 'shopDomain', label: 'Dominio de la tienda', placeholder: 'mitienda.myshopify.com', hint: 'Solo el dominio, sin https://' },
        { key: 'accessToken', label: 'Admin API Access Token', type: 'password', placeholder: 'shpat_...', hint: 'Pestaña "Credenciales de API" de tu app personalizada, no el Client ID/Secret' },
      ],
    }} />
  );
}

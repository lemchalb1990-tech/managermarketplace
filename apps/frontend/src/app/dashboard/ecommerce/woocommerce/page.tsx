'use client';
import PlatformPage from '../components/PlatformPage';
import { Logos } from '../components/logos';

export default function WooCommercePage() {
  return (
    <PlatformPage config={{
      marketplace: 'WOOCOMMERCE',
      name: 'WooCommerce',
      description: 'Conecta tu tienda WooCommerce para sincronizar stock y precios automáticamente.',
      moduleKey: 'ecommerce_woocommerce',
      color: '#7F54B3',
      logo: Logos.woocommerce,
      supportsPublish: true,
      helpText: 'Ve a WooCommerce → Ajustes → Avanzado → REST API y crea una clave con acceso de Lectura/Escritura.',
      fields: [
        { key: 'siteUrl', label: 'URL de tu tienda', type: 'url', placeholder: 'https://mi-tienda.com' },
        { key: 'consumerKey', label: 'Consumer Key', placeholder: 'ck_xxx...' },
        { key: 'consumerSecret', label: 'Consumer Secret', type: 'password', placeholder: 'cs_xxx...' },
      ],
    }} />
  );
}

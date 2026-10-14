import type { MetadataRoute } from 'next';

// App instalable (PWA): ícono en la pantalla de inicio y apertura a pantalla completa en el panel.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/dashboard',
    name: 'Admin Marketplace',
    short_name: 'Marketplace',
    description: 'Gestión de inventario y marketplace',
    lang: 'es',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#02093a',
    theme_color: '#02093a',
    icons: [
      { src: '/app/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/app/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/app/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

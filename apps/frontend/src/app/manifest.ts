import type { MetadataRoute } from 'next';

// App instalable (PWA): ícono en la pantalla de inicio y apertura a pantalla completa en el panel.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/dashboard',
    name: 'Domium',
    short_name: 'Domium',
    description: 'Tu negocio, bajo control.',
    lang: 'es',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#011f3d',
    theme_color: '#011f3d',
    icons: [
      { src: '/app/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/app/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/app/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

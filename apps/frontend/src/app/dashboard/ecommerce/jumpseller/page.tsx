'use client';
import PlatformPage from '../components/PlatformPage';

export default function JumpSellerPage() {
  return (
    <PlatformPage config={{
      marketplace: 'JUMPSELLER',
      name: 'JumpSeller',
      description: 'Administra tu tienda JumpSeller y sincroniza stock y precios desde el catálogo.',
      moduleKey: 'ecommerce_jumpseller',
      color: '#FF6B35',
      logoBg: '#FF6B35',
      logoText: 'JS',
      logoTextColor: '#fff',
      supportsPublish: true,
      helpText: 'Encuentra tu Login Token en Tienda → Configuración → API en tu panel de JumpSeller.',
      fields: [
        { key: 'storeHandle', label: 'Handle de la tienda', placeholder: 'mi-tienda', hint: 'El identificador único de tu tienda en JumpSeller' },
        { key: 'loginToken', label: 'Login Token', type: 'password', placeholder: 'Tu token de API' },
      ],
    }} />
  );
}

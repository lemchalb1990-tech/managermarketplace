'use client';
import PlatformPage from '../components/PlatformPage';
import { Logos } from '../components/logos';

export default function JumpSellerPage() {
  return (
    <PlatformPage config={{
      marketplace: 'JUMPSELLER',
      name: 'JumpSeller',
      description: 'Administra tu tienda JumpSeller: importa publicaciones y ventas, y sincroniza stock, precios y estado de las órdenes.',
      moduleKey: 'ecommerce_jumpseller',
      color: '#FF6B35',
      logo: Logos.jumpseller,
      supportsPublish: true,
      supportsImport: true,
      supportsSalesImport: true,
      supportsOrderSync: true,
      mlStyleActions: true,
      helpText: 'Encuentra el Login Key y el Auth Token en tu panel de JumpSeller: Editar cuenta → API. Cada variante (talla, color...) se importa como un producto aparte del catálogo, con su propio stock y precio.',
      fields: [
        { key: 'login', label: 'Login Key', placeholder: 'Tu login key' },
        { key: 'authtoken', label: 'Auth Token', type: 'password', placeholder: 'Tu auth token' },
      ],
    }} />
  );
}

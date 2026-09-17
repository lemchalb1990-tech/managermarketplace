'use client';
import PlatformPage from '../components/PlatformPage';
import { Logos } from '../components/logos';

export default function JumpSellerPage() {
  return (
    <PlatformPage config={{
      marketplace: 'JUMPSELLER',
      name: 'JumpSeller',
      description: 'Administra tu tienda JumpSeller y sincroniza stock y precios desde el catálogo.',
      moduleKey: 'ecommerce_jumpseller',
      color: '#FF6B35',
      logo: Logos.jumpseller,
      supportsPublish: true,
      helpText: 'Encuentra el Login Key y el Auth Token en tu panel de JumpSeller: Editar cuenta → API.',
      fields: [
        { key: 'login', label: 'Login Key', placeholder: 'Tu login key' },
        { key: 'authtoken', label: 'Auth Token', type: 'password', placeholder: 'Tu auth token' },
      ],
    }} />
  );
}

'use client';
import PlatformPage from '../components/PlatformPage';
import { Logos } from '../components/logos';

export default function RipleyPage() {
  return (
    <PlatformPage config={{
      marketplace: 'RIPLEY',
      name: 'Ripley',
      description: 'Conecta tu cuenta de Ripley Marketplace para centralizar tu inventario.',
      moduleKey: 'ecommerce_ripley',
      color: '#EC008C',
      logo: Logos.ripley,
      supportsPublish: true,
      supportsImport: true,
      supportsSalesImport: true,
      helpText: 'La API Key NO es tu contraseña del Seller Center — entra a http://ripley-prod.mirakl.net con tu usuario y contraseña, haz clic en tu email (arriba a la derecha) > "Mis ajustes de usuario" > "API key", y pega ese valor acá.',
      fields: [
        { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Ej: 7f315a31-43de-4be6-9335-4a4cee42f3af', hint: 'Se obtiene en ripley-prod.mirakl.net > tu email > Mis ajustes de usuario > API key.' },
      ],
    }} />
  );
}

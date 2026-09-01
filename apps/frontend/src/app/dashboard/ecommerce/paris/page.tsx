'use client';
import PlatformPage from '../components/PlatformPage';
import { Logos } from '../components/logos';

export default function ParisPage() {
  return (
    <PlatformPage config={{
      marketplace: 'PARIS',
      name: 'Paris',
      description: 'Conecta tu cuenta de Paris Marketplace (Cencosud).',
      moduleKey: 'ecommerce_paris',
      color: '#003087',
      logo: Logos.paris,
      supportsPublish: false,
      helpText:
        'Ingresa la API Key que te entregó Paris (Cencosud). El sistema valida la conexión contra la API de Paris al guardar. La sincronización de stock y precios se habilitará en una próxima fase.',
      fields: [
        { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Ej: 00000000-0000-0000-0000-000000000000' },
        {
          key: 'env',
          label: 'Ambiente (déjalo vacío para producción)',
          placeholder: 'staging',
          required: false,
          hint: 'Escribe "staging" solo si Paris te dio credenciales del ambiente de pruebas.',
        },
      ],
    }} />
  );
}

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
      color: '#1571F2',
      logo: Logos.paris,
      supportsPublish: false,
      helpText:
        'La API Key se genera en el portal de desarrolladores de Paris/Cencosud (Mi cuenta > API Key). El sistema valida la conexión contra la API de Paris al guardar. La sincronización de stock y precios se habilitará en una próxima fase.',
      fields: [
        { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Pega aqui la API Key', hint: 'La API Key se genera en el portal de desarrolladores de Paris/Cencosud (Mi cuenta > API Key).' },
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

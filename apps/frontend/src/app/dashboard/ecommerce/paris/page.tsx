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
      supportsPublish: true,
      supportsImport: true,
      helpText:
        'La API Key se genera en el portal de desarrolladores de Paris/Cencosud (Mi cuenta > API Key). El sistema valida la conexión contra la API de Paris al guardar. Publica productos, y sincroniza stock y precio, desde la pestaña "Paris" de cada producto en el Catálogo.',
      fields: [
        { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Pega aqui la API Key', hint: 'La API Key se genera en el portal de desarrolladores de Paris/Cencosud (Mi cuenta > API Key).' },
        {
          key: 'env',
          label: 'Ambiente (déjalo vacío para producción)',
          placeholder: 'staging',
          required: false,
          hint: 'Escribe "staging" solo si Paris te dio credenciales del ambiente de pruebas.',
        },
        {
          key: 'storePriceId',
          label: 'ID de tienda para precios (storePrice)',
          required: false,
          hint: 'Después de guardar, usa "Probar" para confirmar la conexión y pide al equipo el ID de GET /v2/store-prices de la tienda donde se publica (ej. "Paris Ecommers"). Sin esto no se pueden enviar precios.',
        },
      ],
    }} />
  );
}
